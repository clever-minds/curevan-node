const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const { createReturnOrder } = require('../../services/shiprocketService');
const rules = require('../../config/businessRules');
const refundService = require('../../services/refundService');
const notificationStore = require('../../services/notificationStore');
const affiliateService = require('../../services/affiliateService');

const REASONS = ['damaged', 'defective', 'wrong_item', 'missing_part'];
const PHOTO_REASONS = ['damaged', 'defective'];     // a photo is required for these
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* =========================
   REQUEST RETURN (User)
========================= */
exports.requestReturn = async (req, res) => {
  const t = await sequelize.transaction();
  const refuse = async (status, message) => { await t.rollback(); return res.status(status).json({ success: false, message }); };
  try {
    const { id: orderId } = req.params;
    const { reason, note, photos, items } = req.body || {};      // items = [{ order_item_id, quantity }]
    const userId = req.user.id;

    // 1. the order: yours, delivered, and still inside the return window
    const [order] = await sequelize.query(
      `SELECT o.id, o.status, COALESCE(o.delivered_at, (SELECT MAX(s.delivered_at) FROM shipments s WHERE s.order_id = o.id)) AS delivered_at
       FROM orders o WHERE o.id = :orderId AND o.user_id = :userId`,
      { replacements: { orderId, userId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!order) return refuse(404, 'Order not found');
    if (!order.delivered_at) return refuse(400, 'Returns open once the order has been delivered');
    const days = rules.shop.returnWindowDays;
    if (Date.now() > new Date(order.delivered_at).getTime() + days * 86400000) return refuse(400, `The return window of ${days} days after delivery is over`);

    // 2. the reason, and a photo where the reason needs one
    if (!REASONS.includes(reason)) return refuse(400, `Choose a reason: ${REASONS.join(', ')}`);
    const photoList = Array.isArray(photos) ? photos.filter((x) => x !== null && x !== undefined && String(x).trim() !== '') : [];
    if (PHOTO_REASONS.includes(reason) && photoList.length === 0) return refuse(400, 'Please add a photo of the problem');
    if (!Array.isArray(items) || items.length === 0) return refuse(400, 'Choose the item(s) you want to return');

    // 3. every item: part of this order, not in a category that cannot be returned, quantity still available
    const lines = [];
    for (const it of items) {
      if (!it || !Number.isInteger(Number(it.order_item_id)) || !(Number(it.quantity) >= 1)) return refuse(400, 'Choose the item(s) you want to return');   // a malformed item is the caller's mistake, not a server error
      const [line] = await sequelize.query(
        `SELECT oi.id, oi.name, oi.qty,
                COALESCE((SELECT SUM(ri.quantity) FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
                          WHERE ri.order_item_id = oi.id AND r.status NOT IN ('Rejected', 'Closed')), 0) AS already,
                COALESCE(c.non_returnable, false) AS non_returnable
         FROM order_items oi LEFT JOIN products p ON p.sku = oi.sku LEFT JOIN categories c ON c.id = p.category_id
         WHERE oi.id = :itemId AND oi.order_id = :orderId LIMIT 1`,
        { replacements: { itemId: it.order_item_id, orderId }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!line) return refuse(400, 'One of the items is not part of this order');
      if (line.non_returnable) return refuse(400, `${line.name} cannot be returned (hygiene, custom or perishable item)`);
      const qty = Number(it.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > Number(line.qty) - Number(line.already)) return refuse(400, `You can return at most ${Number(line.qty) - Number(line.already)} of ${line.name}`);
      lines.push({ id: line.id, quantity: qty });
    }

    // 4. the request
    const [returnRequest] = await sequelize.query(
      `INSERT INTO order_returns (order_id, user_id, reason, reason_code, photos, status)
       VALUES (:orderId, :userId, :reason, :code, :photos::jsonb, 'Requested') RETURNING id`,
      { replacements: { orderId, userId, reason: String(note || reason).slice(0, 500), code: reason, photos: JSON.stringify(photoList) }, type: QueryTypes.INSERT, transaction: t }
    );
    const returnId = returnRequest[0].id;
    for (const l of lines) {
      await sequelize.query(`INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES (:returnId, :itemId, :quantity)`, { replacements: { returnId, itemId: l.id, quantity: l.quantity }, type: QueryTypes.INSERT, transaction: t });
    }
    await t.commit();
    notificationStore.notifyRoles(['admin.ecom'], { type: 'return_requested', title: 'New return request', message: `Return #${returnId} was requested (${reason.replace('_', ' ')}).`, link: '/dashboard/ecom-admin/returns' }).catch(() => {});
    return res.status(201).json({ success: true, message: 'Return requested successfully', returnId });
  } catch (error) {
    await t.rollback();
    console.error('REQUEST RETURN ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to request return' });
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
      `UPDATE order_returns SET status = 'Approved', reverse_shipment_id = :sid, updated_at = CURRENT_TIMESTAMP WHERE id = :returnId`,
      { replacements: { returnId, sid: shiprocketRes.shipment_id || null }, type: QueryTypes.UPDATE, transaction: t }
    );

    // Optional: Update main order status
    await sequelize.query(
      `UPDATE orders SET status = 'Return Approved' WHERE id = :orderId`,
      { replacements: { orderId: returnData.order_id }, type: QueryTypes.UPDATE, transaction: t }
    );
    // the commission on the returned lines is void
    const returnedLines = await sequelize.query(`SELECT order_item_id FROM order_return_items WHERE return_id = :returnId`, { replacements: { returnId }, type: QueryTypes.SELECT, transaction: t });
    await affiliateService.cancelFor(returnData.order_id, 'cancelled_returned', { itemIds: returnedLines.map((x) => x.order_item_id), transaction: t });

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


/* =========================
   REJECT RETURN (Admin) - before pickup
========================= */
exports.rejectReturn = async (req, res) => {
  try {
    const reason = String((req.body || {}).reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ success: false, message: 'Please give the reason for rejecting' });
    const rows = await sequelize.query(
      `UPDATE order_returns SET status = 'Rejected', rejection_reason = :reason, updated_at = NOW() WHERE id = :id AND status = 'Requested' RETURNING id, user_id`,
      { replacements: { id: req.params.id, reason: reason.slice(0, 500) }, type: QueryTypes.SELECT }
    );
    if (!rows.length) return res.status(409).json({ success: false, message: 'Only a new return request can be rejected' });
    await notificationStore.notify(rows[0].user_id, { type: 'return', title: 'Your return request was not accepted', message: reason.slice(0, 200), link: '/dashboard/patient/orders' }).catch(() => {});
    return res.json({ success: true, message: 'Return rejected' });
  } catch (error) {
    console.error('REJECT RETURN ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject the return' });
  }
};

/* =========================
   MARK RECEIVED (Admin) - the parcel reached the warehouse (the courier hook does this too)
========================= */
exports.receiveReturn = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `UPDATE order_returns SET status = 'Received', updated_at = NOW() WHERE id = :id AND status IN ('Approved', 'Pickup Scheduled', 'In Transit') RETURNING id`,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );
    if (!rows.length) return res.status(409).json({ success: false, message: 'Only an approved return that is on its way can be marked received' });
    return res.json({ success: true, message: 'Return marked received' });
  } catch (error) {
    console.error('RECEIVE RETURN ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to update the return' });
  }
};

