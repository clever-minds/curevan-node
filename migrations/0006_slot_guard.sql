-- 0006 (P13): the database itself refuses two active bookings for the same therapist, date and time.
-- If old data already contains such duplicates, NOTHING is dropped or changed: the index is skipped and a notice
-- is printed (the runner still records 0006 as applied). Run docs/find_duplicate_slots.sql, let the owner resolve each pair,
-- then run step 2 of that file to create the index.
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT therapist_id, date, time FROM appointments
    WHERE therapist_id IS NOT NULL
      AND status IN ('pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending')
    GROUP BY therapist_id, date, time HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE 'P13: % duplicate active slot(s) found - unique index NOT created. Run docs/find_duplicate_slots.sql, resolve them, then run its step 2.', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot ON appointments (therapist_id, date, time)
      WHERE therapist_id IS NOT NULL
        AND status IN ('pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending');
  END IF;
END $$;
