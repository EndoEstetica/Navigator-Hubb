-- Navigator Call v6 — Supabase Schema
-- Uruchom ten SQL w Supabase Dashboard → SQL Editor → New query → Run

-- Tabela połączeń
CREATE TABLE IF NOT EXISTS calls (
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
  
  -- Raport
  call_effect TEXT,
  temperature INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_calls_call_id ON calls(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_topic_closed ON calls(topic_closed);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);

-- RLS (Row Level Security) — wyłączony dla prostoty
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON calls FOR ALL USING (true) WITH CHECK (true);
