-- TEST-ONLY schema, reconstructed from the columns the backend code reads and writes.
-- It is NOT the production schema: the real one comes from migrations/0000_baseline.sql (pg_dump).
-- It exists so the integration tests can run the real SQL against a real PostgreSQL.

CREATE TABLE users (
  id SERIAL PRIMARY KEY, uid TEXT UNIQUE, email TEXT UNIQUE, password TEXT, name TEXT, phone TEXT, role TEXT,
  is_verified BOOLEAN DEFAULT false, verification_code TEXT, status TEXT DEFAULT 'active', fcm_token TEXT,
  latitude NUMERIC, longitude NUMERIC, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, pin TEXT,
  full_address TEXT, state_admin_name TEXT, reset_token TEXT, reset_token_expiry TIMESTAMPTZ,
  push_opt_in BOOLEAN DEFAULT false, email_opt_in BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE user_roles (user_id INT NOT NULL, role_id INT NOT NULL, PRIMARY KEY (user_id, role_id));
CREATE TABLE media (id SERIAL PRIMARY KEY, user_id INT, filename TEXT, file_path TEXT, media_type TEXT, created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE service_types (id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now());

CREATE TABLE therapist_profiles (
  id SERIAL PRIMARY KEY, user_id INT UNIQUE, bio TEXT, service_radius_km NUMERIC, qualification TEXT, registration_no TEXT,
  experience_years INT, hourly_rate NUMERIC, membership_plan TEXT DEFAULT 'standard', pan_number TEXT,
  bank_account_number TEXT, bank_ifsc_code TEXT, profile_status TEXT DEFAULT 'pending', specialty INT[],
  is_public_profile BOOLEAN DEFAULT true, profile_image INT, lat NUMERIC, lng NUMERIC, full_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE therapist_availability (id SERIAL PRIMARY KEY, therapist_id INT, day_of_week TEXT, is_enabled BOOLEAN,
  morning_start TEXT, morning_end TEXT, evening_start TEXT, evening_end TEXT, start_time TEXT, end_time TEXT);
CREATE TABLE therapist_leaves (id SERIAL PRIMARY KEY, therapist_id INT, start_date DATE, end_date DATE, reason TEXT);
CREATE TABLE therapist_reviews (id SERIAL PRIMARY KEY, therapist_id INT, patient_id INT, appointment_id INT, rating INT, review TEXT, created_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE order_addresses (id SERIAL PRIMARY KEY, user_id INT, address_type TEXT, full_name TEXT, email TEXT, phone TEXT,
  full_address TEXT, city TEXT, state TEXT, pincode TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());

CREATE TABLE appointments (
  id SERIAL PRIMARY KEY, patient_id INT, patient_name TEXT, patient_phone TEXT, date_of_birth TEXT, therapist_id INT,
  therapist_name TEXT, therapist_phone TEXT, service_type_id INT, therapy_type TEXT, service_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0, clinic_id INT, date DATE, time TEXT, start_time TEXT, end_time TEXT, mode TEXT,
  status TEXT, cancellation_reason TEXT, notes TEXT, service_address_id INT, payment_status TEXT, pcr_status TEXT,
  verification_status TEXT, reports TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE pcr (
  id SERIAL PRIMARY KEY, appointment_id INT UNIQUE, patient_id INT, therapist_id INT, service_type_id INT,
  chief_complaint TEXT, assessment TEXT, diagnosis TEXT, treatment_provided TEXT, plan_of_care TEXT,
  bp TEXT, hr TEXT, rr TEXT, temp TEXT, status TEXT, version INT, created_at TIMESTAMPTZ DEFAULT now(),
  locked_at TIMESTAMPTZ, locked_by TEXT, history JSONB DEFAULT '[]', incident_date TEXT, incident_location TEXT,
  next_treatment_date TEXT, upload_attachment_id INT, therapist_name TEXT, signature_confirmation BOOLEAN
);

CREATE TABLE categories (id SERIAL PRIMARY KEY, name TEXT, description TEXT, image_id INT, status TEXT);
CREATE TABLE products (id SERIAL PRIMARY KEY, title TEXT, product_type TEXT DEFAULT 'Simple', selling_price NUMERIC, mrp NUMERIC,
  sku TEXT, category_id INT, hsn_code TEXT, gst_slab NUMERIC DEFAULT 18, is_tax_inclusive BOOLEAN DEFAULT false, weight_kg NUMERIC);
CREATE TABLE product_variants (id SERIAL PRIMARY KEY, product_id INT, selling_price NUMERIC, mrp NUMERIC, sku TEXT, attributes JSONB);
CREATE TABLE product_bundle_items (id SERIAL PRIMARY KEY, bundle_product_id INT, component_product_id INT, component_variant_sku TEXT, quantity INT);
CREATE TABLE inventory (id SERIAL PRIMARY KEY, product_id INT, warehouse_id INT DEFAULT 1, sku TEXT, on_hand INT, reserved INT DEFAULT 0,
  reorder_point INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE cart (id SERIAL PRIMARY KEY, user_id INT, product_id INT, quantity INT, variant_id INT);
CREATE TABLE offers (id SERIAL PRIMARY KEY, name TEXT, type TEXT, value NUMERIC, scope TEXT, description TEXT, is_active BOOLEAN DEFAULT true,
  valid_from DATE, valid_to DATE, product_id INT, category_id INT, applicable_products INT[], applicable_categories INT[]);
CREATE TABLE coupons (id SERIAL PRIMARY KEY, code TEXT, type TEXT, value NUMERIC, status TEXT, scope TEXT, usage_limit INT, usage_per_user INT,
  min_order_value NUMERIC, max_discount NUMERIC, is_stackable BOOLEAN DEFAULT false, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ,
  applicable_categories INT[], applicable_products INT[], owner_type TEXT, therapist_id INT);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY, order_number TEXT, user_id INT, customer_name TEXT, customer_phone TEXT, billing_address_id INT,
  shipping_address_id INT, subtotal NUMERIC, coupon_id INT, coupon_code TEXT, coupon_discount NUMERIC, shipping_charges NUMERIC,
  taxable_value NUMERIC, cgst NUMERIC, sgst NUMERIC, igst NUMERIC, total_tax NUMERIC, total NUMERIC, status TEXT, payment_status TEXT,
  referred_therapist_id TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INT, sku TEXT, name TEXT, qty INT, price NUMERIC, mrp NUMERIC, hsn_code TEXT,
  tax_rate_pct NUMERIC, offer_name TEXT, discount_amount NUMERIC, variant_id INT);
CREATE TABLE payment_transactions (id SERIAL PRIMARY KEY, txn_id TEXT, ref TEXT, user_id INT, order_id INT, amount NUMERIC, currency TEXT,
  status TEXT, gateway TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE invoices (id SERIAL PRIMARY KEY, invoice_number TEXT UNIQUE, invoice_type TEXT, status TEXT, user_id INT, order_id INT, booking_id INT,
  total_amount_paise NUMERIC, cgst_amount NUMERIC, sgst_amount NUMERIC, igst_amount NUMERIC, issued_at TIMESTAMPTZ);
CREATE TABLE order_returns (id SERIAL PRIMARY KEY, order_id INT, user_id INT, reason TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ);
CREATE TABLE order_refunds (id SERIAL PRIMARY KEY, order_id INT NOT NULL, return_id INT, user_id INT, amount NUMERIC, reason TEXT, transaction_id TEXT, status TEXT);

CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_uid TEXT, type TEXT, title TEXT, message TEXT, link TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE tickets (id SERIAL PRIMARY KEY, user_id INT, item_id TEXT, type TEXT, topic TEXT, subject TEXT, message TEXT, file TEXT, priority TEXT, rating INT,
  status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE ticket_messages (id SERIAL PRIMARY KEY, ticket_id INT, sender_id INT, message TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE payout_items (id SERIAL PRIMARY KEY, source_id INT, therapist_id INT, gross_amount NUMERIC, platform_fee_amount NUMERIC, gst_on_platform_fee NUMERIC,
  tds_deducted NUMERIC, net_amount NUMERIC, state TEXT, week_start DATE);
CREATE TABLE knowledge_base (id SERIAL PRIMARY KEY, title TEXT, slug TEXT, author_id INT, author_name TEXT, status TEXT);
