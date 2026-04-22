-- Navigator Call v6 — Supabase Schema
-- Uruchom ten SQL w Supabase Dashboard → SQL Editor → New query → Run

-- Usuń starą tabelę
DROP TABLE IF EXISTS calls;

-- Tabela połączeń
CREATE TABLE calls (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT UNIQUE NOT NULL,
  pbx_call_id TEXT,
  caller_phone TEXT,
  called_phone TEXT,
  direction TEXT DEFAULT 'inbound',
  status TEXT DEFAULT 'ringing',
  duration_seconds INTEGER DEFAULT 0,
  recording_url TEXT,
  
  -- Dane pacjenta
  patient_name TEXT,
  gender TEXT,
  birth_date TEXT,
  
  -- GHL
  ghl_contact_id TEXT,
  ghl_logged BOOLEAN DEFAULT FALSE,
  
  -- Raport — Krok 1 (Klasyfikacja)
  contact_type TEXT,          -- nowy / staly / wizyta / nie_pacjent
  call_reason TEXT,           -- bol_pilne / estetyka / implanty / konsultacja / cena
  temperature TEXT,           -- goracy / cieply / zimny
  objections TEXT,            -- JSON array: ["cena","strach","czas","zaufanie"]
  
  -- Raport — Krok 2 (Wynik rozmowy)
  call_effect TEXT,           -- umowiony_w0 / followup / brak_decyzji / nieodebrane
  booked_visit BOOLEAN DEFAULT FALSE,
  
  -- Raport — Krok 3 (Dodatkowe dane)
  source TEXT,
  treatment TEXT,
  referred_by TEXT,
  notes TEXT,
  user_id TEXT,
  
  -- Temat
  topic_closed BOOLEAN DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  contact_attempts INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

-- Indeksy
CREATE INDEX idx_calls_call_id ON calls(call_id);
CREATE INDEX idx_calls_topic_closed ON calls(topic_closed);
CREATE INDEX idx_calls_created_at ON calls(created_at);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_contact_type ON calls(contact_type);

-- RLS
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON calls FOR ALL USING (true) WITH CHECK (true);

-- ─── Tabela wiadomości czatu ─────────────────────────────────────────────────
DROP TABLE IF EXISTS chat_messages;

CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  conv_key TEXT NOT NULL,        -- klucz konwersacji: sorted user1:user2
  from_user TEXT NOT NULL,
  from_name TEXT,
  to_user TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_conv_key ON chat_messages(conv_key);
CREATE INDEX idx_chat_created_at ON chat_messages(created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all chat" ON chat_messages FOR ALL USING (true) WITH CHECK (true);

-- ─── Tabela zadań (tasks) — trwałe przechowywanie zadań ─────────────────────
-- Uruchom ten SQL w Supabase Dashboard → SQL Editor → New query → Run

CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  contact_id TEXT,
  contact_name TEXT,
  due_date TIMESTAMPTZ,
  assigned_to TEXT,
  assigned_to_name TEXT,
  status TEXT DEFAULT 'open',    -- open | completed | deleted
  pool BOOLEAN DEFAULT false,    -- true = w puli (nieprzypisane)
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ghl_task_id TEXT               -- ID zadania w GoHighLevel
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_pool ON tasks(pool);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);
