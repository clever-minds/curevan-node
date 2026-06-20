ALTER TABLE therapists ADD COLUMN documents JSONB DEFAULT '[]'::jsonb;
