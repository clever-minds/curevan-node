const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const {
  createOrder,
  generateAWB,
} = require("../../services/shiprocketService");

/* =========================
   CREATE SHIPMENT
========================= */
exports.createShipment = async (req, res) => {
  const t = await sequelize.transaction();
  const { orderId, actorId, billing_address, shipping_address } = req.body;

  try {
    // 1️⃣ Get Order with existing linked addresses
    const [orderResult] = await sequelize.query(
      `SELECT 
          o.*, 
          ba.full_name AS billing_name, ba.email AS billing_email, ba.phone AS billing_phone, ba.full_address AS billing_address_text, ba.city AS billing_city, ba.state AS billing_state, ba.pincode AS billing_pincode,
          sa.full_name AS shipping_name, sa.email AS shipping_email, sa.phone AS shipping_phone, sa.full_address AS shipping_address_text, sa.city AS shipping_city, sa.state AS shipping_state, sa.pincode AS shipping_pincode
       FROM orders o
       LEFT JOIN order_addresses ba ON o.billing_address_id = ba.id
       LEFT JOIN order_addresses sa ON o.shipping_address_id = sa.id
       WHERE o.id = :orderId`,
      { replacements: { orderId }, type: QueryTypes.SELECT, transaction: t }
    );

    const order = orderResult;
    if (!order) {
      await t.rollback();
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (["Shipped", "Delivered", "Cancelled"].includes(order.status)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Order already ${order.status}` });
    }

    // 2️⃣ Resolve Billing Address
    const finalBilling = {
      name: order.billing_name || billing_address?.full_name,
      email: order.billing_email || billing_address?.email,
      phone: order.billing_phone || billing_address?.phone,
      address: order.billing_address_text || billing_address?.full_address,
      city: order.billing_city || billing_address?.city,
      state: order.billing_state || billing_address?.state,
      pincode: order.billing_pincode || billing_address?.pincode
    };

    if (!finalBilling.name || !finalBilling.address || !finalBilling.pincode) {
      await t.rollback();
      return res.status(400).json({ success: false, message: "Billing address is required (not found in DB or Request)" });
    }

    // 3️⃣ Resolve Shipping Address
    const finalShipping = {
      name: order.shipping_name || shipping_address?.full_name || finalBilling.name,
      email: order.shipping_email || shipping_address?.email || finalBilling.email,
      phone: order.shipping_phone || shipping_address?.phone || finalBilling.phone,
      address: order.shipping_address_text || shipping_address?.full_address || finalBilling.address,
      city: order.shipping_city || shipping_address?.city || finalBilling.city,
      state: order.shipping_state || shipping_address?.state || finalBilling.state,
      pincode: order.shipping_pincode || shipping_address?.pincode || finalBilling.pincode
    };

    // 4️⃣ Prepare Shiprocket Payload
    const orderItems = await getOrderItemsForShiprocket(order.id);
    console.log("🔍 Current Env Pickup Location:", process.env.SHIPROCKET_PICKUP_LOCATION);

    const shiprocketPayload = {
      order_id: order.id.toString(),
      order_date: new Date().toISOString(),
      pickup_location: "work",
      billing_customer_name: finalBilling.name.split(" ")[0] || "Customer",
      billing_last_name: finalBilling.name.split(" ").slice(1).join(" ") || ".",
      billing_address: finalBilling.address,
      billing_city: finalBilling.city,
      billing_state: finalBilling.state,
      billing_country: "IN",
      billing_pincode: finalBilling.pincode.toString(),
      billing_email: finalBilling.email,
      billing_phone: finalBilling.phone.toString(),
      shipping_is_billing: false,
      shipping_customer_name: finalShipping.name.split(" ")[0] || "Customer",
      shipping_last_name: finalShipping.name.split(" ").slice(1).join(" ") || ".",
      shipping_address: finalShipping.address,
      shipping_city: finalShipping.city,
      shipping_state: finalShipping.state,
      shipping_country: "IN",
      shipping_pincode: finalShipping.pincode.toString(),
      shipping_email: finalShipping.email,
      shipping_phone: finalShipping.phone.toString(),
      order_items: orderItems.map(i => ({
        name: i.name,
        sku: i.sku,
        units: i.units,
        selling_price: Number(i.selling_price),
        discount: 0,
        tax: 0
      })),
      payment_method: "Prepaid",
      order_amount: Number(order.total), // Corrected to use order.total
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: Number(order.total),
      length: 10,
      breadth: 15,
      height: 20,
      weight: 2.5
    };

    // 4️⃣ Call Shiprocket API
    console.log("🚀 Sending Payload to Shiprocket:", JSON.stringify(shiprocketPayload, null, 2));
    const shiprocketOrder = await createOrder(shiprocketPayload);
    
    // Shiprocket adhoc creation usually returns shipment_id directly in the response 
    // but sometimes it might be nested in a 'response' object.
    const shipmentId = shiprocketOrder.shipment_id || shiprocketOrder.response?.shipment_id || shiprocketOrder.order_id || shiprocketOrder.response?.order_id;

    console.log(`📦 Shiprocket ID Captured: ${shipmentId} (Type: ${typeof shipmentId})`);

    if (!shipmentId) {
      console.error("❌ Shiprocket Response Error: No shipment_id or order_id found.", shiprocketOrder);
      await t.rollback();
      return res.status(400).json({ success: false, message: "Shiprocket failed to return a shipment ID", details: shiprocketOrder });
    }

    // 5️⃣ Generate AWB
    console.log(`🚚 Requesting AWB for Shipment ID: ${shipmentId}`);
    const awbData = await generateAWB(shipmentId);
    console.log("📍 AWB Response Data:", JSON.stringify(awbData, null, 2));

    const awb = awbData?.awb_code || null;
    const courier = awbData?.courier_name || "Unknown Courier";

    if (!awb) {
      console.error("❌ No AWB code returned from Shiprocket", awbData);
      // We might want to throw an error here or handle it differently
      throw new Error("Shiprocket failed to assign an AWB code. Please check Shiprocket panel for shipment ID: " + shipmentId);
    }

    // 6️⃣ Insert Shipment
    const [shipmentInsert] = await sequelize.query(
      `INSERT INTO shipments 
        (order_id, awb, carrier, status, created_at, eta, provider, shiprocket_shipment_id)
        VALUES 
        (:orderId, :awb, :carrier, :status, :createdAt, :eta, :provider, :shiprocketShipmentId)
        RETURNING id`,
      {
        replacements: {
          orderId: order.id,
          awb,
          carrier: courier,
          status: "Pending Pickup",
          createdAt: new Date(),
          eta: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          provider: "shiprocket",
          shiprocketShipmentId: shipmentId
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const shipmentDbId = shipmentInsert[0].id;

    // 7️⃣ Update Order Status
    await sequelize.query(
      `UPDATE orders SET status = 'Packed' WHERE id = :orderId`,
      { replacements: { orderId: order.id }, type: QueryTypes.UPDATE, transaction: t }
    );

    // 8️⃣ Audit Log
    await sequelize.query(
      `INSERT INTO audit_logs
        (actor_id, action, entity_type, entity_id, details)
       VALUES
        (:actorId, :action, :entityType, :entityId, :details)`,
      {
        replacements: {
          actorId: actorId || "system",
          action: "shipment.created",
          entityType: "shipment",
          entityId: shipmentDbId,
          details: JSON.stringify({ orderId: order.id, awb, carrier: courier })
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    await t.commit();

    return res.status(201).json({
      success: true,
      message: "Shipment Created",
      data: { shipmentId: shipmentDbId, awb, carrier: courier, trackingUrl: `https://shiprocket.co/tracking/${awb}` }
    });

  } catch (error) {
    await t.rollback();
    console.error("❌ Shipment Error Details:", JSON.stringify(error.response?.data, null, 2) || error.message);
    return res.status(500).json({ success: false, message: "Shipment failed", error: error.message, details: error.response?.data });
  }
};

