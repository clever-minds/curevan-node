const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const transporter = require("../../config/mailer");
const { checkServiceability, getPickupLocations } = require("../../services/shiprocketService");

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


//------- bk 31-03-2026

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
//       currency,
//       coupon_discount
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
//       couponDiscount =coupon_discount;
//     }

//     const finalTaxableValue = subtotal - couponDiscount;
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

//     // 8️⃣ Create Invoice
//   const invoiceNumber = `INV-${orderId}`;

// const [invoice] = await sequelize.query(
//   `INSERT INTO invoices (
//      invoice_number,
//      invoice_type,
//      status,
//      user_id,
//      order_id,
//      total_amount_paise,
//      cgst_amount,
//      sgst_amount,
//      igst_amount,
//      issued_at
//    ) VALUES (
//      :invoiceNumber,
//      'order',
//      'issued',
//      :userId,
//      :orderId,
//      :totalAmountPaise,
//      :cgst,
//      :sgst,
//      :igst,
//      CURRENT_TIMESTAMP
//    )
//    RETURNING id`,
//   {
//     replacements: {
//       invoiceNumber,
//       userId,
//       orderId,
//       totalAmountPaise: totalInPaise,
//       cgst,
//       sgst,
//       igst
//     },
//     type: QueryTypes.INSERT,
//     transaction
//   }
// );
// const invoiceId = invoice[0].id;

