-- ALTER QUERIES FOR SERVICE-FIRST BOOKING FLOW
-- These changes allow appointments to be created before a therapist is assigned, 
-- and changes the status column to accept our new tracking statuses.

-- 1. Make therapist_id optional
ALTER TABLE appointments ALTER COLUMN therapist_id DROP NOT NULL;

-- 2. Make therapist_name optional
ALTER TABLE appointments ALTER COLUMN therapist_name DROP NOT NULL;

-- 3. Make therapist_phone optional
ALTER TABLE appointments ALTER COLUMN therapist_phone DROP NOT NULL;

-- 4. Change status column to VARCHAR so it can accept new text statuses 
-- (Searching, Assigned, OnTheWay, Started, Completed, etc.)
ALTER TABLE appointments ALTER COLUMN status TYPE VARCHAR(255);
