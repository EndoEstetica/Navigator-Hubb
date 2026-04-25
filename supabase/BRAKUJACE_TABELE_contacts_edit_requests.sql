-- ==============================================================================
-- BRAKUJĄCE TABELE: contacts + edit_requests
-- Wklej całość w Supabase SQL Editor → Run
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: contacts
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                        TEXT PRIMARY KEY,
  ghl_contact_id            TEXT UNIQUE,
  location_id               TEXT,
  first_name                TEXT,
  last_name                 TEXT,
  email                     TEXT,
  phone                     TEXT,
  source                    TEXT,
  tags                      TEXT[],
  main_problem              TEXT,
  marketing_consent         BOOLEAN DEFAULT false,
  preferred_contact_method  TEXT,
  patient_priority          TEXT,
  referral_type             TEXT,
  referral_details          TEXT,
  is_new_patient            BOOLEAN DEFAULT true,
  first_contact_date        TIMESTAMPTZ,
  first_call_id             TEXT,
  lead_created_at           TIMESTAMPTZ,
  first_call_at             TIMESTAMPTZ,
  response_time_minutes     INTEGER,
  w0_scheduled              BOOLEAN DEFAULT false,
  w0_date                   TIMESTAMPTZ,
  w0_doctor                 TEXT,
  last_call_status          TEXT,
  last_call_effect          TEXT,
  last_call_date            TIMESTAMPTZ,
  last_call_program         TEXT,
  ghl_opportunity_id        TEXT,
  ghl_stage_id              TEXT,
  ghl_stage_name            TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone          ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email          ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_id         ON contacts(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_is_new_patient ON contacts(is_new_patient);
CREATE INDEX IF NOT EXISTS idx_contacts_w0             ON contacts(w0_scheduled) WHERE w0_scheduled = true;
CREATE INDEX IF NOT EXISTS idx_contacts_stage          ON contacts(ghl_stage_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all contacts" ON contacts;
CREATE POLICY "Allow all contacts" ON contacts FOR ALL USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: edit_requests
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edit_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    TEXT,
  contact_name  TEXT,
  requested_by  TEXT,
  field_name    TEXT,
  old_value     TEXT,
  new_value     TEXT,
  notes         TEXT,
  status        TEXT DEFAULT 'pending',
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_requests_status  ON edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_contact ON edit_requests(contact_id);

ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all edit_requests" ON edit_requests;
CREATE POLICY "Allow all edit_requests" ON edit_requests FOR ALL USING (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Weryfikacja
-- ──────────────────────────────────────────────────────────────────────────────
SELECT table_name,
  (SELECT COUNT(*) FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS kolumny
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
