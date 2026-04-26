-- ==============================================================================
-- NAVIGATOR CALL v6 — EndoEstetica
-- PEŁNY SCHEMAT SUPABASE + WSZYSTKIE MIGRACJE
-- ==============================================================================
-- Uruchom w: Supabase Dashboard → SQL Editor → New query → Run
-- BEZPIECZNY: używa IF NOT EXISTS / IF EXISTS — nie niszczy istniejących danych
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- KROK 0: Funkcja auto-update updated_at (potrzebna dla triggerów)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';


-- ==============================================================================
-- TABELA: calls
-- ==============================================================================
CREATE TABLE IF NOT EXISTS calls (
  id                    BIGSERIAL PRIMARY KEY,
  call_id               TEXT UNIQUE NOT NULL,
  pbx_call_id           TEXT,
  caller_phone          TEXT,
  called_phone          TEXT,
  direction             TEXT DEFAULT 'inbound',
  status                TEXT DEFAULT 'ringing',
  duration_seconds      INTEGER DEFAULT 0,
  recording_url         TEXT,

  -- Dane pacjenta
  patient_name          TEXT,
  gender                TEXT,
  birth_date            TEXT,
  manual_patient_name   TEXT,

  -- GHL
  ghl_contact_id        TEXT,
  ghl_logged            BOOLEAN DEFAULT FALSE,

  -- Raport — Klasyfikacja
  contact_type          TEXT,      -- nowy_pacjent / staly_pacjent / wizyta_biezaca / spam
  call_reason           TEXT,
  temperature           TEXT,
  objections            TEXT,      -- JSON array

  -- Raport — Wynik rozmowy
  call_effect           TEXT,
  booked_visit          BOOLEAN DEFAULT FALSE,

  -- Raport — Dodatkowe dane
  source                TEXT,
  treatment             TEXT,
  referred_by           TEXT,
  notes                 TEXT,
  user_id               TEXT,

  -- Typ rozmowy (Reception OS)
  call_type             TEXT DEFAULT 'follow_up',  -- first_call | follow_up | visit_related | other
  is_new_patient        BOOLEAN,

  -- W0
  scheduled_w0          BOOLEAN DEFAULT FALSE,
  w0_date               TIMESTAMPTZ,
  w0_doctor             TEXT,
  is_qualified          BOOLEAN,
  disqualification_reason TEXT,
  potential_program     TEXT,

  -- Odwołania
  cancellation_reason   TEXT,
  is_follow_up          BOOLEAN DEFAULT FALSE,

  -- Czas reakcji
  first_call_at         TIMESTAMPTZ,
  w0_booked_at          TIMESTAMPTZ,

  -- Raport meta
  report_saved_at       TIMESTAMPTZ,
  report_saved_by       TEXT,
  call_tag              TEXT,      -- connected | missed | ineffective

  -- Temat
  topic_closed          BOOLEAN DEFAULT FALSE,
  closed_at             TIMESTAMPTZ,
  contact_attempts      INTEGER DEFAULT 0,

  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  answered_at           TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_calls_call_id        ON calls(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_topic_closed   ON calls(topic_closed);
CREATE INDEX IF NOT EXISTS idx_calls_created_at     ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_status         ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_contact_type   ON calls(contact_type);
CREATE INDEX IF NOT EXISTS idx_calls_call_type      ON calls(call_type);
CREATE INDEX IF NOT EXISTS idx_calls_updated_at     ON calls(updated_at);
CREATE INDEX IF NOT EXISTS idx_calls_user_id        ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_ghl_contact    ON calls(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_scheduled_w0   ON calls(scheduled_w0) WHERE scheduled_w0 = true;
CREATE INDEX IF NOT EXISTS idx_calls_recording      ON calls(recording_url) WHERE recording_url IS NOT NULL;

-- RLS
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON calls;
CREATE POLICY "Allow all" ON calls FOR ALL USING (true) WITH CHECK (true);

-- Trigger
DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ==============================================================================
-- TABELA: contacts
-- ==============================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                        TEXT PRIMARY KEY,    -- GHL contact ID
  ghl_contact_id            TEXT UNIQUE,
  location_id               TEXT,
  first_name                TEXT,
  last_name                 TEXT,
  email                     TEXT,
  phone                     TEXT,
  source                    TEXT,
  tags                      TEXT[],

  -- GHL custom fields
  main_problem              TEXT,
  marketing_consent         BOOLEAN DEFAULT false,
  preferred_contact_method  TEXT,               -- mail | whatsapp | telefon
  patient_priority          TEXT,               -- estetyka | zdrowie | funkcja | ból
  referral_type             TEXT,               -- lekarz | znajomy | brak
  referral_details          TEXT,

  -- Status pacjenta
  is_new_patient            BOOLEAN DEFAULT true,
  first_contact_date        TIMESTAMPTZ,
  first_call_id             TEXT,

  -- Czas reakcji
  lead_created_at           TIMESTAMPTZ,
  first_call_at             TIMESTAMPTZ,
  response_time_minutes     INTEGER,

  -- Stan W0
  w0_scheduled              BOOLEAN DEFAULT false,
  w0_date                   TIMESTAMPTZ,
  w0_doctor                 TEXT,

  -- Cache ostatniego raportu
  last_call_status          TEXT,
  last_call_effect          TEXT,
  last_call_date            TIMESTAMPTZ,
  last_call_program         TEXT,

  -- GHL pipeline
  ghl_opportunity_id        TEXT,
  ghl_stage_id              TEXT,
  ghl_stage_name            TEXT,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_contacts_phone         ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email         ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_w0            ON contacts(w0_scheduled) WHERE w0_scheduled = true;
CREATE INDEX IF NOT EXISTS idx_contacts_stage         ON contacts(ghl_stage_id);
CREATE INDEX IF NOT EXISTS idx_contacts_is_new_patient ON contacts(is_new_patient);
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_id        ON contacts(ghl_contact_id);

-- RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all contacts" ON contacts;
CREATE POLICY "Allow all contacts" ON contacts FOR ALL USING (true) WITH CHECK (true);

-- Trigger
DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ==============================================================================
-- TABELA: tasks
-- ==============================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  contact_id      TEXT,
  contact_name    TEXT,
  due_date        TIMESTAMPTZ,
  assigned_to     TEXT,
  assigned_to_name TEXT,
  status          TEXT DEFAULT 'open',    -- open | completed | deleted | urgent
  pool            BOOLEAN DEFAULT false,  -- true = w puli (nieprzypisane)
  created_by      TEXT,
  ghl_task_id     TEXT,

  -- Reception OS
  task_type       TEXT DEFAULT 'manual',  -- manual | follow_up_call | lead_contact
  follow_up_delay TEXT,                   -- 1d | 3d | 7d
  is_urgent       BOOLEAN DEFAULT FALSE,
  rejected_reason TEXT,
  completed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to  ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_pool         ON tasks(pool);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at   ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type    ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_is_urgent    ON tasks(is_urgent) WHERE is_urgent = true;

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all tasks" ON tasks;
CREATE POLICY "Allow all tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);


-- ==============================================================================
-- TABELA: chat_messages
-- ==============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  conv_key    TEXT NOT NULL,
  from_user   TEXT NOT NULL,
  from_name   TEXT,
  to_user     TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_key    ON chat_messages(conv_key);
CREATE INDEX IF NOT EXISTS idx_chat_created_at  ON chat_messages(created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all chat" ON chat_messages;
CREATE POLICY "Allow all chat" ON chat_messages FOR ALL USING (true) WITH CHECK (true);


-- ==============================================================================
-- TABELA: user_activity  (status i aktywność recepcji)
-- ==============================================================================
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


-- ==============================================================================
-- TABELA: events  (log zdarzeń systemu)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS events (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type   TEXT NOT NULL,   -- visit_cancelled | follow_up_created | task_assigned | call_missed
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


-- ==============================================================================
-- TABELA: edit_requests  (prośby recepcji o edycję danych kontaktu)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS edit_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    TEXT,
  contact_name  VARCHAR(255),
  requested_by  VARCHAR(100),
  field_name    VARCHAR(100),   -- phone | email | name | address | source | notes | other
  old_value     TEXT,
  new_value     TEXT,
  notes         TEXT,
  status        VARCHAR(50) DEFAULT 'pending',  -- pending | approved | rejected
  resolved_at   TIMESTAMPTZ,
  resolved_by   VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_requests_status  ON edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_contact ON edit_requests(contact_id);

ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Zezwalaj na wszystko dla edit_requests" ON edit_requests;
CREATE POLICY "Zezwalaj na wszystko dla edit_requests" ON edit_requests FOR ALL USING (true);


-- ==============================================================================
-- WERYFIKACJA — pokaż strukturę wszystkich tabel
-- ==============================================================================
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('calls', 'contacts', 'tasks', 'chat_messages', 'user_activity', 'events', 'edit_requests')
ORDER BY table_name, ordinal_position;
