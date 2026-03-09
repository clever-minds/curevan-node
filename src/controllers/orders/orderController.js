const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

// exports.createOrderFromCart = async (req, res) => {
//   const transaction = await sequelize.transaction();

//   try {
//     const userId = req.user.id;

//     const {
//       billing_address_id,
//       shipping_address_id,
//       coupon_code,
//       referred_therapist_id,
//       // ✅ Payment data
//       payment_status,
//       payment_ref,
//       payment_gateway,
//       currency
//     } = req.body;

//     // 1️⃣ Get Cart Items
//     const cartItems = await sequelize.query(
//       `SELECT 
//          c.product_id,
//          c.quantity,
//          p.title,
//          p.selling_price,
//          p.mrp,
//          p.sku,
//          p.hsn_code,
//          p.gst_slab
//        FROM cart c
//        JOIN products p ON c.product_id = p.id
//        WHERE c.user_id = :userId`,
//       {
//         replacements: { userId },
//         type: QueryTypes.SELECT,
//         transaction
//       }
//     );
//     if (!cartItems.length) {
//       await transaction.rollback();
//       return res.error("Cart is empty");
//     }

//     // 2️⃣ Calculate totals
//     let subtotal = 0;
//     let totalTax = 0;

//     cartItems.forEach(item => {
//       const itemTotal = item.selling_price * item.quantity;
//       subtotal += itemTotal;

//       const tax = itemTotal * (item.gst_slab || 0) / 100;
//       totalTax += tax;
//     });

//     let couponDiscount = 0;
//     if (coupon_code) {
//       couponDiscount = Math.floor(subtotal * 0.05);
//     }

//     const taxableValue = subtotal - couponDiscount;
//     const total = taxableValue + totalTax;

//     // 3️⃣ Generate Order Number
//     const orderNumber = "ORD-" + Date.now();

//     // 4️⃣ Insert Order
//     const [order] = await sequelize.query(
//       `INSERT INTO orders (
//          order_number,
//          user_id,
//          customer_name,
//          customer_phone,
//          billing_address_id,
//          shipping_address_id,
//          subtotal,
//          coupon_discount,
//          taxable_value,
//          total_tax,
//          total,
//          status,
//          payment_status,
//          referred_therapist_id,
//          created_at
//        ) VALUES (
//          :orderNumber,
//          :userId,
//          :customerName,
//          :customerPhone,
//          :billingAddressId,
//          :shippingAddressId,
//          :subtotal,
//          :couponDiscount,
//          :taxableValue,
//          :totalTax,
//          :total,
//          'Pending',
//          :paymentStatus,
//          :referredTherapistId,
//          CURRENT_TIMESTAMP
//        )
//        RETURNING id`,
//       {
//         replacements: {
//           orderNumber,
//           userId,
//           customerName: req.user.name || "Customer",
//           customerPhone: req.user.phone || "",
//           billingAddressId: billing_address_id,
//           shippingAddressId: shipping_address_id,
//           subtotal,
//           couponDiscount,
//           taxableValue,
//           totalTax,
//           total,
//           paymentStatus: payment_status || "Unpaid",
//           referredTherapistId: referred_therapist_id || null
//         },
//         type: QueryTypes.INSERT,
//         transaction
//       }
//     );

//     const orderId = order[0].id;

//     // 5️⃣ Insert Order Items
//     for (let item of cartItems) {
//       await sequelize.query(
//         `INSERT INTO order_items (
//            order_id,
//            sku,
//            name,
//            qty,
//            price,
//            mrp,
//            hsn_code,
//            tax_rate_pct
//          ) VALUES (
//            :orderId,
//            :sku,
//            :name,
//            :qty,
//            :price,
//            :mrp,
//            :hsnCode,
//            :taxRate
//          )`,
//         {
//           replacements: {
//             orderId,
//             sku: item.sku,
//             name: item.title,
//             qty: item.quantity,
//             price: item.selling_price,
//             mrp: item.mrp,
//             hsnCode: item.hsn_code,
//             taxRate: item.gst_slab
//           },
//           type: QueryTypes.INSERT,
//           transaction
//         }
//       );
//     }

//     // 6️⃣ Insert Payment (Only if Paid)
//     if (payment_status === "Paid") {

//       const txnId = "txn-" + Date.now();

