-- ==============================================================================
-- MIGRATION: Reception OS Final (Doprecyzowanie logiki biznesowej)
-- ==============================================================================

-- 1. Nowe pacjenty vs wizyty (Rozdzielenie pojęć)
-- Dodajemy is_new_patient do kontaktów (jeśli jeszcze nie ma, lub upewniamy się że jest)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_new_patient BOOLEAN DEFAULT true;

-- Typ rozmowy (call_type) w tabeli calls
-- Typy: 'first_call', 'follow_up', 'visit_related', 'other'
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_type VARCHAR(50);

-- 2. Czas reakcji
-- Dodajemy pola do mierzenia czasu reakcji
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_created_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_call_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER;

-- 3. Follow-up status
-- Rozszerzamy tabelę tasks o status follow-upu (jeśli task_type = 'follow_up_call')
-- statusy: 'pending', 'done', 'overdue'
-- Kolumna status już istnieje, dodajemy ew. kolumnę na czas wykonania
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 4. Prośby o edycję danych (Edit Requests)
CREATE TABLE IF NOT EXISTS edit_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id VARCHAR(100) REFERENCES contacts(ghl_contact_id) ON DELETE CASCADE,
    contact_name VARCHAR(255),
    requested_by VARCHAR(100),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    notes TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(100)
);

-- Indeksy dla optymalizacji
CREATE INDEX IF NOT EXISTS idx_contacts_is_new_patient ON contacts(is_new_patient);
CREATE INDEX IF NOT EXISTS idx_calls_call_type ON calls(call_type);
CREATE INDEX IF NOT EXISTS idx_edit_requests_status ON edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_edit_requests_contact ON edit_requests(contact_id);

-- RLS dla nowej tabeli
ALTER TABLE edit_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Zezwalaj na wszystko dla edit_requests" ON edit_requests FOR ALL USING (true);
