-- ================================================================
-- Migration: Notatki GHL + Typ połączenia (pierwsze/kolejne)
-- Navigator-Hubb v2 — 2026
-- ================================================================
-- Uruchom w Supabase SQL Editor

-- 1. Dodaj kolumny do tabeli calls
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS is_first_call    BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS call_type_label  TEXT    DEFAULT NULL;
  -- Wartości call_type_label: 'PIERWSZE_POLACZENIE' | 'KOLEJNE_POLACZENIE'

-- 2. Indeks dla szybkiego filtrowania pierwszych połączeń
CREATE INDEX IF NOT EXISTS idx_calls_is_first_call
  ON calls (is_first_call)
  WHERE is_first_call = TRUE;

-- 3. Indeks dla call_type_label
CREATE INDEX IF NOT EXISTS idx_calls_call_type_label
  ON calls (call_type_label);

-- Sprawdź wynik:
-- SELECT call_id, patient_name, is_first_call, call_type_label FROM calls LIMIT 10;
