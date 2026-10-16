
-- SQL to create the offers table
CREATE TABLE IF NOT EXISTS offers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'percent' or 'flat'
    value NUMERIC(10, 2) NOT NULL,
    scope VARCHAR(50) DEFAULT 'global', -- 'global', 'product'
    applicable_products JSONB DEFAULT '[]', -- Array of product IDs
    is_active BOOLEAN DEFAULT TRUE,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_to TIMESTAMP WITH TIME ZONE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_offers_active ON offers(is_active) WHERE is_active = TRUE;
