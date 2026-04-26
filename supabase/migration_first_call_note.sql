-- Migracja: dodanie pól notatki z pierwszej rozmowy i statusu kontaktu
-- Uruchom w Supabase SQL Editor

-- Kontakty — notatka z pierwszej rozmowy (trwale przypisana do kontaktu)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_note      TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_by        TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_status       TEXT;  -- nowy_pacjent, staly_pacjent, itp.

-- Połączenia — notatka z pierwszej rozmowy (kopia w tabeli calls)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS first_call_note         TEXT;
