const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const { createReturnOrder } = require('../../services/shiprocketService');

/* =========================
   REQUEST RETURN (User)
========================= */
exports.requestReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id: orderId } = req.params;
    const { reason, items } = req.body; // items = [{ order_item_id, quantity }]
    const userId = req.user.id;

    // 1. Validate Order
    const [order] = await sequelize.query(
      `SELECT status FROM orders WHERE id = :orderId AND user_id = :userId`,
      {
        replacements: { orderId, userId },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!order) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Usually returns are only for 'Delivered' orders
    // But since statuses might vary, we'll allow it if it's not 'Cancelled' or 'Returned'
    if (['Cancelled', 'Returned'].includes(order.status)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Cannot return a ${order.status} order` });
    }

    // 2. Create Return Request
    const [returnRequest] = await sequelize.query(
      `INSERT INTO order_returns (order_id, user_id, reason, status)
       VALUES (:orderId, :userId, :reason, 'Requested')
       RETURNING id`,
      {
        replacements: { orderId, userId, reason: reason || null },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const returnId = returnRequest[0].id;

    // 3. Add Return Items
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await sequelize.query(
          `INSERT INTO order_return_items (return_id, order_item_id, quantity)
           VALUES (:returnId, :orderItemId, :quantity)`,
          {
            replacements: {
              returnId,
              orderItemId: item.order_item_id,
              quantity: item.quantity
            },
            type: QueryTypes.INSERT,
            transaction: t
          }
        );
      }
    }

    await t.commit();
    res.status(201).json({ success: true, message: 'Return requested successfully', returnId });

  } catch (error) {
    await t.rollback();
    console.error('REQUEST RETURN ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to request return', error: error.message });
  }
};

/* =========================
   APPROVE RETURN (Admin)
========================= */
exports.approveReturn = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id: returnId } = req.params;

    // 1. Get Return & Order Details
    const [returnData] = await sequelize.query(
      `SELECT 
          r.*, 
          o.order_number, o.customer_name, o.customer_phone,
          o.shipping_address_id, o.billing_address_id,
          u.email as user_email
       FROM order_returns r
       JOIN orders o ON o.id = r.order_id
       JOIN users u ON u.id = r.user_id
       WHERE r.id = :returnId`,
      {
        replacements: { returnId },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!returnData) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Return request not found' });
    }

    if (returnData.status !== 'Requested') {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Return is already ${returnData.status}` });
    }

    // 2. Get Return Items
    const returnItems = await sequelize.query(
      `SELECT ri.quantity, oi.name, oi.sku, oi.price
       FROM order_return_items ri
       JOIN order_items oi ON oi.id = ri.order_item_id
       WHERE ri.return_id = :returnId`,
      {
        replacements: { returnId },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    // 3. Get Addresses
    const [shippingAddr] = await sequelize.query(
      `SELECT * FROM order_addresses WHERE id = :id`,
      { replacements: { id: returnData.shipping_address_id }, type: QueryTypes.SELECT, transaction: t }
    );

    const [billingAddr] = await sequelize.query(
      `SELECT * FROM order_addresses WHERE id = :id`,
      { replacements: { id: returnData.billing_address_id }, type: QueryTypes.SELECT, transaction: t }
    );

    if (!shippingAddr || !billingAddr) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Original addresses not found' });
    }

    // 4. Prepare Shiprocket Payload (REVERSE ORDER)
    // Pickup is customer site (shipping_address)
    // Delivery is warehouse (billing_address or custom)
    const warehouseAddress = req.body.warehouse_address || {
      name: billingAddr.full_name,
      address: billingAddr.full_address,
      city: billingAddr.city,
      state: billingAddr.state,
      pincode: billingAddr.pincode,
      email: billingAddr.email,
      phone: billingAddr.phone
    };

    const shiprocketPayload = {
      order_id: `RET-${returnData.order_number}-${returnId}`,
      order_date: new Date().toISOString(),
      channel_id: "",
      pickup_customer_name: shippingAddr.full_name,
      pickup_last_name: "",
      pickup_address: shippingAddr.full_address,
      pickup_address_2: "",
      pickup_city: shippingAddr.city,
      pickup_state: shippingAddr.state,
      pickup_country: "India",
      pickup_pincode: shippingAddr.pincode,
      pickup_email: returnData.user_email,
      pickup_phone: shippingAddr.phone,
      shipping_customer_name: warehouseAddress.name,
      shipping_last_name: "",
      shipping_address: warehouseAddress.address,
      shipping_address_2: "",
      shipping_city: warehouseAddress.city,
      shipping_state: warehouseAddress.state,
      shipping_country: "India",
      shipping_pincode: warehouseAddress.pincode,
      shipping_email: warehouseAddress.email,
      shipping_phone: warehouseAddress.phone,
      order_items: returnItems.map(item => ({
        name: item.name,
        sku: item.sku,
        units: item.quantity,
        selling_price: item.price,
        qc_enable: true,
        qc_size: "Medium"
      })),
      payment_method: "Prepaid",
      sub_total: 0,
      length: 10,
      breadth: 10,
      height: 10,
      weight: 0.5
    };

    // 5. Create Shiprocket Return
    let shiprocketRes;
    try {
      shiprocketRes = await createReturnOrder(shiprocketPayload);
    } catch (srError) {
      console.error('SHIPROCKET RETURN ERROR:', srError);
      // We can decide to either fail here or log it and continue
      // For now, let's fail to ensure return is synced
      await t.rollback();
      return res.status(500).json({ success: false, message: 'Shiprocket return creation failed', error: srError.message });
    }

    // 6. Update local status
    await sequelize.query(
      `UPDATE order_returns SET status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = :returnId`,
      { replacements: { returnId }, type: QueryTypes.UPDATE, transaction: t }
    );

    // Optional: Update main order status
    await sequelize.query(
      `UPDATE orders SET status = 'Return Approved' WHERE id = :orderId`,
      { replacements: { orderId: returnData.order_id }, type: QueryTypes.UPDATE, transaction: t }
    );

    await t.commit();
    res.json({
      success: true,
      message: 'Return approved and Shiprocket order created',
      shiprocket_id: shiprocketRes.order_id,
      shipment_id: shiprocketRes.shipment_id
    });

  } catch (error) {
    await t.rollback();
    console.error('APPROVE RETURN ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to approve return' });
  }
};

/* =========================
   LIST RETURNS (Admin)
========================= */
exports.listReturns = async (req, res) => {
  try {
    const returns = await sequelize.query(
      `SELECT r.*, o.order_number, u.name as user_name
       FROM order_returns r
       JOIN orders o ON o.id = r.order_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: returns });
  } catch (error) {
    console.error('LIST RETURNS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch returns' });
  }
};