//       await sequelize.query(
//         `INSERT INTO payment_transactions (
//            txn_id,
//            ref,
//            user_id,
//            order_id,
//            amount,
//            currency,
//            status,
//            gateway,
//            created_at
//          ) VALUES (
//            :txnId,
//            :ref,
//            :userId,
//            :orderId,
//            :amount,
//            :currency,
//            'paid',
//            :gateway,
//            CURRENT_TIMESTAMP
//          )`,
//         {
//           replacements: {
//             txnId,
//             ref: payment_ref,
//             userId,
//             orderId,
//             amount: total,
//             currency: currency || "INR",
//             gateway: payment_gateway || "razorpay"
//           },
//           type: QueryTypes.INSERT,
//           transaction
//         }
//       );
//     }

//     // 7️⃣ Clear Cart
//     await sequelize.query(
//       `DELETE FROM cart WHERE user_id = :userId`,
//       {
//         replacements: { userId },
//         type: QueryTypes.DELETE,
//         transaction
//       }
//     );

//     await transaction.commit();

//     return res.success(
//       {
//         orderId,
//         orderNumber,
//         subtotal,
//         totalTax,
//         total,
//         paymentStatus: payment_status || "Unpaid"
//       },
//       "Order created successfully"
//     );

//   } catch (error) {
//     console.error(error);
//     await transaction.rollback();
//     return res.error("Failed to create order");
//   }
// };


// GET /api/orders/my-orders


// exports.createOrderFromCart = async (req, res) => {
//   const transaction = await sequelize.transaction();

//   try {
//     const userId = req.user.id;

//     const {
//       billing_address_id,
//       shipping_address_id,
//       coupon_code,
//       coupon_id,
//       referred_therapist_id,
//       payment_status,
//       payment_ref,
//       payment_gateway,
//       currency
//     } = req.body;

//     // 1️⃣ Get Cart Items
//     const cartItems = await sequelize.query(
//       `SELECT 
//          c.product_id,
//          c.quantity,
//          p.title,
//          p.selling_price,
//          p.mrp,
//          p.sku,
//          p.hsn_code,
//          p.gst_slab
//        FROM cart c
//        JOIN products p ON c.product_id = p.id
//        WHERE c.user_id = :userId`,
//       {
//         replacements: { userId },
//         type: QueryTypes.SELECT,
//         transaction
//       }
//     );

//     if (!cartItems.length) {
//       await transaction.rollback();
//       return res.status(400).json({ error: "Cart is empty" });
//     }

//     // 2️⃣ Shipping & Tax
//     const WAREHOUSE_STATE = "Gujarat";
//     const shippingAddress = await sequelize.query(
//       `SELECT state FROM order_addresses WHERE id = :id`,
//       {
//         replacements: { id: shipping_address_id },
//         type: QueryTypes.SELECT,
//         transaction
//       }
//     );

//     const isIntraState = shippingAddress.length && shippingAddress[0].state === WAREHOUSE_STATE;

//     let subtotal = 0;
//     let totalTax = 0;
//     let cgst = 0;
//     let sgst = 0;
//     let igst = 0;
//     let taxableValue = 0;

//     cartItems.forEach(item => {
//       const itemTotal = item.selling_price * item.quantity;
//       subtotal += itemTotal;

//       const itemTaxable = itemTotal / (1 + ((item.gst_slab || 0) / 100));
//       const itemTax = itemTotal - itemTaxable;

//       taxableValue += itemTaxable;
//       totalTax += itemTax;

//       if (isIntraState) {
//         cgst += itemTax / 2;
//         sgst += itemTax / 2;
//       } else {
//         igst += itemTax;
//       }
//     });

//     // 3️⃣ Coupon Discount
//     let couponDiscount = 0;
//     if (coupon_code) {
//       couponDiscount = Math.floor(subtotal * 0.05); // example: 5% discount
//     }

//     const finalTaxableValue = taxableValue - couponDiscount;
//     const total = finalTaxableValue + totalTax;
//     const totalInPaise = Math.round(total * 100);

//     // 4️⃣ Generate Order Number
//     const orderNumber = "ORD-" + Date.now();

