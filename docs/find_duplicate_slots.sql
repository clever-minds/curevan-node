-- STEP 1 - lists every therapist/date/time that has more than one ACTIVE booking (blocks migration 0006's unique index; the owner resolves each pair first).
SELECT a.therapist_id, a.date, a.time, COUNT(*) AS bookings, array_agg(a.id ORDER BY a.id) AS appointment_ids,
       array_agg(a.status ORDER BY a.id) AS statuses
FROM appointments a
WHERE a.therapist_id IS NOT NULL
  AND a.status IN ('proposed', 'pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending')
GROUP BY a.therapist_id, a.date, a.time
HAVING COUNT(*) > 1
ORDER BY a.date, a.therapist_id;

-- STEP 2 - when step 1 returns no rows, create the index that migration 0006 skipped:
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot ON appointments (therapist_id, date, time)
--   WHERE therapist_id IS NOT NULL
--     AND status IN ('proposed', 'pending_payment', 'accepted_unpaid', 'confirmed', 'therapist_on_the_way', 'arrived', 'in_progress', 'pcr_pending');