//     //  🔟 Clear Cart
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
//       message: "Order & Invoice created successfully with GST",
//       data: {
//         orderId,
//         orderNumber,
//         invoiceId,
//         invoiceNumber,
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
//-----------


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
      currency,
      coupon_discount,
      shipping_charges
    } = req.body;

    const cartItems = await sequelize.query(
      `SELECT q.*, 
        CASE 
          WHEN q.offer IS NOT NULL THEN
            CASE 
              WHEN q.offer->>'type' = 'percent' OR q.offer->>'type' = 'percentage' THEN 
                ROUND(q.price * (1 - CAST(q.offer->>'value' AS NUMERIC) / 100.0), 2)
              WHEN q.offer->>'type' IN ('flat', 'fixed') THEN 
                GREATEST(0::numeric, ROUND(q.price - CAST(q.offer->>'value' AS NUMERIC), 2))
              ELSE q.price
            END
          ELSE q.price
        END AS "discountedPrice"
      FROM (
        SELECT 
         c.product_id,
         c.quantity,
         c.variant_id,
         p.title,
         p.product_type,
         COALESCE(pv.selling_price, p.selling_price) AS selling_price,
         COALESCE(pv.selling_price, p.selling_price) AS price,
         p.category_id,
         COALESCE(pv.mrp, p.mrp) AS mrp,
         COALESCE(pv.sku, p.sku) AS sku,
         p.hsn_code,
         p.gst_slab,
         p.is_tax_inclusive,
         p.weight_kg,
         (
          SELECT jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'type', o.type,
            'value', o.value,
            'scope', o.scope,
            'description', o.description
          )
          FROM offers o
          WHERE o.is_active = true 
            AND (o.valid_from IS NULL OR o.valid_from <= CURRENT_DATE)
            AND (o.valid_to IS NULL OR o.valid_to >= CURRENT_DATE)
            AND (
              (o.scope = 'product' AND o.product_id = p.id) OR
              (o.scope = 'category' AND o.category_id = p.category_id) OR
              (o.scope = 'global') OR
              (p.id = ANY(o.applicable_products)) OR
              (p.category_id = ANY(o.applicable_categories))
            )
          ORDER BY 
            CASE 
              WHEN o.scope = 'product' THEN 1
              WHEN p.id = ANY(o.applicable_products) THEN 2
              WHEN o.scope = 'category' THEN 3
              WHEN p.category_id = ANY(o.applicable_categories) THEN 4
              ELSE 5 
            END ASC
          LIMIT 1
         ) AS offer
       FROM cart c
       JOIN products p ON c.product_id = p.id
       LEFT JOIN product_variants pv ON c.variant_id = pv.id
       WHERE c.user_id = :userId
      ) q`,
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

    // 1.2️⃣ Check Addresses
    if (!billing_address_id || !shipping_address_id) {
      await transaction.rollback();
      return res.error("Please add billing/shipping address first", 400);
    }

    const [shippingAddress] = await sequelize.query(
      `SELECT state, pincode FROM order_addresses WHERE id = :id AND user_id = :userId`,
      {
        replacements: { id: shipping_address_id, userId },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    const [billingAddress] = await sequelize.query(
      `SELECT id FROM order_addresses WHERE id = :id AND user_id = :userId`,
      {
        replacements: { id: billing_address_id, userId },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (!shippingAddress || !billingAddress) {
      await transaction.rollback();
      return res.error("Please add billing/shipping address first", 400);
    }

    // 1.5️⃣ Check Inventory
    const productIds = cartItems.map(item => item.product_id);

    const inventories = await sequelize.query(
      `SELECT id, product_id, warehouse_id, on_hand, reserved, reorder_point 
       FROM inventory 
       WHERE product_id IN (:productIds)`,
      {
        replacements: { productIds },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    const inventoryMap = {};
    inventories.forEach(inv => inventoryMap[inv.product_id] = inv);

    // Fetch bundle components for any bundles in cart
    const bundleItemsInCart = cartItems.filter(item => item.product_type === 'Bundle');
    const bundleComponentMap = {}; // bundle_product_id -> [{ component_product_id, quantity }]
    if (bundleItemsInCart.length > 0) {
      const bundleIds = bundleItemsInCart.map(item => item.product_id);
      const components = await sequelize.query(
        `SELECT DISTINCT ON (pbi.component_product_id, pbi.component_variant_sku) 
           pbi.bundle_product_id, pbi.component_product_id, pbi.quantity, i.on_hand, i.reserved, i.id as inventory_id
         FROM product_bundle_items pbi
         JOIN inventory i ON i.product_id = pbi.component_product_id
           AND (i.sku = pbi.component_variant_sku OR pbi.component_variant_sku IS NULL OR pbi.component_variant_sku = '')
         WHERE pbi.bundle_product_id IN (:bundleIds)
         ORDER BY pbi.component_product_id, pbi.component_variant_sku, i.id`,
        { replacements: { bundleIds }, type: QueryTypes.SELECT, transaction }
      );
      components.forEach(comp => {
        if (!bundleComponentMap[comp.bundle_product_id]) bundleComponentMap[comp.bundle_product_id] = [];
        bundleComponentMap[comp.bundle_product_id].push(comp);
      });
    }

    for (let item of cartItems) {
      if (item.product_type === 'Bundle') {
        const components = bundleComponentMap[item.product_id] || [];
        if (components.length === 0) {
          await transaction.rollback();
          return res.status(400).json({ error: `Bundle ${item.title} has no components configured.` });
        }
        for (const comp of components) {
          const totalRequired = comp.quantity * item.quantity;
          if ((comp.on_hand - comp.reserved) < totalRequired) {
            await transaction.rollback();
            return res.status(400).json({ error: `Insufficient stock for a component of bundle: ${item.title}` });
          }
        }
      } else {
        const inv = inventoryMap[item.product_id];
        if (!inv || (inv.on_hand - inv.reserved) < item.quantity) {
          await transaction.rollback();
          return res.status(400).json({
            error: `Insufficient stock for product: ${item.title}`
          });
        }
      }
    }

    // 2️⃣ Shipping & Tax
    const WAREHOUSE_STATE = "Gujarat";
    const isIntraState = shippingAddress.state === WAREHOUSE_STATE;

    let subtotal = 0;
    let totalTax = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let taxableValue = 0;
    let totalOfferDiscount = 0;
    let appliedOffers = [];

    cartItems.forEach(item => {
      // Calculate offer discount for this item
      let itemSellingPrice = parseFloat(item.selling_price) || 0;
      let itemDiscountedPrice = parseFloat(item.discountedPrice) || itemSellingPrice;
      if (itemDiscountedPrice < itemSellingPrice) {
        totalOfferDiscount += ((itemSellingPrice - itemDiscountedPrice) * item.quantity);
        if (item.offer && item.offer.name && !appliedOffers.includes(item.offer.name)) {
          appliedOffers.push(item.offer.name);
        }
      }

      const gstRate = (item.gst_slab || 0) / 100;
      let itemTaxable = 0;
      let itemTax = 0;
      let itemTotalWithTax = 0;

      if (item.is_tax_inclusive) {
        // Price already includes GST
        itemTotalWithTax = itemSellingPrice * item.quantity;
        itemTaxable = itemTotalWithTax / (1 + gstRate);
        itemTax = itemTotalWithTax - itemTaxable;
      } else {
        // Price is base price, add GST on top
        itemTaxable = itemSellingPrice * item.quantity;
        itemTax = itemTaxable * gstRate;
        itemTotalWithTax = itemTaxable + itemTax;
      }

      subtotal += itemTotalWithTax;
      taxableValue += itemTaxable;
      totalTax += itemTax;

      if (isIntraState) {
        cgst += itemTax / 2;
        sgst += itemTax / 2;
      } else {
        igst += itemTax;
      }
    });

    // Calculate total weight from cart items (fallback to 0.5 kg if total is 0)
    let totalWeight = cartItems.reduce((acc, item) => {
      const w = parseFloat(item.weight_kg) || 0;
      return acc + (w * item.quantity);
    }, 0);
    if (totalWeight <= 0) totalWeight = 0.5;

    // Fetch dynamic shipping charge from Shiprocket
    let shippingChargeAmt = 0;
    try {
      if (shippingAddress && shippingAddress.pincode) {
        const locations = await getPickupLocations();
        const loc = locations?.data?.shipping_address?.[0];
        const pickup_postcode = loc?.pin_code;
        const delivery_postcode = shippingAddress.pincode;

        if (pickup_postcode && delivery_postcode) {
          const serviceability = await checkServiceability({
            pickup_postcode,
            delivery_postcode,
            weight: totalWeight.toString(), 
            cod: 0
          });

          const companies = serviceability?.data?.available_courier_companies || [];
          if (companies.length > 0) {
            const recommendedId = serviceability.data.recommended_courier_company_id;
            const recommendedCourier = companies.find(c => c.courier_company_id === recommendedId) || companies[0];
            shippingChargeAmt = recommendedCourier.rate;
            console.log(`✅ Fetched Shiprocket rate: ${shippingChargeAmt} for pin ${delivery_postcode}`);
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to fetch dynamic Shiprocket rate. Using fallback 0.", err.message);
    }

    let appliedCouponDiscount = 0;
    let finalCouponCode = coupon_code || null;

    if (coupon_code) {
      appliedCouponDiscount = parseFloat(coupon_discount) || 0;
    }

    if (totalOfferDiscount > 0) {
      appliedCouponDiscount += totalOfferDiscount;
      const offerNames = appliedOffers.join(", ");
      finalCouponCode = finalCouponCode ? `${finalCouponCode} | Offers: ${offerNames}` : `Offers: ${offerNames}`;
    }
    
    const finalTaxableValue = taxableValue - appliedCouponDiscount;
    const total = finalTaxableValue + totalTax + shippingChargeAmt;
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
         shipping_charges,
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
         :shippingCharges,
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
          couponCode: finalCouponCode,
          couponDiscount: appliedCouponDiscount,
          shippingCharges: shippingChargeAmt,
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

    // 6️⃣ Insert Order Items & Update Inventory
    for (let item of cartItems) {
      // Calculate item discount
      const itemSellingPrice = parseFloat(item.selling_price) || 0;
      const itemDiscountedPrice = parseFloat(item.discountedPrice) || itemSellingPrice;
      const itemDiscountAmount = itemSellingPrice - itemDiscountedPrice;
      const itemOfferName = (itemDiscountAmount > 0 && item.offer) ? item.offer.name : null;

      // Insert order item
      await sequelize.query(
        `INSERT INTO order_items (
           order_id,
           sku,
           name,
           qty,
           price,
           mrp,
           hsn_code,
           tax_rate_pct,
           offer_name,
           discount_amount,
           variant_id
         ) VALUES (
           :orderId,
           :sku,
           :name,
           :qty,
           :price,
           :mrp,
           :hsnCode,
           :taxRate,
           :offerName,
           :discountAmount,
           :variantId
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
            taxRate: item.gst_slab,
            offerName: itemOfferName,
            discountAmount: itemDiscountAmount,
            variantId: item.variant_id || null
          },
          type: QueryTypes.INSERT,
          transaction
        }
      );

      // Update inventory
      if (item.product_type === 'Bundle') {
        const components = bundleComponentMap[item.product_id] || [];
        for (const comp of components) {
          const qtyToDeduct = comp.quantity * item.quantity;
          await sequelize.query(
            `UPDATE inventory
             SET on_hand = on_hand - :qty,
                 reserved = reserved + :qty,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = :inventoryId`,
            {
              replacements: { qty: qtyToDeduct, inventoryId: comp.inventory_id },
              type: QueryTypes.UPDATE,
              transaction
            }
          );
        }
      } else {
        const inv = inventoryMap[item.product_id];
        await sequelize.query(
          `UPDATE inventory
           SET on_hand = on_hand - :qty,
               reserved = reserved + :qty,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :inventoryId`,
          {
            replacements: {
              qty: item.quantity,
              inventoryId: inv.id
            },
            type: QueryTypes.UPDATE,
            transaction
          }
        );
      }
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

    // 🔟 Clear Cart
    await sequelize.query(
      `DELETE FROM cart WHERE user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.DELETE,
        transaction
      }
    );

    await transaction.commit();

    try {
      if (req.user?.email) {
        await transporter.sendMail({
          from: `"Curevan Orders" <${process.env.MAIL_USER}>`,
          to: req.user.email,
          subject: `Order Confirmation - ${orderNumber}`,
          html: `
            <h3>Order Received!</h3>
            <p>Hi ${req.user.name || 'Customer'},</p>
            <p>Your order <strong>${orderNumber}</strong> has been placed successfully.</p>
            <p><strong>Total Amount:</strong> ₹${total}</p>
            <p>We will notify you once your order is shipped.</p>
          `
        });
      }
    } catch (mailErr) {
      console.error("Failed to send order creation email:", mailErr);
    }

    return res.json({
      success: true,
      message: "Order & Invoice created successfully with GST and Inventory updated",
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
        shippingCharges: shippingChargeAmt,
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


exports.validateCartStock = async (req, res) => {
  const userId = req.user.id;

  const cartItems = await sequelize.query(
    `SELECT c.product_id, c.quantity, p.title
     FROM cart c
     JOIN products p ON c.product_id = p.id
     WHERE c.user_id = :userId`,
    {
      replacements: { userId },
      type: QueryTypes.SELECT
    }
  );

  const productIds = cartItems.map(i => i.product_id);

  const inventories = await sequelize.query(
    `SELECT product_id, on_hand, reserved
     FROM inventory
     WHERE product_id IN (:productIds)`,
    {
      replacements: { productIds },
      type: QueryTypes.SELECT
    }
  );

  const inventoryMap = {};
  inventories.forEach(i => inventoryMap[i.product_id] = i);

  for (let item of cartItems) {
    const inv = inventoryMap[item.product_id];

    if (!inv || (inv.on_hand - inv.reserved) < item.quantity) {
      return res.status(400).json({
        success: false,
        message: `Out of stock: ${item.title}`
      });
    }
  }

  return res.json({ success: true });
};


exports.cancelOrder = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    // 1️⃣ Get Order
    const orders = await sequelize.query(
      `SELECT id, status 
       FROM orders 
       WHERE id = :orderId AND user_id = :userId`,
      {
        replacements: { orderId, userId },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (!orders.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const order = orders[0];

    // ❌ Only Pending allowed
    if (order.status !== "Pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only Pending orders can be Cancelled"
      });
    }

    // 2️⃣ Get Order Items
    const orderItems = await sequelize.query(
      `SELECT oi.qty, i.id AS inventory_id
       FROM order_items oi
       JOIN inventory i ON oi.sku = i.sku
       WHERE oi.order_id = :orderId`,
      {
        replacements: { orderId },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (!orderItems.length) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No order items found"
      });
    }

    // 3️⃣ Restore Inventory (NO reserved)
    for (const item of orderItems) {
      await sequelize.query(
        `UPDATE inventory
         SET on_hand = on_hand + :qty
         WHERE id = :inventoryId`,
        {
          replacements: {
            qty: item.qty,
            inventoryId: item.inventory_id
          },
          transaction
        }
      );
    }

    // 4️⃣ Update Order Status
    await sequelize.query(
      `UPDATE orders
       SET status = 'Cancelled'
       WHERE id = :orderId`,
      {
        replacements: { orderId },
        transaction
      }
    );

    await transaction.commit();

    try {
      if (req.user?.email) {
        await transporter.sendMail({
          from: `"Curevan Orders" <${process.env.MAIL_USER}>`,
          to: req.user.email,
          subject: `Order Cancelled - #${orderId}`,
          html: `
            <h3>Order Cancelled</h3>
            <p>Hi ${req.user.name || 'Customer'},</p>
            <p>Your order #${orderId} has been cancelled successfully.</p>
            <p>If you have any questions, please contact our support team.</p>
          `
        });
      }
    } catch (mailErr) {
      console.error("Failed to send order cancel email:", mailErr);
    }

    return res.json({
      success: true,
      message: `Order #${orderId} Cancelled successfully`
    });

  } catch (error) {
    console.error("Cancel Order Error:", error);

    await transaction.rollback();

    return res.status(500).json({
      success: false,
      message: "Failed to cancel order",
      error: error.message
    });
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
        o.shipping_charges AS "shippingCharges",
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
              'taxRate', oi.tax_rate_pct,
              'variantAttributes', pv.attributes
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      -- Join order_items
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON oi.variant_id = pv.id
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
        o.shipping_charges AS "shippingCharges",
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
              'taxRatePct', oi.tax_rate_pct,
              'variantAttributes', pv.attributes
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items

      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON oi.variant_id = pv.id
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


// exports.getInvoiceById = async (req, res) => {
//   try {
//     console.log("req.params.id inv",req.params.id);
//     const invoiceId = req.params.id;
//     const userId = req.user.id;
//     const userRole = req.user.role;

//     // 1️⃣ Get Invoice
//     const invoice = await sequelize.query(
//       `SELECT * FROM invoices WHERE id = :invoiceId`,
//       {
//         replacements: { invoiceId },
//         type: QueryTypes.SELECT,
//       }
//     );

//     if (!invoice.length) {
//       return res.error("Invoice not found");
//     }

//     const invoiceData = invoice[0];

//     // 2️⃣ Role based access control
//     if (userRole !== "admin" && invoiceData.user_id !== userId) {
//       return res.error("Forbidden");
//     }

//     // 3️⃣ If Order Invoice
//     if (invoiceData.order_id) {
//       const order = await sequelize.query(
//         `SELECT o.*, o.id as "orderId",
//                 COALESCE(
//                   json_agg(
//                     jsonb_build_object(
//                       'id', oi.id,
//                       'name', oi.name,
//                       'qty', oi.qty,
//                       'price', oi.price
//                       'price', oi.price
//                     )
//                   ) FILTER (WHERE oi.id IS NOT NULL),
//                   '[]'
//                 ) AS items
//          FROM orders o
//          LEFT JOIN order_items oi ON o.id = oi.order_id
//          WHERE o.id = :orderId
//          GROUP BY o.id`,
//         {
//           replacements: { orderId: invoiceData.order_id },
//           type: QueryTypes.SELECT,
//         }
//       );

//       return res.success(
//         {
//           invoice: invoiceData,
//           source: order[0] || null,
//           type: "order",
//         },
//         "Invoice fetched successfully"
//       );
//     }

//     // 4️⃣ If Booking Invoice
//     if (invoiceData.booking_id) {
//       const booking = await sequelize.query(
//         `SELECT * , id as "bookingId" FROM bookings WHERE id = :bookingId`,
//         {
//           replacements: { bookingId: invoiceData.booking_id },
//           type: QueryTypes.SELECT,
//         }
//       );

//       return res.success(
//         {
//           invoice: invoiceData,
//           source: booking[0] || null,
//           type: "booking",
//         },
//         "Invoice fetched successfully"
//       );
//     }

//     return res.error("Invalid invoice source");

//   } catch (error) {
//     console.error(error);
//     return res.error("Server error");
//   }
// };

exports.getInvoiceById = async (req, res) => {
  try {
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

    // 3️⃣ Determine intra-state or inter-state
    const isIntraState = true; // true = CGST+SGST, false = IGST

    // 4️⃣ If Order Invoice
    if (invoiceData.order_id) {
      const order = await sequelize.query(
        `SELECT o.*, o.id as "orderId",
                COALESCE(
                  json_agg(
                    jsonb_build_object(
                      'id', oi.id,
                      'name', oi.name,
                      'quantity', oi.qty,
                      'price', oi.price,
                      'tax_rate_pct', oi.tax_rate_pct,
                      'price_excl_gst', ROUND(oi.price / (1 + (oi.tax_rate_pct/100))::numeric, 2),
                      'gst_amount', ROUND(oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))::numeric, 2),
                      'cgst', CASE WHEN :isIntra THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
                      'sgst', CASE WHEN :isIntra THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
                      'igst', CASE WHEN NOT :isIntra THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))), 2) ELSE 0 END,
                      'variantAttributes', pv.attributes,
                        'components', '[]'::json
                      )
                    )
                  ) FILTER (WHERE oi.id IS NOT NULL),
                  '[]'
                ) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         LEFT JOIN product_variants pv ON oi.variant_id = pv.id
         WHERE o.id = :orderId
         GROUP BY o.id`,
        {
          replacements: { orderId: invoiceData.order_id, isIntra: isIntraState },
          type: QueryTypes.SELECT,
        }
      );

      const orderSource = order[0] || null;
      if (orderSource && orderSource.items) {
        let itemsArr = typeof orderSource.items === 'string' ? JSON.parse(orderSource.items) : orderSource.items;
        
        for (let item of itemsArr) {
          if (!item || typeof item !== 'object') continue;
          
          // If it's a bundle, fetch components manually to guarantee they are found
          const bundleQuery = await sequelize.query(`
            SELECT cp.title as name, pbi.component_variant_sku as sku, pbi.quantity as qty, pbi.selling_price as price, pbi.gst_slab, pbi.discount
            FROM products bp
            JOIN product_bundle_items pbi ON pbi.bundle_product_id = bp.id
            JOIN products cp ON cp.id = pbi.component_product_id
            WHERE bp.id = :itemProductId OR bp.sku = :itemSku OR bp.title = :itemName
          `, { 
            replacements: { 
              itemName: item.name || '', 
              itemSku: item.sku || 'UNKNOWN_SKU', 
              itemProductId: item.product_id || -1 
            }, 
            type: QueryTypes.SELECT 
          });

          if (bundleQuery.length > 0) {
            item.components = bundleQuery.map(comp => {
              const price = Number(comp.price) || 0;
              const gst_slab = Number(comp.gst_slab) || 0;
              const price_excl_gst = Number((price / (1 + (gst_slab/100))).toFixed(2));
              const gst_amount = Number((price - price_excl_gst).toFixed(2));
              const cgst = isIntraState ? Number((gst_amount / 2).toFixed(2)) : 0;
              const sgst = isIntraState ? Number((gst_amount / 2).toFixed(2)) : 0;
              const igst = !isIntraState ? gst_amount : 0;
              
              return {
                name: comp.name,
                sku: comp.sku,
                qty: comp.qty,
                price: comp.price,
                gst_slab: comp.gst_slab,
                discount: comp.discount || 0,
                price_excl_gst,
                gst_amount,
                cgst,
                sgst,
                igst
              };
            });
          }
        }
        orderSource.items = itemsArr;
      }

      return res.success(
        {
          invoice: invoiceData,
          source: orderSource,
          type: "order",
        },
        "Invoice fetched successfully"
      );
    }

    // 5️⃣ If Booking Invoice
    if (invoiceData.booking_id) {
      const booking = await sequelize.query(
        `SELECT b.*, b.id as "bookingId",
                COALESCE(
                  json_agg(
                    jsonb_build_object(
                      'id', bi.id,
                      'name', bi.name,
                      'qty', bi.qty,
                      'price', bi.price,
                      'tax_rate_pct', bi.tax_rate_pct,
                      'price_excl_gst', ROUND(bi.price / (1 + (bi.tax_rate_pct/100))::numeric, 2),
                      'gst_amount', ROUND(bi.price - (bi.price / (1 + (bi.tax_rate_pct/100)))::numeric, 2),
                      'cgst', CASE WHEN :isIntra THEN ROUND((bi.price - (bi.price / (1 + (bi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
                      'sgst', CASE WHEN :isIntra THEN ROUND((bi.price - (bi.price / (1 + (bi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
                      'igst', CASE WHEN NOT :isIntra THEN ROUND((bi.price - (bi.price / (1 + (bi.tax_rate_pct/100)))), 2) ELSE 0 END
                    )
                  ) FILTER (WHERE bi.id IS NOT NULL),
                  '[]'
                ) AS items
         FROM bookings b
         LEFT JOIN booking_items bi ON b.id = bi.booking_id
         WHERE b.id = :bookingId
         GROUP BY b.id`,
        {
          replacements: { bookingId: invoiceData.booking_id, isIntra: isIntraState },
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
    return res.error("Server error: " + error.message);
  }
};