//     // 5️⃣ Insert Order
//     const [order] = await sequelize.query(
//       `INSERT INTO orders (
//          order_number,
//          user_id,
//          customer_name,
//          customer_phone,
//          billing_address_id,
//          shipping_address_id,
//          subtotal,
//          coupon_id,
//          coupon_code,
//          coupon_discount,
//          taxable_value,
//          cgst,
//          sgst,
//          igst,
//          total_tax,
//          total,
//          status,
//          payment_status,
//          referred_therapist_id,
//          created_at
//        ) VALUES (
//          :orderNumber,
//          :userId,
//          :customerName,
//          :customerPhone,
//          :billingAddressId,
//          :shippingAddressId,
//          :subtotal,
//          :couponId,
//          :couponCode,
//          :couponDiscount,
//          :taxableValue,
//          :cgst,
//          :sgst,
//          :igst,
//          :totalTax,
//          :total,
//          'Pending',
//          :paymentStatus,
//          :referredTherapistId,
//          CURRENT_TIMESTAMP
//        )
//        RETURNING id`,
//       {
//         replacements: {
//           orderNumber,
//           userId,
//           customerName: req.user.name || "Customer",
//           customerPhone: req.user.phone || "",
//           billingAddressId: billing_address_id,
//           shippingAddressId: shipping_address_id,
//           subtotal,
//           couponId: coupon_id || null,
//           couponCode: coupon_code || null,
//           couponDiscount,
//           taxableValue: finalTaxableValue,
//           cgst,
//           sgst,
//           igst,
//           totalTax,
//           total,
//           paymentStatus: payment_status || "Unpaid",
//           referredTherapistId: referred_therapist_id || null
//         },
//         type: QueryTypes.INSERT,
//         transaction
//       }
//     );

//     const orderId = order[0].id;

//     // 6️⃣ Insert Order Items
//     for (let item of cartItems) {
//       await sequelize.query(
//         `INSERT INTO order_items (
//            order_id,
//            sku,
//            name,
//            qty,
//            price,
//            mrp,
//            hsn_code,
//            tax_rate_pct
//          ) VALUES (
//            :orderId,
//            :sku,
//            :name,
//            :qty,
//            :price,
//            :mrp,
//            :hsnCode,
//            :taxRate
//          )`,
//         {
//           replacements: {
//             orderId,
//             sku: item.sku,
//             name: item.title,
//             qty: item.quantity,
//             price: item.selling_price,
//             mrp: item.mrp,
//             hsnCode: item.hsn_code,
//             taxRate: item.gst_slab
//           },
//           type: QueryTypes.INSERT,
//           transaction
//         }
//       );
//     }

//     // 7️⃣ Insert Payment Transaction
//     const txnId = "txn-" + Date.now();
//     await sequelize.query(
//       `INSERT INTO payment_transactions (
//          txn_id,
//          ref,
//          user_id,
//          order_id,
//          amount,
//          currency,
//          status,
//          gateway,
//          created_at
//        ) VALUES (
//          :txnId,
//          :ref,
//          :userId,
//          :orderId,
//          :amount,
//          :currency,
//          :status,
//          :gateway,
//          CURRENT_TIMESTAMP
//        )`,
//       {
//         replacements: {
//           txnId,
//           ref: orderNumber,
//           userId,
//           orderId,
//           amount: totalInPaise,
//           currency: currency || "INR",
//           status: payment_status === "Paid" ? "paid" : "pending",
//           gateway: payment_gateway || "razorpay"
//         },
//         type: QueryTypes.INSERT,
//         transaction
//       }
//     );

//     // 8️⃣ Clear Cart
//     await sequelize.query(
//       `DELETE FROM cart WHERE user_id = :userId`,
//       {
//         replacements: { userId },
//         type: QueryTypes.DELETE,
//         transaction
//       }
//     );

//     await transaction.commit();

//     return res.json({
//       success: true,
//       message: "Order created successfully with GST",
//       data: {
//         orderId,
//         orderNumber,
//         subtotal,
//         taxableValue: finalTaxableValue,
//         cgst,
//         sgst,
//         igst,
//         totalTax,
//         total,
//         paymentStatus: payment_status || "Unpaid"
//       }
//     });

//   } catch (error) {
//     console.error(error);
//     await transaction.rollback();
//     return res.status(500).json({ error: "Failed to create order" });
//   }
// };


