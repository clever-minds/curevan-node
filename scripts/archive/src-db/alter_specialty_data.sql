-- Step 1: Update existing string-based specialties (like 'Physiotherapy') to their corresponding integer IDs
UPDATE therapist_profiles
SET specialty = ARRAY(
  SELECT COALESCE(st.id::text, sp)
  FROM unnest(specialty) AS sp
  LEFT JOIN service_types st ON trim(st.name) = trim(sp)
)
WHERE specialty IS NOT NULL;

-- Step 2: Remove any remaining strings that could not be mapped (to avoid type cast errors)
UPDATE therapist_profiles
SET specialty = ARRAY(
  SELECT sp
  FROM unnest(specialty) AS sp
  WHERE sp ~ '^[0-9]+$'
)
WHERE specialty IS NOT NULL;

-- Step 3: Safely change the column type to INTEGER[]
ALTER TABLE therapist_profiles 
ALTER COLUMN specialty TYPE INTEGER[] 
USING specialty::INTEGER[];
