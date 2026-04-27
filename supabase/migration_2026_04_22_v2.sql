-- ============================================================
-- Navigator Hubb — Migracja Supabase v2
-- Data: 2026-04-22
-- Uruchom w: Supabase Dashboard → SQL Editor → New query → Run
-- BEZPIECZNA: używa IF NOT EXISTS — nie niszczy danych
-- ============================================================

-- ─── Tabela CALLS — uzupełnienie brakujących kolumn ─────────
-- Kolumny z poprzedniej migracji (bezpieczne do ponownego uruchomienia)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_at  TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_by  TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_tag         TEXT;  -- connected / missed / ineffective

-- Kolumny wymagane przez nowe funkcje (historia kontaktu, ostatni status)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_patient_name TEXT;  -- imię wpisane ręcznie w raporcie (gdy brak GHL)

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_calls_updated_at   ON calls(updated_at);
CREATE INDEX IF NOT EXISTS idx_calls_user_id      ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_ghl_contact  ON calls(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_recording    ON calls(recording_url) WHERE recording_url IS NOT NULL;

-- ─── Weryfikacja — sprawdź co jest w bazie ──────────────────
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'calls'
ORDER BY ordinal_position;
