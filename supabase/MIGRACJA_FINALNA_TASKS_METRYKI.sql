-- ============================================================
-- Navigator Hubb — Migracja Finalna: Zadania i Metryki
-- Data: 2026-04-24
-- ============================================================

-- 1. Rozszerzenie tabeli TASKS
-- Upewnienie się że kolumny istnieją i ujednolicenie statusów
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'manual'; -- manual, follow_up_call, lead_contact
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phone TEXT; -- Numer telefonu pacjenta bezpośrednio w tasku
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS follow_up_delay TEXT;

-- Ujednolicenie statusów (pending, in_progress, done, rejected)
UPDATE tasks SET status = 'pending' WHERE status = 'open' OR status IS NULL;
UPDATE tasks SET status = 'done' WHERE status = 'completed';

-- 2. Rozszerzenie tabeli CONTACTS o metryki czasu i statusy
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_created_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_scheduled_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER; -- Lead -> Pierwszy kontakt
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_to_w0_days INTEGER;      -- Lead -> W0 zapis
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_wait_days INTEGER;         -- W0 zapis -> Data wizyty
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_status TEXT;           -- Status operacyjny kontaktu

-- 3. Rozszerzenie tabeli CALLS o powód odwołania
ALTER TABLE calls ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- 4. Tabela USER_ACTIVITY (Online status & Heartbeat)
CREATE TABLE IF NOT EXISTS user_activity (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE,
  user_name       TEXT,
  last_login_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  is_online       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_contacts_lead_created_at ON contacts(lead_created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_phone ON tasks(phone);
CREATE INDEX IF NOT EXISTS idx_tasks_status_pool ON tasks(status, pool);
CREATE INDEX IF NOT EXISTS idx_user_activity_last_seen ON user_activity(last_seen_at);
