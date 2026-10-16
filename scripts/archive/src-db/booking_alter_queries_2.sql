-- 1. First, you may need to clear out any old string data in this column if it can't be cast to integer
-- UPDATE appointments SET service_type_id = NULL WHERE service_type_id IS NOT NULL;

-- 2. Alter the column type to INTEGER
ALTER TABLE appointments 
  ALTER COLUMN service_type_id TYPE INTEGER 
  USING NULLIF(service_type_id, '')::INTEGER;

-- 3. (Optional but recommended) Add a foreign key constraint to link to the service_types table
ALTER TABLE appointments 
  ADD CONSTRAINT fk_appointments_service_type 
  FOREIGN KEY (service_type_id) 
  REFERENCES service_types(id) 
  ON DELETE SET NULL;
