-- ==============================================================================
-- NAPRAWA BAZY DANYCH NAVIGATOR-HUBB
-- Uruchom ten skrypt w Supabase Dashboard -> SQL Editor
-- Rozwiązuje problemy z: zawieszaniem się zapisu, brakiem statusu "Uzupełniony"
-- ==============================================================================

-- 1. Dodanie brakujących kolumn do tabeli 'calls'
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS report_saved_by TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_tag TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS scheduled_w0 BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_booked_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_first_call BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type_label TEXT;

-- 2. Dodanie brakujących kolumn do tabeli 'contacts'
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_scheduled BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS w0_doctor TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Utworzenie indeksów dla przyspieszenia odświeżania
CREATE INDEX IF NOT EXISTS idx_calls_report_saved_at ON calls(report_saved_at);
CREATE INDEX IF NOT EXISTS idx_calls_ghl_contact_id ON calls(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_calls_updated_at ON calls(updated_at);

-- 4. Funkcja do automatycznej aktualizacji updated_at (opcjonalnie)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 5. Triggery (opcjonalnie)
DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON calls FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- WERYFIKACJA: Sprawdź czy kolumny istnieją
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'calls' AND column_name IN ('report_saved_at', 'report_saved_by', 'call_tag');
