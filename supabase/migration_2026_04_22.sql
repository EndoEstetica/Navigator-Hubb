-- ============================================================
-- Navigator Hubb — Migracja Supabase
-- Data: 2026-04-22
-- Uruchom w: Supabase Dashboard → SQL Editor → New query → Run
-- BEZPIECZNA: używa IF NOT EXISTS / IF EXISTS — nie niszczy danych
-- ============================================================

-- ─── 1. Tabela CALLS — dodaj brakujące kolumny ──────────────
-- (tabela już istnieje, tylko uzupełniamy brakujące pola)

ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_by TEXT;

-- Kolumna contact_type była używana jako "tag" (connected/missed/ineffective)
-- ale też jako status pacjenta (NOWY_PACJENT/STALY_PACJENT/WIZYTA_BIEZACA/SPAM)
-- Dodajemy osobną kolumnę na tag połączenia żeby nie mieszać
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_tag TEXT;  -- connected / missed / ineffective

-- Indeks na updated_at (dla raportów historycznych)
CREATE INDEX IF NOT EXISTS idx_calls_updated_at ON calls(updated_at);
CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);

-- ─── 2. Tabela TASKS — upewnij się że istnieje ──────────────
-- (powinna już być z poprzedniej migracji, IF NOT EXISTS jest bezpieczne)

CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  contact_id TEXT,
  contact_name TEXT,
  due_date TIMESTAMPTZ,
  assigned_to TEXT,
  assigned_to_name TEXT,
  status TEXT DEFAULT 'open',
  pool BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ghl_task_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_pool ON tasks(pool);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- RLS dla tasks (jeśli jeszcze nie ma)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'Allow all tasks'
  ) THEN
    CREATE POLICY "Allow all tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 3. Tabela CHAT_MESSAGES — upewnij się że istnieje ──────
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  conv_key TEXT NOT NULL,
  from_user TEXT NOT NULL,
  from_name TEXT,
  to_user TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_key ON chat_messages(conv_key);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'Allow all chat'
  ) THEN
    CREATE POLICY "Allow all chat" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 4. Weryfikacja — sprawdź co zostało utworzone ──────────
SELECT 
  table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('calls', 'tasks', 'chat_messages')
GROUP BY table_name
ORDER BY table_name;