exports.createOrderFromCart = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.id;

    const {
      billing_address_id,
      shipping_address_id,
      coupon_code,
      coupon_id,
      referred_therapist_id,
      payment_status,
      payment_ref,
      payment_gateway,
      currency
    } = req.body;

    // 1️⃣ Get Cart Items
    const cartItems = await sequelize.query(
      `SELECT 
         c.product_id,
         c.quantity,
         p.title,
         p.selling_price,
         p.mrp,
         p.sku,
         p.hsn_code,
         p.gst_slab
       FROM cart c
       JOIN products p ON c.product_id = p.id
       WHERE c.user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (!cartItems.length) {
      await transaction.rollback();
      return res.status(400).json({ error: "Cart is empty" });
    }

    // 2️⃣ Shipping & Tax
    const WAREHOUSE_STATE = "Gujarat";
    const shippingAddress = await sequelize.query(
      `SELECT state FROM order_addresses WHERE id = :id`,
      {
        replacements: { id: shipping_address_id },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    const isIntraState = shippingAddress.length && shippingAddress[0].state === WAREHOUSE_STATE;

    let subtotal = 0;
    let totalTax = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let taxableValue = 0;

    cartItems.forEach(item => {
      const itemTotal = item.selling_price * item.quantity;
      subtotal += itemTotal;

      const itemTaxable = itemTotal / (1 + ((item.gst_slab || 0) / 100));
      const itemTax = itemTotal - itemTaxable;

      taxableValue += itemTaxable;
      totalTax += itemTax;

      if (isIntraState) {
        cgst += itemTax / 2;
        sgst += itemTax / 2;
      } else {
        igst += itemTax;
      }
    });

    // 3️⃣ Coupon Discount
    let couponDiscount = 0;
    if (coupon_code) {
      couponDiscount = Math.floor(subtotal * 0.05);
    }

    const finalTaxableValue = taxableValue - couponDiscount;
    const total = finalTaxableValue + totalTax;
    const totalInPaise = Math.round(total * 100);

    // 4️⃣ Generate Order Number
    const orderNumber = "ORD-" + Date.now();

    // 5️⃣ Insert Order
    const [order] = await sequelize.query(
      `INSERT INTO orders (
         order_number,
         user_id,
         customer_name,
         customer_phone,
         billing_address_id,
         shipping_address_id,
         subtotal,
         coupon_id,
         coupon_code,
         coupon_discount,
         taxable_value,
         cgst,
         sgst,
         igst,
         total_tax,
         total,
         status,
         payment_status,
         referred_therapist_id,
         created_at
       ) VALUES (
         :orderNumber,
         :userId,
         :customerName,
         :customerPhone,
         :billingAddressId,
         :shippingAddressId,
         :subtotal,
         :couponId,
         :couponCode,
         :couponDiscount,
         :taxableValue,
         :cgst,
         :sgst,
         :igst,
         :totalTax,
         :total,
         'Pending',
         :paymentStatus,
         :referredTherapistId,
         CURRENT_TIMESTAMP
       )
       RETURNING id`,
      {
        replacements: {
          orderNumber,
          userId,
          customerName: req.user.name || "Customer",
          customerPhone: req.user.phone || "",
          billingAddressId: billing_address_id,
          shippingAddressId: shipping_address_id,
          subtotal,
          couponId: coupon_id || null,
          couponCode: coupon_code || null,
          couponDiscount,
          taxableValue: finalTaxableValue,
          cgst,
          sgst,
          igst,
          totalTax,
          total,
          paymentStatus: payment_status || "Unpaid",
          referredTherapistId: referred_therapist_id || null
        },
        type: QueryTypes.INSERT,
        transaction
      }
    );

    const orderId = order[0].id;

    // 6️⃣ Insert Order Items
    for (let item of cartItems) {
      await sequelize.query(
        `INSERT INTO order_items (
           order_id,
           sku,
           name,
           qty,
           price,
           mrp,
           hsn_code,
           tax_rate_pct
         ) VALUES (
           :orderId,
           :sku,
           :name,
           :qty,
           :price,
           :mrp,
           :hsnCode,
           :taxRate
         )`,
        {
          replacements: {
            orderId,
            sku: item.sku,
            name: item.title,
            qty: item.quantity,
            price: item.selling_price,
            mrp: item.mrp,
            hsnCode: item.hsn_code,
            taxRate: item.gst_slab
          },
          type: QueryTypes.INSERT,
          transaction
        }
      );
    }

    // 7️⃣ Insert Payment Transaction
    const txnId = "txn-" + Date.now();
    await sequelize.query(
      `INSERT INTO payment_transactions (
         txn_id,
         ref,
         user_id,
         order_id,
         amount,
         currency,
         status,
         gateway,
         created_at
       ) VALUES (
         :txnId,
         :ref,
         :userId,
         :orderId,
         :amount,
         :currency,
         :status,
         :gateway,
         CURRENT_TIMESTAMP
       )`,
      {
        replacements: {
          txnId,
          ref: orderNumber,
          userId,
          orderId,
          amount: totalInPaise,
          currency: currency || "INR",
          status: payment_status === "Paid" ? "paid" : "pending",
          gateway: payment_gateway || "razorpay"
        },
        type: QueryTypes.INSERT,
        transaction
      }
    );

    // 8️⃣ Create Invoice
  const invoiceNumber = `INV-${orderId}`;

const [invoice] = await sequelize.query(
  `INSERT INTO invoices (
     invoice_number,
     invoice_type,
     status,
     user_id,
     order_id,
     total_amount_paise,
     cgst_amount,
     sgst_amount,
     igst_amount,
     issued_at
   ) VALUES (
     :invoiceNumber,
     'order',
     'issued',
     :userId,
     :orderId,
     :totalAmountPaise,
     :cgst,
     :sgst,
     :igst,
     CURRENT_TIMESTAMP
   )
   RETURNING id`,
  {
    replacements: {
      invoiceNumber,
      userId,
      orderId,
      totalAmountPaise: totalInPaise,
      cgst,
      sgst,
      igst
    },
    type: QueryTypes.INSERT,
    transaction
  }
);
const invoiceId = invoice[0].id;

    //  🔟 Clear Cart
    await sequelize.query(
      `DELETE FROM cart WHERE user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.DELETE,
        transaction
      }
    );

    await transaction.commit();

    return res.json({
      success: true,
      message: "Order & Invoice created successfully with GST",
      data: {
        orderId,
        orderNumber,
        invoiceId,
        invoiceNumber,
        subtotal,
        taxableValue: finalTaxableValue,
        cgst,
        sgst,
        igst,
        totalTax,
        total,
        paymentStatus: payment_status || "Unpaid"
      }
    });

  } catch (error) {
    console.error(error);
    await transaction.rollback();
    return res.status(500).json({ error: "Failed to create order" });
  }
};