// Helper function
async function getOrderItemsForShiprocket(orderId) {
  const items = await sequelize.query(
    `SELECT sku, name, qty AS units, price AS selling_price 
     FROM order_items 
     WHERE order_id = :orderId`,
    { replacements: { orderId }, type: QueryTypes.SELECT }
  );

  return items.map(i => ({
    name: i.name,
    sku: i.sku,
    units: i.units,
    selling_price: i.selling_price,
    discount: 0,
    tax: 0
  }));
}
/* =========================
   LIST SHIPMENTS
========================= */
exports.listShipments = async (req, res) => {
  try {
    const shipments = await sequelize.query(
      `SELECT s.*, o.customer_name 
       FROM shipments s
       LEFT JOIN orders o ON o.id = s.order_id
       ORDER BY s.created_at DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.json({ success: true, data: shipments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   GET SHIPMENT BY ID
========================= */
exports.getShipmentById = async (req, res) => {
  try {
    const shipment = await sequelize.query(
      `SELECT * FROM shipments WHERE id = :id`,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT }
    );

    if (!shipment.length) {
      return res.status(404).json({ success: false, message: "Shipment not found" });
    }

    return res.json({ success: true, data: shipment[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   TRACK SHIPMENT
========================= */
exports.trackShipment = async (req, res) => {
  const { awb } = req.params;

  try {
    const shipment = await sequelize.query(
      `SELECT * FROM shipments WHERE awb = :awb`,
      { replacements: { awb }, type: QueryTypes.SELECT }
    );

    if (!shipment.length) {
      return res.status(404).json({ success: false, message: "Shipment not found" });
    }

    return res.json({
      success: true,
      data: { ...shipment[0], trackingUrl: `https://shiprocket.co/tracking/${awb}` },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   CANCEL SHIPMENT
========================= */
exports.cancelShipment = async (req, res) => {
  try {
    await sequelize.query(
      `UPDATE shipments SET status = 'Cancelled' WHERE id = :id`,
      { replacements: { id: req.params.id }, type: QueryTypes.UPDATE }
    );

    return res.json({ success: true, message: "Shipment Cancelled" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   ESTIMATE SHIPPING
========================= */
const { checkServiceability, getPickupLocations } = require("../../services/shiprocketService");

exports.estimateShipping = async (req, res) => {
  try {
    const { pincode, weight = 0.5 } = req.query;
    console.log(`🔍 Estimating shipping for pincode: ${pincode}, weight: ${weight}`);

    if (!pincode) {
      return res.status(400).json({ success: false, message: "Pincode is required" });
    }

    const locations = await getPickupLocations();
    console.log("📍 Pickup Locations response:", JSON.stringify(locations));
    const loc = locations?.data?.shipping_address?.[0];
    const pickup_postcode = loc?.pin_code;

    if (!pickup_postcode) {
      console.error("❌ Pickup location not found in Shiprocket settings");
      return res.status(500).json({ success: false, message: "Pickup location not configured" });
    }

    console.log(`🚚 Calling Shiprocket serviceability from ${pickup_postcode} to ${pincode}`);
    const serviceability = await checkServiceability({
      pickup_postcode,
      delivery_postcode: pincode,
      weight: weight.toString(),
      cod: 0
    });

    console.log("📦 Serviceability response:", JSON.stringify(serviceability));

    const companies = serviceability?.data?.available_courier_companies || [];
    if (companies.length === 0) {
      console.warn(`⚠️ No couriers available for pincode ${pincode}`);
      return res.status(404).json({ success: false, message: "No courier service available for this pincode" });
    }

    const recommendedId = serviceability.data.recommended_courier_company_id;
    const recommendedCourier = companies.find(c => c.courier_company_id === recommendedId) || companies[0];

    return res.json({
      success: true,
      data: {
        rate: recommendedCourier.rate,
        courier: recommendedCourier.courier_name,
        estimated_delivery: recommendedCourier.etd,
        all_options: companies.map(c => ({
          name: c.courier_name,
          rate: c.rate,
          etd: c.etd
        }))
      }
    });
  } catch (error) {
    console.error("Estimation Error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to estimate shipping charges", error: error.message });
  }
};