/* =========================
   INSPECT (Admin): pass -> refund through Razorpay, fail -> rejected
========================= */
exports.inspectReturn = async (req, res) => {
  const { result, note } = req.body || {};
  if (!['pass', 'fail'].includes(result)) return res.status(400).json({ success: false, message: "result must be 'pass' or 'fail'" });
  if (result === 'fail' && String(note || '').trim().length < 3) return res.status(400).json({ success: false, message: 'Please say why the item failed the inspection' });

  const t = await sequelize.transaction();
  let ret;
  let amount;
  try {
    [ret] = await sequelize.query(`SELECT * FROM order_returns WHERE id = :id FOR UPDATE`, { replacements: { id: req.params.id }, type: QueryTypes.SELECT, transaction: t });
    if (!ret) { await t.rollback(); return res.status(404).json({ success: false, message: 'Return not found' }); }
    if (ret.status !== 'Received') { await t.rollback(); return res.status(409).json({ success: false, message: 'Only a received return can be inspected' }); }

    if (result === 'fail') {
      await sequelize.query(`UPDATE order_returns SET status = 'Rejected', inspection_result = 'fail', inspected_at = NOW(), rejection_reason = :note, updated_at = NOW() WHERE id = :id`, { replacements: { id: ret.id, note: String(note).trim().slice(0, 500) }, type: QueryTypes.UPDATE, transaction: t });
      await t.commit();
      await notificationStore.notify(ret.user_id, { type: 'return', title: 'Your return did not pass the check', message: String(note).trim().slice(0, 200), link: '/dashboard/patient/orders' }).catch(() => {});
      return res.json({ success: true, message: 'Return rejected after inspection' });
    }

    // refund = the share of what the customer paid for goods (coupon and tax included) that the returned items represent
    const [o] = await sequelize.query(`SELECT total, COALESCE(shipping_charges, 0) AS shipping FROM orders WHERE id = :id`, { replacements: { id: ret.order_id }, type: QueryTypes.SELECT, transaction: t });
    const [v] = await sequelize.query(
      `SELECT COALESCE(SUM(oi.price * oi.qty), 0) AS all_value,
              COALESCE(SUM(oi.price * ri.quantity), 0) AS returned_value
       FROM order_items oi LEFT JOIN order_return_items ri ON ri.order_item_id = oi.id AND ri.return_id = :returnId WHERE oi.order_id = :orderId`,
      { replacements: { orderId: ret.order_id, returnId: ret.id }, type: QueryTypes.SELECT, transaction: t }
    );
    const goodsPaid = Number(o.total) - Number(o.shipping);
    amount = Number(v.all_value) > 0 ? r2((goodsPaid * Number(v.returned_value)) / Number(v.all_value)) : r2(goodsPaid);
    await sequelize.query(`UPDATE order_returns SET status = 'Inspected', inspection_result = 'pass', inspected_at = NOW(), updated_at = NOW() WHERE id = :id`, { replacements: { id: ret.id }, type: QueryTypes.UPDATE, transaction: t });
    await t.commit();
  } catch (error) {
    await t.rollback();
    console.error('INSPECT RETURN ERROR:', error);
    return res.status(500).json({ success: false, message: 'Failed to record the inspection' });
  }

  try {
    const refund = await refundService.refund({ orderId: ret.order_id, returnId: ret.id, amountInr: amount, reason: `Return #${ret.id} passed inspection`, actorId: req.user.id });
    return res.json({ success: true, message: 'Inspection passed. The refund was sent to Razorpay.', refund: { refundId: refund.refundId, amount: refund.amount, status: refund.status } });
  } catch (error) {
    if (error instanceof refundService.RefundError) {
      return res.status(error.status === 404 ? 409 : error.status).json({ success: false, message: `The item passed, but the refund was not made: ${error.message}. Use Refunds to retry.`, inspected: true });
    }
    console.error('RETURN REFUND ERROR:', error);
    return res.status(500).json({ success: false, message: 'The item passed, but the refund failed. Use Refunds to retry.', inspected: true });
  }
};
