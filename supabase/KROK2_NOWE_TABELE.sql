-- ==============================================================================
-- KROK 2 — URUCHOM PO KROKU 1
-- Tworzy NOWE tabele (których jeszcze nie ma w bazie)
-- Bezpieczny: IF NOT EXISTS — można uruchomić wielokrotnie
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: contacts (jeśli jeszcze nie istnieje)
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
-- TABELA: user_activity (status online recepcji)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         TEXT NOT NULL,
  user_name       TEXT,
  last_login_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  is_online       BOOLEAN DEFAULT FALSE,
  is_active_today BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id   ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_is_online ON user_activity(is_online);

ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all user_activity" ON user_activity;
CREATE POLICY "Allow all user_activity" ON user_activity FOR ALL USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: events (log zdarzeń systemu)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT NOT NULL,
  contact_id   TEXT,
  contact_name TEXT,
  user_id      TEXT,
  description  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type       ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_contact    ON events(contact_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all events" ON events;
CREATE POLICY "Allow all events" ON events FOR ALL USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: edit_requests (prośby o edycję danych kontaktu)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edit_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    TEXT,
  contact_name  VARCHAR(255),
  requested_by  VARCHAR(100),
  field_name    VARCHAR(100),
  old_value     TEXT,
  new_value     TEXT,
  notes         TEXT,
  status        VARCHAR(50) DEFAULT 'pending',
  resolved_at   TIMESTAMPTZ,
  resolved_by   VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_requests_status  ON edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_contact ON edit_requests(contact_id);

ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all edit_requests" ON edit_requests;
CREATE POLICY "Allow all edit_requests" ON edit_requests FOR ALL USING (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Weryfikacja końcowa
-- ──────────────────────────────────────────────────────────────────────────────
SELECT table_name, COUNT(*) as kolumny
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('calls', 'contacts', 'tasks', 'user_activity', 'events', 'edit_requests')
GROUP BY table_name
ORDER BY table_name;