exports.myOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role; // 'admin' ya 'user'

    let query = `
      SELECT 
        o.id,
        u.name AS "customerName",
        o.order_number AS "number",
        o.total,
        o.cgst,
        o.sgst,
        o.igst,
        o.coupon_code AS "couponCode",
        o.taxable_value AS "taxableValue",
        o.coupon_discount AS "couponDiscount",
        o.subtotal,
        o.status,
        o.payment_status AS "paymentStatus",
        o.created_at AS "createdAt",
        -- Invoice info
        i.id AS "invoiceId",
        i.invoice_number AS "invoiceNumber",
        i.status AS "invoiceStatus",
        i.total_amount_paise AS "invoiceAmountPaise",
        i.issued_at AS "invoiceIssuedAt",
        -- Billing & Shipping Address
        json_build_object(
            'id', oa_shipping.id,
            'name', oa_shipping.full_name,
            'full_address', oa_shipping.full_address,
            'city', oa_shipping.city,
            'state', oa_shipping.state,
            'pincode', oa_shipping.pincode,
            'phone', oa_shipping.phone
        ) AS "shippingAddress",
        -- Items
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', oi.id,
              'sku', oi.sku,
              'name', oi.name,
              'qty', oi.qty,
              'price', oi.price,
              'mrp', oi.mrp,
              'hsnCode', oi.hsn_code,
              'taxRate', oi.tax_rate_pct
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      -- Join order_items
      LEFT JOIN order_items oi ON o.id = oi.order_id
      -- Join order_addresses table for billing & shipping
      LEFT JOIN order_addresses oa_billing 
        ON o.billing_address_id = oa_billing.id
      LEFT JOIN order_addresses oa_shipping 
        ON o.shipping_address_id = oa_shipping.id
      -- Join invoices
      LEFT JOIN invoices i ON o.id = i.order_id
       LEFT JOIN users u ON o.user_id = u.id
    `;

    // Role based filtering
    if (userRole === 'admin') {
      query += ` GROUP BY o.id, oa_billing.id, oa_shipping.id, i.id,u.name ORDER BY o.id DESC`;
    } else {
      query += ` WHERE o.user_id = :userId GROUP BY o.id, oa_billing.id, oa_shipping.id, i.id,u.name ORDER BY o.id DESC`;
    }

    const orders = await sequelize.query(query, {
      replacements: { userId },
      type: QueryTypes.SELECT,
    });

    return res.success(orders, "Orders fetched successfully");
  } catch (error) {
    console.log(error);
    return res.error("Failed to fetch orders");
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    const order = await sequelize.query(
      `
      SELECT 
        o.id,
        o.user_id,
        o.order_number AS "orderNumber",
        subtotal,
        o.total ,
        o.status,
        o.cgst,
        o.sgst,
        o.igst,
        o.coupon_discount as "couponDiscount",
        o.payment_status AS "paymentStatus",
        o.created_at AS "createdAt",

        -- Shipping Address
        json_build_object(
          'id', sa.id,
          'name', sa.full_name,
          'address', sa.full_address,
          'city', sa.city,
          'state', sa.state,
          'pincode', sa.pincode,
          'phone', sa.phone
        ) AS "shippingAddress",

        -- Billing Address
        json_build_object(
            'id', ba.id,
            'name', ba.full_name,
            'address', ba.full_address,
            'city', ba.city,
            'state', ba.state,
            'pincode', ba.pincode,
            'phone', ba.phone
        ) AS "billingAddress",

        -- Invoice
        json_build_object(
          'id', i.id,
          'invoiceNumber', i.invoice_number,
          'status', i.status,
          'issuedAt', i.issued_at,
          'amountPaise', i.total_amount_paise
        ) AS "invoice",

        -- Items
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', oi.id,
              'sku', oi.sku,
              'name', oi.name,
              'qty', oi.qty,
              'price', oi.price,
              'mrp', oi.mrp,
              'taxRatePct', oi.tax_rate_pct
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items

      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN order_addresses sa ON o.shipping_address_id = sa.id
      LEFT JOIN order_addresses ba ON o.billing_address_id = ba.id
      LEFT JOIN invoices i ON o.id = i.order_id

      WHERE o.id = :orderId
      GROUP BY o.id, sa.id, ba.id, i.id
      `,
      {
        replacements: { orderId },
        type: QueryTypes.SELECT,
      }
    );

    if (!order.length) {
      return res.error("Order not found", 404);
    }

    const orderData = order[0];

    // 🔐 Access Control
    if (userRole !== "admin" && orderData.user_id !== userId) {
      return res.error("Forbidden", 403);
    }

    return res.success(orderData, "Order fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Server error", 500);
  }
};


