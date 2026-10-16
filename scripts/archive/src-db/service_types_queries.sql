-- CREATE TABLE QUERY (Run this if the table does not exist)
CREATE TABLE IF NOT EXISTS service_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INITIAL SEED DATA
INSERT INTO service_types (name)
VALUES 
    ('Physiotherapy'), ('Nursing Care'), ('Geri care Therapy'), ('Speech Therapy'),
    ('Mental Health Counseling'), ('Dietitian/Nutritionist'), ('Respiratory Therapy'),
    ('Operations'), ('Earnings'), ('Clinical')
ON CONFLICT (name) DO NOTHING;

-- ALTER QUERY EXAMPLES (If you need to modify the table in the future)
-- ALTER TABLE service_types ADD COLUMN description TEXT;
-- ALTER TABLE service_types RENAME COLUMN name TO service_name;
