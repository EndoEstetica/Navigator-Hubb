-- ============================================================
-- Navigator-Hubb — Migracja: Brakujące kolumny
-- Uruchom w: Supabase Dashboard → SQL Editor → New query → Run
-- BEZPIECZNY: używa IF NOT EXISTS — nie niszczy istniejących danych
-- ============================================================

-- TABELA: calls — brakujące kolumny
ALTER TABLE calls ADD COLUMN IF NOT EXISTS scheduled_w0    BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_doctor       TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type       TEXT DEFAULT 'follow_up';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS first_call_note TEXT;

-- TABELA: contacts — brakujące kolumny
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_note TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_by  TEXT;

-- Indeksy (opcjonalne, ale zalecane dla wydajności)
CREATE INDEX IF NOT EXISTS idx_calls_scheduled_w0  ON calls(scheduled_w0) WHERE scheduled_w0 = true;
CREATE INDEX IF NOT EXISTS idx_calls_call_type     ON calls(call_type);

-- Weryfikacja — powinny pojawić się wszystkie nowe kolumny
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'calls'    AND column_name IN ('scheduled_w0','w0_doctor','call_type','first_call_note'))
    OR
    (table_name = 'contacts' AND column_name IN ('first_call_note','first_call_by'))
  )
ORDER BY table_name, column_name;
