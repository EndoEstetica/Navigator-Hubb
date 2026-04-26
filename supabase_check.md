# Weryfikacja bazy danych Supabase dla Navigator-Hubb

Aby upewnić się, że Twoja baza danych w Supabase zawiera wszystkie tabele i kolumny wymagane przez najnowszą wersję kodu aplikacji (szczególnie moduł Reception OS i raportowanie połączeń), przygotowałem poniższą checklistę oraz skrypt diagnostyczny.

Kod aplikacji (`server.js`) w wielu miejscach odwołuje się do specyficznych kolumn. Brak którejkolwiek z nich spowoduje błędy przy zapisie raportu lub wyświetlaniu pop-upu.

## Skrypt weryfikacyjny (do uruchomienia w Supabase)

Skopiuj poniższy kod SQL i uruchom go w **Supabase Dashboard → SQL Editor → New query → Run**. Wynik pokaże, czy brakuje jakichkolwiek krytycznych kolumn w głównych tabelach.

```sql
-- Skrypt sprawdzający obecność kluczowych tabel i kolumn w Navigator-Hubb
DO $$
DECLARE
    missing_cols TEXT := '';
    check_col RECORD;
BEGIN
    -- Lista wymaganych kolumn w formacie 'tabela.kolumna'
    FOR check_col IN SELECT * FROM (VALUES 
        -- Tabela: calls
        ('calls', 'call_id'), ('calls', 'pbx_call_id'), ('calls', 'recording_url'), 
        ('calls', 'contact_type'), ('calls', 'call_effect'), ('calls', 'treatment'), 
        ('calls', 'call_reason'), ('calls', 'scheduled_w0'), ('calls', 'w0_date'), 
        ('calls', 'w0_doctor'), ('calls', 'cancellation_reason'), ('calls', 'is_follow_up'), 
        ('calls', 'first_call_at'), ('calls', 'w0_booked_at'), ('calls', 'call_type'),
        ('calls', 'first_call_note'),
        
        -- Tabela: contacts
        ('contacts', 'ghl_contact_id'), ('contacts', 'phone'), ('contacts', 'email'),
        ('contacts', 'is_new_patient'), ('contacts', 'w0_scheduled'), ('contacts', 'w0_date'),
        ('contacts', 'first_call_at'), ('contacts', 'response_time_minutes'), 
        ('contacts', 'lead_to_w0_days'), ('contacts', 'w0_wait_days'), 
        ('contacts', 'lead_created_at'), ('contacts', 'contact_status'),
        ('contacts', 'first_call_note'), ('contacts', 'first_call_by'),
        
        -- Tabela: tasks
        ('tasks', 'contact_id'), ('tasks', 'due_date'), ('tasks', 'assigned_to'),
        ('tasks', 'status'), ('tasks', 'pool'), ('tasks', 'ghl_task_id'),
        ('tasks', 'task_type'), ('tasks', 'phone'), ('tasks', 'follow_up_delay'),
        ('tasks', 'is_urgent'), ('tasks', 'completed_at'),
        
        -- Tabela: events
        ('events', 'event_type'), ('events', 'contact_id'), ('events', 'description'),
        ('events', 'metadata'), ('events', 'source'),
        
        -- Tabela: edit_requests
        ('edit_requests', 'contact_id'), ('edit_requests', 'field_name'),
        ('edit_requests', 'status'),
        
        -- Tabela: user_activity
        ('user_activity', 'user_id'), ('user_activity', 'is_online')
    ) AS t(table_name, column_name)
    LOOP
        -- Sprawdzenie czy kolumna istnieje
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = check_col.table_name 
              AND column_name = check_col.column_name
        ) THEN
            missing_cols := missing_cols || check_col.table_name || '.' || check_col.column_name || E'\n';
        END IF;
    END LOOP;

    IF missing_cols = '' THEN
        RAISE NOTICE '✅ Wszystkie kluczowe kolumny i tabele ISTNIEJĄ!';
    ELSE
        RAISE EXCEPTION '❌ BRAKUJĄCE KOLUMNY: %', E'\n' || missing_cols;
    END IF;
END $$;
```

## Checklista najważniejszych zmian z ostatnich migracji

Z analizy kodu wynika, że najczęstszym powodem problemów są brakujące kolumny z najnowszych migracji (tzw. "Reception OS"). Upewnij się, że posiadasz następujące struktury:

### 1. Tabela `contacts` (Zarządzanie pacjentami)
Aplikacja intensywnie używa tej tabeli do mierzenia czasu reakcji i śledzenia statusu "nowy pacjent".
Wymagane nowe kolumny:
- `is_new_patient` (BOOLEAN)
- `lead_created_at` (TIMESTAMPTZ)
- `first_call_at` (TIMESTAMPTZ)
- `response_time_minutes` (INTEGER)
- `w0_scheduled` (BOOLEAN)
- `first_call_note` (TEXT) - wprowadzona w najnowszej migracji
- `contact_status` (TEXT)

### 2. Tabela `calls` (Raportowanie)
Gdy konsultant zapisuje raport, kod próbuje zaktualizować te pola. Jeśli ich brakuje, zapis kończy się błędem (często ukrytym przed użytkownikiem).
Wymagane nowe kolumny:
- `call_type` (TEXT) - określa czy to pierwszy kontakt, czy follow-up
- `cancellation_reason` (TEXT) - powód odwołania wizyty
- `is_follow_up` (BOOLEAN)
- `w0_booked_at` (TIMESTAMPTZ)
- `first_call_note` (TEXT)

### 3. Tabela `tasks` (Zadania i Follow-upy)
System automatycznie tworzy zadania (np. po odwołaniu wizyty bez nowego terminu).
Wymagane nowe kolumny:
- `task_type` (TEXT) - np. 'follow_up_call'
- `phone` (TEXT) - numer pacjenta (dodany niedawno dla wygody recepcji)
- `follow_up_delay` (TEXT)
- `is_urgent` (BOOLEAN)

### 4. Nowe tabele wspierające
- **`events`**: Tabela osi czasu pacjenta (historia aktywności, notatki, zmiany statusu).
- **`edit_requests`**: Tabela przechowująca prośby o edycję danych kontaktu wysyłane do "Soni".
- **`user_activity`**: Tabela śledząca, kto jest aktualnie online (funkcja heartbeat).

## Jak naprawić braki?

Jeśli powyższy skrypt wskaże brakujące kolumny, najlepszym rozwiązaniem jest uruchomienie kompletnego skryptu migracyjnego przygotowanego w repozytorium, który zawiera instrukcje `IF NOT EXISTS` (jest w pełni bezpieczny dla istniejących danych).

Plik ten znajduje się w repozytorium pod ścieżką:
`/supabase/FULL_SCHEMA_ALL_MIGRATIONS.sql`

Wystarczy skopiować jego zawartość i uruchomić w edytorze SQL w Supabase. Skrypt ten automatycznie utworzy brakujące tabele i doda wszystkie nowe kolumny do istniejących tabel, zachowując obecne dane pacjentów i nagrania.