exports.getInvoiceById = async (req, res) => {
  try {
    console.log("req.params.id inv",req.params.id);
    const invoiceId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // 1️⃣ Get Invoice
    const invoice = await sequelize.query(
      `SELECT * FROM invoices WHERE id = :invoiceId`,
      {
        replacements: { invoiceId },
        type: QueryTypes.SELECT,
      }
    );

    if (!invoice.length) {
      return res.error("Invoice not found");
    }

    const invoiceData = invoice[0];

    // 2️⃣ Role based access control
    if (userRole !== "admin" && invoiceData.user_id !== userId) {
      return res.error("Forbidden");
    }

    // 3️⃣ If Order Invoice
    if (invoiceData.order_id) {
      const order = await sequelize.query(
        `SELECT o.*, o.id as "orderId",
                COALESCE(
                  json_agg(
                    jsonb_build_object(
                      'id', oi.id,
                      'name', oi.name,
                      'qty', oi.qty,
                      'price', oi.price
                    )
                  ) FILTER (WHERE oi.id IS NOT NULL),
                  '[]'
                ) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         WHERE o.id = :orderId
         GROUP BY o.id`,
        {
          replacements: { orderId: invoiceData.order_id },
          type: QueryTypes.SELECT,
        }
      );

      return res.success(
        {
          invoice: invoiceData,
          source: order[0] || null,
          type: "order",
        },
        "Invoice fetched successfully"
      );
    }

    // 4️⃣ If Booking Invoice
    if (invoiceData.booking_id) {
      const booking = await sequelize.query(
        `SELECT * , id as "bookingId" FROM bookings WHERE id = :bookingId`,
        {
          replacements: { bookingId: invoiceData.booking_id },
          type: QueryTypes.SELECT,
        }
      );

      return res.success(
        {
          invoice: invoiceData,
          source: booking[0] || null,
          type: "booking",
        },
        "Invoice fetched successfully"
      );
    }

    return res.error("Invalid invoice source");

  } catch (error) {
    console.error(error);
    return res.error("Server error");
  }
};
