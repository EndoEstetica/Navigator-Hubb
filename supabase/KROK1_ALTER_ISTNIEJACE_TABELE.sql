-- ==============================================================================
-- KROK 1 — URUCHOM JAKO PIERWSZY
-- Bezpieczne rozszerzenie istniejących tabel (calls, contacts, tasks)
-- Używa ALTER TABLE ADD COLUMN IF NOT EXISTS — nie niszczy danych
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: calls — nowe kolumny Reception OS
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_patient_name     TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type               TEXT DEFAULT 'follow_up';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_new_patient          BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS scheduled_w0            BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_date                 TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_doctor               TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_qualified            BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS disqualification_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS potential_program       TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS cancellation_reason     TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_follow_up            BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS first_call_at           TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_booked_at            TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_at         TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_by         TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_tag                TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS answered_at             TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_at                TIMESTAMPTZ;

-- Indeksy dla nowych kolumn calls
CREATE INDEX IF NOT EXISTS idx_calls_call_type     ON calls(call_type);
CREATE INDEX IF NOT EXISTS idx_calls_updated_at    ON calls(updated_at);
CREATE INDEX IF NOT EXISTS idx_calls_user_id       ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_ghl_contact   ON calls(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_scheduled_w0  ON calls(scheduled_w0) WHERE scheduled_w0 = true;
CREATE INDEX IF NOT EXISTS idx_calls_recording     ON calls(recording_url) WHERE recording_url IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: tasks — nowe kolumny Reception OS
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type        TEXT DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS follow_up_delay  TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_urgent        BOOLEAN DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rejected_reason  TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_task_type  ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_is_urgent  ON tasks(is_urgent) WHERE is_urgent = true;

-- ──────────────────────────────────────────────────────────────────────────────
-- TABELA: contacts — nowe kolumny Reception OS
-- (tylko jeśli tabela contacts już istnieje — jeśli nie, uruchom KROK 2)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_new_patient           BOOLEAN DEFAULT true;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_created_at          TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_at            TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS response_time_minutes    INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_scheduled             BOOLEAN DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_date                  TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_doctor                TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_call_status         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_call_effect         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_call_date           TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_call_program        TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_opportunity_id       TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_stage_id             TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ghl_stage_name           TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referral_type            TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referral_details         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS patient_priority         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS marketing_consent        BOOLEAN DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS main_problem             TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_contact_date       TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_id            TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_is_new_patient ON contacts(is_new_patient);
CREATE INDEX IF NOT EXISTS idx_contacts_w0             ON contacts(w0_scheduled) WHERE w0_scheduled = true;
CREATE INDEX IF NOT EXISTS idx_contacts_stage          ON contacts(ghl_stage_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Funkcja auto-update updated_at
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ──────────────────────────────────────────────────────────────────────────────
-- Weryfikacja — pokaż kolumny tabel calls i tasks
-- ──────────────────────────────────────────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('calls', 'contacts', 'tasks')
ORDER BY table_name, ordinal_position;
