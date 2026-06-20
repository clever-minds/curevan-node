CREATE TABLE IF NOT EXISTS therapist_reviews (
  id SERIAL PRIMARY KEY,
  therapist_id INT REFERENCES users(id) ON DELETE CASCADE,
  patient_id INT REFERENCES users(id) ON DELETE SET NULL,
  appointment_id INT REFERENCES appointments(id) ON DELETE SET NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
