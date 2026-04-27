-- Navigator Call v6 — Migration: Reception OS
-- 1. Rozbudowa tabeli calls (Metryki i Odwołania)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_booked_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN DEFAULT FALSE;

-- 2. Rozbudowa tabeli tasks (System Follow-up i Statusy)
-- Najpierw upewnijmy się, że mamy odpowiednie statusy (rozszerzamy istniejące open/completed/deleted)
-- Nowe statusy: open_pool | assigned | in_progress | done | rejected | urgent
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'manual'; -- manual | follow_up_call | lead_contact
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS follow_up_delay TEXT; -- 1d | 3d | 7d
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- 3. Tabela aktywności użytkowników (Kontrola pracy recepcji)
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  last_login_at TIMESTAMPTZ DEFAULT NOW(),
  is_active_today BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);

-- 4. Tabela eventów (System dowodzenia)
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL, -- visit_cancelled | follow_up_created | task_assigned | call_missed
  contact_id TEXT,
  contact_name TEXT,
  user_id TEXT,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_contact ON events(contact_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- RLS dla nowych tabel
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all user_activity" ON user_activity FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all events" ON events FOR ALL USING (true) WITH CHECK (true);
