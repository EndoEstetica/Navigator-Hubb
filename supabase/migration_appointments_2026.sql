-- ================================================================
-- Migration: Tabela wizyt z systemu medycznego
-- Navigator-Hubb — 2026
-- ================================================================

CREATE TABLE IF NOT EXISTS appointments (
  id                  BIGSERIAL PRIMARY KEY,
  contact_id          TEXT,          -- GHL contact ID (może być NULL jeśli brak kontaktu)
  contact_name        TEXT,
  phone               TEXT,
  visit_date          TIMESTAMPTZ NOT NULL,
  doctor              TEXT,
  visit_type          TEXT DEFAULT 'wizyta',
  source              TEXT DEFAULT 'system_medyczny',  -- 'system_medyczny' | 'recepcja' | 'telefon'
  external_patient_id TEXT,          -- ID pacjenta w systemie medycznym
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_contact_id ON appointments (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_visit_date ON appointments (visit_date);
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments (phone) WHERE phone IS NOT NULL;

-- Komentarz: Endpoint webhook do systemu medycznego:
-- POST https://navigator-hubb.onrender.com/api/webhook/appointments
-- Header: X-Appointment-Secret: [wartość z .env APPOINTMENT_WEBHOOK_SECRET]
-- Body: { "patientPhone": "+48601...", "visitDate": "2026-05-10T10:00:00",
--          "doctor": "dr X", "visitType": "konsultacja", "source": "recepcja" }
