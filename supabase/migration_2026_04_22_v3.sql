-- ============================================================
-- Migration v3 — 2026-04-22
-- Architektura danych: nowy pacjent / W0 / rozmowy
-- ============================================================

-- 1. Tabela contacts — lokalna kopia danych z GHL + pola własne
-- Przechowuje "jedno źródło prawdy" dla kontaktu
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,                          -- GHL contact ID
  location_id TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  tags TEXT[],
  
  -- Pola z GHL custom fields (zmapowane po ID)
  main_problem TEXT,                            -- k1OizGtL0V6IaWjGlVBK
  marketing_consent BOOLEAN DEFAULT false,      -- R0X7n8GG7545mnrGnREg
  preferred_contact_method TEXT,                -- mail / whatsapp / telefon
  patient_priority TEXT,                        -- estetyka / zdrowie / funkcja / ból
  referral_type TEXT,                           -- lekarz / znajomy / brak
  referral_details TEXT,                        -- szczegóły polecenia
  
  -- Status pacjenta (zarządzany przez aplikację)
  is_new_patient BOOLEAN DEFAULT true,          -- ustawiany raz, przy pierwszej rozmowie
  first_contact_date TIMESTAMPTZ,               -- data pierwszego kontaktu
  first_call_id TEXT,                           -- ID pierwszej rozmowy
  
  -- Stan W0 (globalny — aktualizowany z każdej rozmowy)
  w0_scheduled BOOLEAN DEFAULT false,
  w0_date TIMESTAMPTZ,
  w0_doctor TEXT,
  
  -- Ostatni status z raportu (cache dla wydajności)
  last_call_status TEXT,                        -- nowy_pacjent / staly_pacjent / biezaca_wizyta / pomylka
  last_call_effect TEXT,                        -- wynik ostatniej rozmowy
  last_call_date TIMESTAMPTZ,                   -- data ostatniej rozmowy
  last_call_program TEXT,                       -- ostatni sugerowany program
  
  -- GHL pipeline
  ghl_opportunity_id TEXT,
  ghl_stage_id TEXT,
  ghl_stage_name TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_w0 ON contacts(w0_scheduled) WHERE w0_scheduled = true;
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(ghl_stage_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all contacts" ON contacts FOR ALL USING (true) WITH CHECK (true);

-- 2. Rozszerzenie tabeli calls o pola z rekomendowanej architektury
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type TEXT DEFAULT 'follow_up';  -- first_call / follow_up
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_qualified BOOLEAN;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS disqualification_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS scheduled_w0 BOOLEAN DEFAULT false;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_date TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS w0_doctor TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS potential_program TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_patient_name TEXT;

-- Indeks dla historii kontaktu
CREATE INDEX IF NOT EXISTS idx_calls_contact_type ON calls(call_type);
CREATE INDEX IF NOT EXISTS idx_calls_scheduled_w0 ON calls(scheduled_w0) WHERE scheduled_w0 = true;

-- 3. Funkcja automatycznie aktualizująca updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger dla contacts
DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger dla calls (jeśli nie istnieje)
DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Weryfikacja — pokaż strukturę tabel
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name IN ('calls', 'contacts', 'tasks')
ORDER BY table_name, ordinal_position;
