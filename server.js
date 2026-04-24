require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;
if (supabase) console.log('[Supabase] Połączono');
else console.warn('[Supabase] Brak kluczy — dane w pamięci RAM (znikną po restarcie)');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── URL produkcyjny (do konfiguracji w panelu Zadarma) ────────────────────────
// Webhook Zadarma: https://navigator-hubb.onrender.com/webhook/zadarma
// Wejdź w Zadarma → Ustawienia → API i Webhooks → Webhook URL → wpisz powyższy adres

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PATCH', 'DELETE']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ← Zadarma wysyła webhooki jako form-urlencoded
app.use(express.static(path.join(__dirname, 'public')));

// ─── Konfiguracja ─────────────────────────────────────────────────────────────
// Obsługa aliasów zmiennych środowiskowych (kompatybilność z różnymi wersjami .env)
const GHL_TOKEN        = process.env.GHL_API_TOKEN || process.env.GHL_TOKEN;
const GHL_LOCATION_ID  = process.env.GHL_LOCATION_ID;
const GHL_PIPELINE_ID  = process.env.GHL_PIPELINE_ID;
const GHL_SONIA_USER_ID = process.env.GHL_SONIA_USER_ID || 'MPfq6I0r42R3P50ZqJ3V';
const ZADARMA_KEY      = process.env.ZADARMA_API_KEY || process.env.ZADARMA_KEY;
const ZADARMA_SECRET   = process.env.ZADARMA_API_SECRET || process.env.ZADARMA_SECRET;

const ghlHeaders = {
  'Authorization': `Bearer ${GHL_TOKEN}`,
  'Content-Type': 'application/json',
  'Version': '2021-07-28'
};

// ─── SYSTEM UŻYTKOWNIKÓW (przeniesione wyżej — wymagane przed handlerami) ─────
const USERS = {
  kasia:      { id: 'kasia',      name: 'Kasia',         role: 'reception', ext: '103', ghlUserId: '3QCy7rl8W0UmUH9eelOe' },
  agnieszka:  { id: 'agnieszka',  name: 'Agnieszka',     role: 'reception', ext: '103', ghlUserId: 'QGSNWPj1RAflM2oVIkiF' },
  asia:       { id: 'asia',       name: 'Asia',           role: 'reception', ext: '103', ghlUserId: 'cKLX5NCjigFcAXgtNdn3' },
  agata_r:    { id: 'agata_r',    name: 'Agata',          role: 'reception', ext: '103', ghlUserId: 'gSCZaRsO5fmvUGIAj6AL' },
  zastepstwo: { id: 'zastepstwo', name: 'Zastępstwo',     role: 'reception', ext: '103', ghlUserId: null },
  agata_o:    { id: 'agata_o',    name: 'Agata Opiekun',  role: 'opiekun',   ext: '101', ghlUserId: 'gSCZaRsO5fmvUGIAj6AL' },
  aneta_o:    { id: 'aneta_o',    name: 'Aneta Opiekun',  role: 'opiekun',   ext: '102', ghlUserId: 'tJ66GMn7OXDBxWWkGis9I' },
  bartosz:    { id: 'bartosz',    name: 'Bartosz',        role: 'admin',     ext: null,  ghlUserId: null },
  sandra:     { id: 'sandra',     name: 'Sandra',         role: 'admin',     ext: null,  ghlUserId: null },
  aneta_a:    { id: 'aneta_a',    name: 'Aneta (A)',      role: 'admin',     ext: null,  ghlUserId: null },
  patrycja:   { id: 'patrycja',   name: 'Patrycja',       role: 'admin',     ext: null,  ghlUserId: null },
  sonia:      { id: 'sonia',      name: 'Sonia',          role: 'admin',     ext: null,  ghlUserId: GHL_SONIA_USER_ID },
};

// ─── STAGE IDs LEJKA GHL ──────────────────────────────────────────────────────
const GHL_STAGES = {
  '4d006021-f3b2-4efc-8efc-4f049522379c': 'Nowe zgłoszenie',
  '002dbc5a-c6a4-4931-a9a3-af4877b2c525': '1 próba kontaktu',
  'de0a619e-ee22-41c3-9a90-eccfcb1a8fb8': '2 próba kontaktu',
  '6d0c5ca9-8b79-4bf3-a091-381e636cd21e': 'Follow-up dzień 2',
  '53ad4911-a26c-41fa-9b23-bc3c88f98ea4': 'Follow-up dzień 4',
  '6517c39e-15fe-4041-a847-89ba822b3c96': 'Brak kontaktu',
  '19126f1b-5529-48fc-be95-d6b64e264e59': 'Po rozmowie',
  '73f6704f-1d6a-49dc-8591-4b129ba1b692': 'Umówiony W0',
  'afc5a678-b78b-47bd-858e-78968724ac4d': 'No-show',
  '139cde76-d37e-4a14-ad45-ae94a843d78b': 'Odmówił',
};
const STAGE_NEW           = '4d006021-f3b2-4efc-8efc-4f049522379c';
const STAGE_ATTEMPT_1     = '002dbc5a-c6a4-4931-a9a3-af4877b2c525';
const STAGE_ATTEMPT_2     = 'de0a619e-ee22-41c3-9a90-eccfcb1a8fb8';
const STAGE_AFTER_CALL    = '19126f1b-5529-48fc-be95-d6b64e264e59';
const STAGE_BOOKED_W0     = '73f6704f-1d6a-49dc-8591-4b129ba1b692';

// ─── GODZINY PRACY ───────────────────────────────────────────────────────────
// pon-pt 8:50-17:00, środa 10:50-20:00
function isOutsideWorkingHours(timestamp) {
  const d = new Date(timestamp);
  const day = d.getDay(); // 0=niedz, 1=pon...6=sob
  const h = d.getHours();
  const m = d.getMinutes();
  const time = h * 60 + m; // minuty od północy

  if (day === 0 || day === 6) return true; // weekend
  if (day === 3) return time < 650 || time >= 1200; // środa 10:50-20:00
  return time < 530 || time >= 1020; // pon-pt (bez śr) 8:50-17:00
}

// Wzbogać obiekt połączenia o agentName i outsideWorkingHours
function enrichCall(c) {
  // Agent name
  if (c.userId && USERS[c.userId]) {
    c.agentName = USERS[c.userId].name;
  } else if (!c.userId) {
    c.agentName = null; // nieprzypisane
  }
  // Godziny pracy
  if (c.timestamp) {
    c.outsideWorkingHours = isOutsideWorkingHours(c.timestamp);
  }
  return c;
}

// ─── In-memory store połączeń (I4: /api/calls) ───────────────────────────────
// Przechowuje połączenia z ostatnich 7 dni (max 500 rekordów)
const callsStore = [];
const MAX_CALLS = 500;

function storeCall(callObj) {
  // In-memory (szybkie)
  const idx = callsStore.findIndex(c => c.callId === callObj.callId);
  if (idx >= 0) {
    callsStore[idx] = { ...callsStore[idx], ...callObj };
  } else {
    callsStore.unshift(callObj);
    if (callsStore.length > MAX_CALLS) callsStore.pop();
  }
  // Supabase (trwałe) — async, nie blokuje
  if (supabase) {
    const merged = idx >= 0 ? callsStore[idx] : callObj;
    
    // Jeśli to aktualizacja istniejącego rekordu (np. tylko recording_url) — użyj UPDATE
    // aby nie nadpisać istniejących pól (np. recording_url) wartościami null
    if (idx >= 0 && Object.keys(callObj).length <= 3) {
      // Aktualizacja cząstkowa (np. tylko recordingUrl, status lub tag)
      const partialUpdate = {};
      if (callObj.recordingUrl !== undefined) partialUpdate.recording_url = callObj.recordingUrl;
      if (callObj.status !== undefined)       partialUpdate.status = callObj.status;
      if (callObj.tag !== undefined)          partialUpdate.contact_type = callObj.tag;
      if (callObj.duration !== undefined)     partialUpdate.duration_seconds = callObj.duration;
      if (callObj.answeredAt !== undefined)   partialUpdate.answered_at = callObj.answeredAt;
      if (callObj.endedAt !== undefined)      partialUpdate.ended_at = callObj.endedAt;
      if (callObj.contactName !== undefined)  partialUpdate.patient_name = callObj.contactName;
      if (callObj.contactId !== undefined)    partialUpdate.ghl_contact_id = callObj.contactId;
      if (callObj.pbxCallId !== undefined)    partialUpdate.pbx_call_id = callObj.pbxCallId;
      if (Object.keys(partialUpdate).length > 0) {
        supabase.from('calls').update(partialUpdate)
          .eq('call_id', merged.callId)
          .then(({ error }) => {
            if (error) console.error('[Supabase] storeCall partial update error:', error.message);
          });
      }
    } else {
      // Pełny upsert (nowy rekord lub duża aktualizacja)
      const upsertData = {
        call_id: merged.callId,
        pbx_call_id: merged.pbxCallId || null,
        caller_phone: merged.from || null,
        called_phone: merged.to || null,
        direction: merged.direction || 'inbound',
        status: merged.status || 'ringing',
        duration_seconds: merged.duration || 0,
        patient_name: merged.contactName || null,
        ghl_contact_id: merged.contactId || null,
        user_id: merged.userId || null,
        contact_type: merged.tag || null,
        created_at: merged.timestamp || new Date().toISOString(),
        answered_at: merged.answeredAt || null,
        ended_at: merged.endedAt || null,
      };
      // recording_url dodaj tylko jeśli jest ustawione — nie nadpisuj nullą
      if (merged.recordingUrl) upsertData.recording_url = merged.recordingUrl;
      
      supabase.from('calls').upsert(upsertData, { onConflict: 'call_id' }).then(({ error }) => {
        if (error) console.error('[Supabase] storeCall error:', error.message);
      });
    }
  }
}

function getRecentCalls(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return callsStore.filter(c => {
    if (new Date(c.timestamp).getTime() <= cutoff) return false;
    // Usuń techniczne wpisy PBX z numerem "0" lub pustym bez przypisanego pacjenta
    const isTechnical = (!c.from || c.from === '0') && (!c.to || c.to === '0') && !c.contactName;
    return !isTechnical;
  });
}

// Połączenia z dzisiejszego dnia kalendarzowego (od 00:00 do teraz) — deduplikowane
function getTodayCalls() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let calls = callsStore.filter(c => {
    const ts = new Date(c.timestamp).getTime();
    if (ts < todayMs) return false;
    const isTechnical = (!c.from || c.from === '0') && (!c.to || c.to === '0') && !c.contactName;
    return !isTechnical;
  });

  // Deduplikuj po pbxCallId
  const seenPbxIds = new Set();
  const unique = [];
  for (const c of calls) {
    if (c.pbxCallId && seenPbxIds.has(c.pbxCallId)) continue;
    if (c.pbxCallId) seenPbxIds.add(c.pbxCallId);
    unique.push(c);
  }
  return unique;
}

// Ładuj historię połączeń z Supabase przy starcie
async function loadCallsFromSupabase() {
  if (!supabase) return;
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // ostatnie 30 dni
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_CALLS);
    if (error) { console.error('[Supabase] loadCalls error:', error.message); return; }
    if (data && data.length > 0) {
      data.forEach(row => {
        const exists = callsStore.find(c => c.callId === row.call_id);
        if (!exists) {
          callsStore.push({
            callId: row.call_id,
            pbxCallId: row.pbx_call_id,
            from: row.caller_phone,
            to: row.called_phone,
            direction: row.direction,
            status: row.status,
            duration: row.duration_seconds,
            recordingUrl: row.recording_url,
            contactName: row.patient_name,
            contactId: row.ghl_contact_id,
            userId: row.user_id,
            tag: row.contact_type || (() => {
              // Odtwórz tag z status i direction gdy contact_type jest null
              if (row.status === 'ended' || row.status === 'missed') {
                if (row.duration_seconds > 0) return 'connected';
                if (row.direction === 'inbound') return 'missed';
                if (row.direction === 'outbound') return 'ineffective';
              }
              return row.status === 'active' ? 'connected' : null;
            })(),
            timestamp: row.created_at,
            answeredAt: row.answered_at,
            endedAt: row.ended_at,
          });
        }
      });
      console.log(`[Supabase] Załadowano ${data.length} połączeń z historii`);
    }
  } catch(e) {
    console.error('[Supabase] loadCalls exception:', e.message);
  }
}

// ─── Kolejka retry nagrań (D2) ────────────────────────────────────────────────
const recordingRetryQueue = new Map(); // callId → { attempts, pbxCallId, contactName }

// Mapa aktywnych użytkowników: ext → userId (aktualizowana przy logowaniu/heartbeat)
// Jedna osoba na jedno stanowisko jednocześnie
const activeExtMap = new Map(); // '103' → 'kasia', '101' → 'agata_o', '102' → 'aneta_o'
// Strategia retry: 5s, 30s, 1m, 2m, 5m, 10m, 20m, 30m, 60m
const RETRY_DELAYS = [5000, 30000, 60000, 120000, 300000, 600000, 1200000, 1800000, 3600000];

// ─── Zadarma — podpis API (zweryfikowany algorytm z dokumentacji Zadarma) ──────
// Źródło: support Zadarma + dokument "Moment Przełomowy"
// PHP: $sign = base64_encode(hash_hmac('sha1', $method.$paramsStr.md5($paramsStr), $secret))
// PHP hash_hmac domyślnie zwraca HEX → base64_encode koduje HEX string
function zadarmaSign(method, params) {
  // Sortuj i zakoduj (URLSearchParams = odpowiednik PHP http_build_query RFC1738)
  const sortedKeys = Object.keys(params).sort();
  const sorted = {};
  sortedKeys.forEach(k => sorted[k] = params[k]);
  const paramsStr = new URLSearchParams(sorted).toString();
  const md5Hash = crypto.createHash('md5').update(paramsStr).digest('hex');
  const signString = method + paramsStr + md5Hash;
  const hmacHex = crypto.createHmac('sha1', ZADARMA_SECRET.trim()).update(signString).digest('hex');
  return Buffer.from(hmacHex).toString('base64');
}

function zadarmaAuthHeader(sign) {
  return `${ZADARMA_KEY.trim()}:${sign}`;
}

// Weryfikacja podpisu webhooków Zadarma (inny wzór: tylko md5, bez method)
function verifyZadarmaWebhookSign(params, signature) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([k]) => k !== 'sign')
  );
  const sortedKeys = Object.keys(filtered).sort();
  const paramString = sortedKeys.map(k => `${k}=${filtered[k]}`).join('&');
  const md5Hash = crypto.createHash('md5').update(paramString).digest('hex');
  const expected = crypto.createHmac('sha1', ZADARMA_SECRET).update(md5Hash).digest('base64');
  return expected === signature;
}

async function fetchRecordingFromZadarma(pbxCallId) {
  if (!ZADARMA_KEY || !ZADARMA_SECRET) return null;
  
  // Zadarma API: GET /v1/pbx/record/request/
  // Parametr: pbx_call_id (permanent ID zewnętrznego połączenia)
  // Odpowiedź: { status: "success", link: "...", links: [...], lifetime_till: "..." }
  const endpoint = '/v1/pbx/record/request/';
  
  // Próbuj z pbx_call_id (główny parametr)
  const paramSets = [
    { pbx_call_id: pbxCallId },
    { call_id: pbxCallId }
  ];
  
  for (const params of paramSets) {
    try {
      const sign = zadarmaSign(endpoint, params);
      const sorted = {}; Object.keys(params).sort().forEach(k => sorted[k] = params[k]);
      const qs = new URLSearchParams(sorted).toString();
      
      console.log(`[Recording] Attempting ${endpoint} with params: ${qs}`);
      
      const response = await axios.get(
        `https://api.zadarma.com${endpoint}?${qs}`,
        { headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 15000 }
      );
      
      const data = response.data;
      // Zadarma zwraca: link (string) lub links (array) 
      const url = (Array.isArray(data?.links) && data.links.length > 0)
        ? data.links[0]
        : (data?.link || null);
        
      if (url) {
        console.log(`[Recording] SUCCESS for ${pbxCallId}: ${url}`);
        return url;
      }
      
      if (data?.status === 'success' && !url) {
        console.log(`[Recording] API returned success but no link for ${pbxCallId}:`, JSON.stringify(data));
      }
    } catch (e) {
      const status = e.response?.status;
      const errorMsg = e.response?.data?.message || e.response?.data?.error || e.message;
      console.log(`[Recording] ${endpoint} (${JSON.stringify(params)}) → HTTP ${status}: ${errorMsg}`);
      // Nie przerywaj — spróbuj z drugim zestawem parametrów
    }
  }
  return null;
}

/**
 * Kolejkuje próbę pobrania nagrania z mechanizmem retry.
 * Zapewnia idempotentność — nie dodaje dwa razy tego samego połączenia do kolejki.
 */
function scheduleRecordingFetch(callId, pbxCallId, contactName) {
  if (!pbxCallId) return;
  
  // Idempotentność: Jeśli już w kolejce, nie dodawaj ponownie
  if (recordingRetryQueue.has(callId)) {
    console.log(`[Recording] Skip schedule: ${callId} already in retry queue.`);
    return;
  }
  
  // Sprawdź czy już mamy nagranie (idempotentność bazy danych)
  const existing = callsStore.find(c => c.callId === callId);
  if (existing?.recordingUrl) {
    console.log(`[Recording] Skip schedule: ${callId} already has recording URL.`);
    return;
  }

  recordingRetryQueue.set(callId, { attempts: 0, pbxCallId, contactName, startTime: Date.now() });

  async function tryFetch() {
    const entry = recordingRetryQueue.get(callId);
    if (!entry) return;
    
    const { attempts, pbxCallId: pid } = entry;
    const url = await fetchRecordingFromZadarma(pid);
    
    if (url) {
      storeCall({ callId, recordingUrl: url });
      broadcast({ type: 'CALL_RECORDING_READY', callId, recordingUrl: url });
      recordingRetryQueue.delete(callId);
    } else {
      const nextAttempt = attempts + 1;
      if (nextAttempt < RETRY_DELAYS.length) {
        recordingRetryQueue.set(callId, { ...entry, attempts: nextAttempt });
        setTimeout(tryFetch, RETRY_DELAYS[nextAttempt]);
        console.log(`[Recording] RETRY ${nextAttempt}/${RETRY_DELAYS.length} for ${callId} in ${RETRY_DELAYS[nextAttempt]/1000}s`);
      } else {
        recordingRetryQueue.delete(callId);
        console.log(`[Recording] ERROR: Max retries reached for ${callId}. Recording might not be available on Zadarma.`);
      }
    }
  }

  // Pierwsza próba po 5s
  setTimeout(tryFetch, RETRY_DELAYS[0]);
}

/**
 * Background Fallback Poller:
 * Co 2 minuty sprawdza ostatnie 50 połączeń z callsStore.
 * Jeśli połączenie jest 'ended', trwało > 0s, ma pbxCallId, ale NIE ma recordingUrl 
 * i nie jest w kolejce retry — dodaje je do kolejki.
 * Zabezpiecza przed sytuacją, gdy webhook NOTIFY_END nie dotarł.
 */
async function startRecordingFallbackPoller() {
  console.log('[Poller] Starting Recording Fallback Poller (every 2m)');
  
  async function runPoll() {
    const now = Date.now();
    
    // 1. Sprawdz callsStore (in-memory)
    const inMemoryCandidates = callsStore.filter(c => 
      c.status === 'ended' && 
      c.duration > 0 && 
      c.pbxCallId && 
      !c.recordingUrl && 
      !recordingRetryQueue.has(c.callId) &&
      (now - new Date(c.timestamp).getTime()) < 24 * 60 * 60 * 1000
    ).slice(0, 10);

    // 2. Sprawdź Supabase (połączenia które mogły nie być w RAM po restarcie)
    let supabaseCandidates = [];
    if (supabase) {
      try {
        const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase.from('calls')
          .select('call_id, pbx_call_id, patient_name, recording_url, duration_seconds, status')
          .eq('status', 'ended')
          .gt('duration_seconds', 0)
          .is('recording_url', null)
          .gte('created_at', since)
          .limit(10);
        if (data && data.length > 0) {
          supabaseCandidates = data
            .filter(r => r.pbx_call_id && !recordingRetryQueue.has(r.call_id))
            .map(r => ({ callId: r.call_id, pbxCallId: r.pbx_call_id, contactName: r.patient_name }));
        }
      } catch(e) { /* ignoruj błędy Supabase w pollerze */ }
    }

    // Połącz i deduplikuj
    const allCandidates = [...inMemoryCandidates];
    const inMemoryIds = new Set(inMemoryCandidates.map(c => c.callId));
    supabaseCandidates.forEach(c => { if (!inMemoryIds.has(c.callId)) allCandidates.push(c); });

    if (allCandidates.length > 0) {
      console.log(`[Poller] Found ${allCandidates.length} calls missing recordings (${inMemoryCandidates.length} RAM, ${supabaseCandidates.length} Supabase). Scheduling fetch...`);
      allCandidates.forEach(c => {
        scheduleRecordingFetch(c.callId, c.pbxCallId, c.contactName);
      });
    }
  }
  
  setInterval(runPoll, 120000); // co 2 minuty
}

// Uruchom poller
startRecordingFallbackPoller();

// ─── WebSocket broadcast ──────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  // Wyślij ostatnie 20 połączeń do nowego klienta
  ws.send(JSON.stringify({ type: 'CALLS_HISTORY', calls: getRecentCalls(7).slice(0, 20) }));
  ws.on('close', () => console.log('WebSocket client disconnected'));
  // Obsługa wiadomości od klientów (chat)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'CHAT_MESSAGE') {
        broadcast({ type: 'CHAT_MESSAGE', from: msg.from, text: msg.text, ts: new Date().toISOString() });
      }
    } catch(e) {}
  });
});

// ─── GHL API ENDPOINTS ────────────────────────────────────────────────────────

// Nowe zgłoszenia z pipeline (Stage 1)
app.get('/api/opportunities/new', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${GHL_PIPELINE_ID}&limit=100`,
      { headers: ghlHeaders }
    );
    const data = response.data;
    const opportunities = data.opportunities || [];
    console.log(`[GHL] /opportunities/new: ${opportunities.length} szans w pipeline`);

    // Wzbogać o dane kontaktu (telefon, email, z_czym_si_zgasza, tagi)
    const enriched = await Promise.all(opportunities.map(async (opp) => {
      try {
        if (opp.contactId) {
          const contactResp = await axios.get(
            `https://services.leadconnectorhq.com/contacts/${opp.contactId}`,
            { headers: ghlHeaders }
          );
          const contact = contactResp.data.contact || contactResp.data;
          const customFields = contact.customFields || contact.customField || [];
          
          // Mapowanie GHL custom fields po rzeczywistych ID pól
          const GHL_FIELD_MAIN_PROBLEM     = 'k1OizGtL0V6IaWjGlVBK'; // "z czym się zgłasza"
          const GHL_FIELD_MARKETING        = 'R0X7n8GG7545mnrGnREg'; // zgoda marketingowa
          const GHL_FIELD_PREFERRED_CONTACT = 'preferred_contact_method'; // preferowany kanał
          const GHL_FIELD_PATIENT_PRIORITY  = 'patient_priority';         // priorytet pacjenta
          const GHL_FIELD_W0_DATE          = 'IUjxWY10y6kuITsSjfSw';     // data W0
          const GHL_FIELD_W0_NOTES         = 'v04mALNDZzMgyH8YzK46';     // notatki W0

          const getField = (id) => customFields.find(f => f.id === id);
          
          const mainProblem = getField(GHL_FIELD_MAIN_PROBLEM);
          const marketingConsent = getField(GHL_FIELD_MARKETING);
          const w0DateField = getField(GHL_FIELD_W0_DATE);
          const w0NotesField = getField(GHL_FIELD_W0_NOTES);

          opp.contact = {
            ...opp.contact,
            firstName: contact.firstName || opp.contact?.firstName,
            lastName:  contact.lastName  || opp.contact?.lastName,
            phone:     contact.phone     || opp.contact?.phone,
            email:     contact.email     || opp.contact?.email,
            tags:      contact.tags      || [],
            // Poprawne mapowanie po ID pól GHL
            z_czym_si_zgasza: mainProblem?.value || '',
            marketing_consent: marketingConsent?.value === 'tak' || marketingConsent?.value === true,
            w0_date: w0DateField?.value ? new Date(Number(w0DateField.value)).toISOString() : null,
            w0_notes: w0NotesField?.value || ''
          };
        }
      } catch (e) { /* ignoruj błędy wzbogacania */ }
      return opp;
    }));
    res.json({ ...data, opportunities: enriched });
  } catch (err) {
    console.error('GHL opportunities error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Pobierz kontakty
app.get('/api/contacts/new', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`,
      { headers: ghlHeaders }
    );
    
    const contacts = response.data?.contacts || [];
    
    // Mapowanie GHL custom fields po ID
    const GHL_FIELD_MAIN_PROBLEM = 'k1OizGtL0V6IaWjGlVBK';
    const GHL_FIELD_MARKETING    = 'R0X7n8GG7545mnrGnREg';
    const GHL_FIELD_W0_DATE      = 'IUjxWY10y6kuITsSjfSw';
    const GHL_FIELD_W0_NOTES     = 'v04mALNDZzMgyH8YzK46';
    
    // Wzbogac kontakty o zmapowane custom fields
    contacts.forEach(c => {
      const cf = c.customFields || [];
      const getField = (id) => cf.find(f => f.id === id);
      const mainProblem = getField(GHL_FIELD_MAIN_PROBLEM);
      const marketing   = getField(GHL_FIELD_MARKETING);
      const w0Date      = getField(GHL_FIELD_W0_DATE);
      const w0Notes     = getField(GHL_FIELD_W0_NOTES);
      
      c.z_czym_si_zgasza    = mainProblem?.value || '';
      c.marketing_consent   = marketing?.value === 'tak' || marketing?.value === true;
      c.w0_date             = w0Date?.value ? new Date(Number(w0Date.value)).toISOString() : null;
      c.w0_notes            = w0Notes?.value || '';
    });
    
    // Pobierz ostatnie statusy z Supabase dla tych kontaktów
    if (supabase && contacts.length > 0) {
      const contactIds = contacts.map(c => c.id);
      
      try {
        // Pobierz najnowsze połączenie dla każdego kontaktu z ghl_contact_id
        const { data: latestCalls, error } = await supabase
          .from('calls')
          .select('ghl_contact_id, contact_type, call_effect, call_program, created_at, scheduled_w0, w0_date')
          .in('ghl_contact_id', contactIds)
          .order('created_at', { ascending: false });
          
        if (!error && latestCalls) {
          // Mapuj na obiekt dla szybkiego dostępu: contactId -> latestCall
          const latestMap = {};
          latestCalls.forEach(call => {
            if (!latestMap[call.ghl_contact_id]) {
              latestMap[call.ghl_contact_id] = call;
            }
          });
          
          // Dołącz do kontaktów
          contacts.forEach(c => {
            if (latestMap[c.id]) {
              const lc = latestMap[c.id];
              c.latestStatus  = lc.contact_type;
              c.latestOutcome = lc.call_effect;
              c.latestProgram = lc.call_program;
              c.latestCallAt  = lc.created_at;
              // W0 z raportu (jeśli zaznaczono w którejś rozmowie)
              if (lc.scheduled_w0) {
                c.w0_scheduled = true;
                c.w0_date_from_report = lc.w0_date;
              }
            }
          });
        }
      } catch (e) {
        console.warn('[Contacts] Supabase status error:', e.message);
      }
    }
    
    // Zwróć dane z wzbogaconymi kontaktami
    res.json({ ...response.data, contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Szczegóły kontaktu
app.get('/api/contact/:id', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}`,
      { headers: ghlHeaders }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Aktualizuj kontakt
app.patch('/api/contact/:id', async (req, res) => {
  try {
    const response = await axios.put(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}`,
      req.body,
      { headers: ghlHeaders }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aktualizuj pola niestandardowe kontaktu
app.patch('/api/contact/:id/custom-fields', async (req, res) => {
  try {
    const response = await axios.put(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}`,
      req.body,
      { headers: ghlHeaders }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UWAGA: /api/tasks jest zdefiniowany niżej (tasksPool) - nie duplikuj tutaj

// Pobierz zadania dla kontaktu
app.get('/api/contact/:id/tasks', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}/tasks`,
      { headers: ghlHeaders }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Utwórz zadanie dla kontaktu
app.post('/api/contact/:id/task', async (req, res) => {
  try {
    const { title, body, dueDate, assignedTo } = req.body;
    const taskData = {
      title: title || 'Zadanie z Navigator Call',
      body: body || '',
      dueDate: dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'incompleted',
      assignedTo: assignedTo || GHL_SONIA_USER_ID
    };
    const response = await axios.post(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}/tasks`,
      taskData,
      { headers: ghlHeaders }
    );
    broadcast({ type: 'task_created', task: response.data });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Prośba o edycję kontaktu → pełna wersja z Supabase zdefiniowana w sekcji EDIT REQUESTS

// Usuń opportunity (B6 — tylko admin)
app.delete('/api/opportunity/:id', async (req, res) => {
  try {
    await axios.delete(
      `https://services.leadconnectorhq.com/opportunities/${req.params.id}`,
      { headers: ghlHeaders }
    );
    broadcast({ type: 'opportunity_deleted', id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Aktualizuj opportunity (raport po rozmowie / przeniesienie stage)
app.patch('/api/opportunity/:id', async (req, res) => {
  try {
    const response = await axios.patch(
      `https://services.leadconnectorhq.com/opportunities/${req.params.id}`,
      req.body,
      { headers: ghlHeaders }
    );
    broadcast({ type: 'opportunity_updated', opportunity: response.data });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// ─── POŁĄCZENIA (I4: /api/calls) ──────────────────────────────────────────────

// Połączenia — domyślnie 7 dni, z parametrem today=1 → dzisiejszy dzień kalendarzowy
app.get('/api/calls', (req, res) => {
  const { userId, role } = req.query;
  let calls;
  if (req.query.today === '1' || req.query.today === 'true') {
    calls = getTodayCalls();
  } else {
    const days = parseInt(req.query.days) || 7;
    calls = getRecentCalls(days);
  }
  
  // Recepcja widzi WSZYSTKIE połączenia (nie filtrujemy po ext)
  // Opiekunowie widzą tylko swoje
  if (role !== 'admin' && userId) {
    const user = USERS[userId];
    if (user && user.role === 'opiekun') {
      calls = calls.filter(c => {
        if (c.userId === userId) return true;
        const from = String(c.from || '');
        const to = String(c.to || '');
        return from === user.ext || to === user.ext;
      });
    }
  }
  
  // Wzbogać o agentName i outsideWorkingHours
  calls = calls.map(enrichCall);
  
  res.json({ calls });
});

// Diagnostyka połączeń (I6)
app.get('/api/calls/debug', (req, res) => {
  const last20 = callsStore.slice(0, 20);
  res.json({
    total: callsStore.length,
    last20,
    retryQueue: Array.from(recordingRetryQueue.entries()).map(([k, v]) => ({ callId: k, ...v }))
  });
});

// Pobierz nagranie na żądanie
app.get('/api/call/:callId/recording', async (req, res) => {
  const { callId } = req.params;
  const call = callsStore.find(c => c.callId === callId);

  // Sprawdź czy już mamy URL
  if (call?.recordingUrl) {
    return res.json({ url: call.recordingUrl });
  }

  // Sprawdź w Supabase
  if (supabase) {
    try {
      const { data } = await supabase.from('calls')
        .select('recording_url, pbx_call_id')
        .eq('call_id', callId)
        .single();
      if (data?.recording_url) {
        // Zaktualizuj in-memory
        storeCall({ callId, recordingUrl: data.recording_url });
        return res.json({ url: data.recording_url });
      }
    } catch(e) { /* kontynuuj */ }
  }
  // Spróbuj pobrać z Zadarma — próbuj różne warianty ID
  const idsToTry = [call?.pbxCallId, callId].filter(Boolean);
  for (const pid of idsToTry) {
    const url = await fetchRecordingFromZadarma(pid);
    if (url) {
      storeCall({ callId, recordingUrl: url });
      broadcast({ type: 'CALL_RECORDING_READY', callId, recordingUrl: url });
      return res.json({ url });
    }
  }
  
  // Jeśli nie znaleziono manualnie, a połączenie jest zakończone — dodaj do kolejki retry (jeśli jeszcze nie ma)
  if (call?.status === 'ended' && call?.pbxCallId) {
    console.log(`[Recording] Manual check failed for ${callId}, adding to background retry queue.`);
    scheduleRecordingFetch(callId, call.pbxCallId, call.contactName);
  }

  res.json({ url: null });
});

// Proxy nagrania — zawsze pobiera świeży link z Zadarma (linki tymczasowe wygasają)
app.get('/api/call/:callId/recording/proxy', async (req, res) => {
  const { callId } = req.params;
  const call = callsStore.find(c => c.callId === callId);
  
  // Znajdź pbxCallId (potrzebny do Zadarma API)
  let pbxCallId = call?.pbxCallId;
  if (!pbxCallId && supabase) {
    try {
      const { data } = await supabase.from('calls')
        .select('pbx_call_id')
        .eq('call_id', callId)
        .single();
      pbxCallId = data?.pbx_call_id;
    } catch(e) { /* kontynuuj */ }
  }
  
  if (!pbxCallId) {
    return res.status(404).json({ error: 'Brak pbx_call_id — nie można pobrać nagrania' });
  }
  
  // Pobierz ŚWIEŻY link z Zadarma (stary mógł wygasnąć)
  const freshUrl = await fetchRecordingFromZadarma(pbxCallId);
  if (!freshUrl) {
    return res.status(404).json({ error: 'Nagranie niedostępne w Zadarma — mogło zostać usunięte lub nie było nagrane' });
  }
  
  // Zaktualizuj zapisany URL
  storeCall({ callId, recordingUrl: freshUrl });
  
  // Przekieruj do świeżego linka (przeglądarka pobierze plik)
  res.redirect(freshUrl);
});

// ─── Automatyczne przeniesienie stage przy nieodebranym połączeniu ─────────────
async function autoMoveStageForMissedCall(phone) {
  if (!phone || !GHL_TOKEN) return;
  try {
    // Szukaj kontaktu po numerze telefonu
    const searchResp = await axios.get(
      `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=${encodeURIComponent(phone)}`,
      { headers: ghlHeaders, timeout: 10000 }
    );
    const contact = searchResp.data?.contact;
    if (!contact?.id) return;

    // Szukaj szansy sprzedaży tego kontaktu w pipeline
    const oppsResp = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${GHL_PIPELINE_ID}&contact_id=${contact.id}&limit=5`,
      { headers: ghlHeaders, timeout: 10000 }
    );
    const opp = (oppsResp.data?.opportunities || [])[0];
    if (!opp) return;

    // Logika: stage 1 (nowe) → stage 2 (1 próba), stage 2 → stage 3 (2 próba)
    const currentStage = opp.pipelineStageId;
    let nextStage = null;
    if (currentStage === STAGE_NEW)       nextStage = STAGE_ATTEMPT_1;
    if (currentStage === STAGE_ATTEMPT_1) nextStage = STAGE_ATTEMPT_2;

    if (nextStage) {
      await axios.patch(
        `https://services.leadconnectorhq.com/opportunities/${opp.id}`,
        { pipelineStageId: nextStage },
        { headers: ghlHeaders, timeout: 10000 }
      );
      const stageName = GHL_STAGES[nextStage];
      console.log(`[Auto-Stage] ${contact.firstName || phone} → "${stageName}"`);
      broadcast({ type: 'opportunity_stage_changed', id: opp.id, stageId: nextStage, stageName });
    }
  } catch(e) {
    console.error('[Auto-Stage] Error:', e.message);
  }
}

// ─── ZADARMA WEBHOOK ──────────────────────────────────────────────────────────

// GET — weryfikacja URL przez Zadarma (odsyła zd_echo)
app.get('/webhook/zadarma', (req, res) => {
  const zdEcho = req.query.zd_echo;
  if (zdEcho) {
    console.log('[Zadarma] Weryfikacja webhooka, zd_echo:', zdEcho);
    return res.send(zdEcho);
  }
  res.json({ status: 'webhook endpoint active' });
});

app.post('/webhook/zadarma', async (req, res) => {
  res.sendStatus(200); // odpowiedz natychmiast, resztę rób async
  const data = req.body;
  const event = data.event || data.call_status || '';
  const pbxCallId = data.pbx_call_id || data.call_id || '';
  const caller = data.caller_id || data.from || '';
  const called = data.called_did || data.to || '';
  const callId = pbxCallId || `call_${caller}_${Date.now()}`;

  console.log(`[Zadarma] ${event} | callId=${callId} | from=${caller} | to=${called}`);

  // Numer wewnętrzny docelowy (Zadarma wysyła jako 'internal')
  const targetExt = data.internal || data.destination || null;

  if (event === 'NOTIFY_START' || event === 'INCOMING') {
    // Nowe połączenie przychodzące
    const nowTs = new Date().toISOString();
    const callObj = {
      callId,
      pbxCallId,
      direction: 'inbound',
      status: 'ringing',
      from: caller,
      to: called,
      targetExt,
      outsideWorkingHours: isOutsideWorkingHours(nowTs),
      timestamp: nowTs,
      recordingUrl: null,
      tag: null
    };
    // Przypisz userId z mapy aktywnych użytkowników
    const inboundExt = called || caller;
    const assignedUserId = activeExtMap.get(inboundExt) || activeExtMap.get(caller) || null;
    if (assignedUserId) { callObj.userId = assignedUserId; console.log(`[ActiveExt] Inbound ${callId}: ext ${inboundExt} → ${assignedUserId}`); }
    storeCall(callObj);
    broadcast({ type: 'CALL_RINGING', ...callObj });
  }

  else if (event === 'NOTIFY_OUT_START' || event === 'OUTGOING') {
    // Połączenie wychodzące — jeśli już istnieje z click-to-call, tylko aktualizuj pbxCallId
    // Przypisz userId z mapy aktywnych użytkowników (wychodzące)
    const outboundExt = caller || called;
    const outUserId = activeExtMap.get(outboundExt) || null;
    if (outUserId) console.log(`[ActiveExt] Outbound ${callId}: ext ${outboundExt} → ${outUserId}`);
    const existing = callsStore.find(c => c.callId === callId);
    if (existing) {
      storeCall({ callId, pbxCallId, status: 'ringing', userId: outUserId || existing.userId });
    } else {
      storeCall({
        callId, pbxCallId, direction: 'outbound', status: 'ringing', userId: outUserId,
        from: caller || called, to: called || caller,
        timestamp: new Date().toISOString(), recordingUrl: null, tag: null
      });
      broadcast({ type: 'CALL_RINGING', callId, direction: 'outbound', from: caller || called, to: called || caller });
    }
  }

  else if (event === 'NOTIFY_ANSWER' || event === 'ANSWERED') {
    storeCall({ callId, status: 'active', answeredAt: new Date().toISOString(), tag: 'connected' });
    broadcast({ type: 'CALL_ANSWERED', callId, tag: 'connected' });
  }

  else if (event === 'NOTIFY_END' || event === 'ENDED' || event === 'MISSED') {
    const duration = parseInt(data.duration) || 0;
    const isMissed = event === 'MISSED' || duration === 0;
    const call = callsStore.find(c => c.callId === callId);
    const direction = call?.direction || 'inbound';

    let tag = 'connected';
    if (isMissed && direction === 'inbound')  tag = 'missed';
    if (isMissed && direction === 'outbound') tag = 'ineffective';

    storeCall({ callId, status: 'ended', duration, tag, endedAt: new Date().toISOString() });
    broadcast({ type: 'CALL_ENDED', callId, duration, tag, direction });

    if (!isMissed && pbxCallId) {
      scheduleRecordingFetch(callId, pbxCallId, call?.from || caller);
    }

    // Automatyczne przeniesienie stage dla nieodebranych wychodzących
    if (tag === 'ineffective' && (call?.from || caller)) {
      autoMoveStageForMissedCall(call?.from || caller).catch(console.error);
    }
  }

  // Połączenie wychodzące Callback — NOTIFY_OUT_END (zakończone)
  else if (event === 'NOTIFY_OUT_END') {
    const duration = parseInt(data.seconds || data.duration) || 0;
    const outTag = duration > 0 ? 'connected' : 'ineffective';
    storeCall({ callId, status: 'ended', duration, tag: outTag, endedAt: new Date().toISOString() });
    broadcast({ type: 'CALL_ENDED', callId, duration, tag: outTag, direction: 'outbound' });
    if (duration > 0 && pbxCallId) scheduleRecordingFetch(callId, pbxCallId, caller);
    // Nieodebrane wychodzące → auto stage
    if (outTag === 'ineffective') {
      const call = callsStore.find(c => c.callId === callId);
      autoMoveStageForMissedCall(call?.from || called || caller).catch(console.error);
    }
  }

  // Nagranie gotowe (NOTIFY_RECORD) — Zadarma wysyła URL bezpośrednio
  else if (event === 'NOTIFY_RECORD') {
    const recUrl = data.link || data.record || '';
    const recCallId = data.call_id_with_rec || pbxCallId || callId;
    if (recCallId && recUrl) {
      storeCall({ callId: recCallId, recordingUrl: recUrl });
      broadcast({ type: 'CALL_RECORDING_READY', callId: recCallId, recordingUrl: recUrl });
      console.log(`[Zadarma] Nagranie gotowe dla ${recCallId}: ${recUrl}`);
    }
  }
});

// ─── CLICK-TO-CALL (C1/C9) ────────────────────────────────────────────────────
app.post('/api/call/initiate', async (req, res) => {
  try {
    const { phoneNumber, agentPhone, contactName, contactId } = req.body;

    if (!ZADARMA_KEY || !ZADARMA_SECRET) {
      // Tryb demo — symuluj połączenie
      const callId = `demo_${Date.now()}`;
      const callObj = {
        callId,
        pbxCallId: callId,
        direction: 'outbound',
        status: 'ringing',
        from: phoneNumber,
        to: phoneNumber,
        contactName: contactName || phoneNumber,
        contactId: contactId || null,
        timestamp: new Date().toISOString(),
        recordingUrl: null,
        tag: null
      };
      storeCall(callObj);
      broadcast({ type: 'CALL_RINGING', ...callObj });
      return res.json({ success: true, message: 'Symulacja połączenia (brak konfiguracji Zadarma)', callId });
    }

    // Zadarma Click-to-Call API — callback mode
    // BEZ predicted → Zadarma najpierw dzwoni do FROM (recepcja), potem łączy z TO (pacjent)
    // Z predicted:1 → dzwoni do obu jednocześnie (pacjent słyszy "proszę czekać")
    const from = agentPhone || process.env.ZADARMA_DEFAULT_EXT || '103';
    const to   = phoneNumber;
    const callParams = { from, to };
    const sign = zadarmaSign('/v1/request/callback/', callParams);
    // Buduj URL ręcznie z tym samym kodowaniem co podpis
    const sortedCallParams = {}; Object.keys(callParams).sort().forEach(k => sortedCallParams[k] = callParams[k]);
    const qs = new URLSearchParams(sortedCallParams).toString();

    console.log(`[Click-to-Call] Próba: from=${from} to=${to}`);

    const response = await axios.get(
      `https://api.zadarma.com/v1/request/callback/?${qs}`,
      { headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000 }
    );

    console.log(`[Click-to-Call] Odpowiedź Zadarma:`, JSON.stringify(response.data));

    // Zapisz połączenie wychodzące (C9)
    const callId = response.data?.call_id || `out_${Date.now()}`;
    const callObj = {
      callId,
      pbxCallId: callId,
      direction: 'outbound',
      status: 'ringing',
      from: phoneNumber,       // numer pacjenta (do kogo dzwonimy)
      to: phoneNumber,
      contactName: contactName || phoneNumber,
      contactId: contactId || null,
      timestamp: new Date().toISOString(),
      recordingUrl: null,
      tag: null,
      userId: req.body.userId || null  // kto dzwoni
    };
    storeCall(callObj);
    broadcast({ type: 'CALL_RINGING', ...callObj });

    res.json({ success: true, ...response.data, callId });
  } catch (err) {
    const statusCode = err.response?.status || 500;
    const zadarmaMsg = (typeof err.response?.data === 'object')
      ? (err.response.data?.message || JSON.stringify(err.response.data))
      : err.message;
    console.error('[Click-to-Call] Error:', statusCode, zadarmaMsg);
    res.status(500).json({ error: zadarmaMsg });
  }
});

// ─── HANGUP CALL (rozłączenie z poziomu pop-upu) ─────────────────────────
app.post('/api/call/hangup', async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ error: 'Brak callId' });

    const call = callsStore.find(c => c.callId === callId);
    const pbxCallId = call?.pbxCallId || callId;

    if (ZADARMA_KEY && ZADARMA_SECRET) {
      // Zadarma API — zakończ aktywne połączenie
      try {
        const params = { call_id: pbxCallId };
        const sign = zadarmaSign('/v1/request/hangup/', params);
        const sorted = {}; Object.keys(params).sort().forEach(k => sorted[k] = params[k]);
        const qs = new URLSearchParams(sorted).toString();
        await axios.get(
          `https://api.zadarma.com/v1/request/hangup/?${qs}`,
          { headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000 }
        );
        console.log(`[Hangup] Połączenie ${callId} rozłączone przez API`);
      } catch (e) {
        console.error('[Hangup] Zadarma API error:', e.response?.data || e.message);
      }
    }

    // Aktualizuj store niezależnie od wyniku API
    const duration = call?.answeredAt
      ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000)
      : 0;
    const tag = duration > 0 ? 'connected' : (call?.direction === 'inbound' ? 'missed' : 'ineffective');
    storeCall({ callId, status: 'ended', duration, tag, endedAt: new Date().toISOString() });
    broadcast({ type: 'CALL_ENDED', callId, duration, tag, direction: call?.direction || 'inbound' });

    res.json({ success: true, callId, duration, tag });
  } catch (err) {
    console.error('[Hangup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DIAGNOSTYKA ZADARMA ──────────────────────────────────────────────────────

// Pełna diagnostyka: auth + lista wewnętrznych + status rejestracji
app.get('/api/call/diagnose', async (req, res) => {
  const result = { auth: null, extensions: null, callTest: null };

  if (!ZADARMA_KEY || !ZADARMA_SECRET) {
    return res.json({ ok: false, reason: 'Brak ZADARMA_KEY lub ZADARMA_SECRET w .env' });
  }

  // 1. Test autoryzacji przez balance
  try {
    const sign = zadarmaSign('/v1/info/balance/', {});
    const r = await axios.get('https://api.zadarma.com/v1/info/balance/', {
      headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000
    });
    result.auth = { ok: true, balance: r.data };
  } catch (e) {
    result.auth = { ok: false, error: e.response?.data || e.message };
  }

  // 2. Lista wewnętrznych i ich status online/offline
  try {
    const sign = zadarmaSign('/v1/pbx/internal/', {});
    const r = await axios.get('https://api.zadarma.com/v1/pbx/internal/', {
      headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000
    });
    result.extensions = { ok: true, data: r.data };
  } catch (e) {
    result.extensions = { ok: false, error: e.response?.data || e.message };
  }

  // 3. Pokaż dokładnie jaki parametr from zostanie użyty w callback
  const pbxId = process.env.ZADARMA_PBX_ID || '507897';
  const ext   = process.env.ZADARMA_DEFAULT_EXT || '103';
  const fromFull = ext.includes('-') ? ext : `${pbxId}-${ext}`;
  result.configuredExt  = ext;
  result.configuredFrom = fromFull;   // to jest wartość wysyłana do Zadarma

  res.json(result);
});

// Endpoint do testowania podpisu — sprawdza balance z Authorization header (zgodnie ze supportem)
app.get('/api/call/test-sign', async (req, res) => {
  if (!ZADARMA_KEY || !ZADARMA_SECRET) {
    return res.json({ ok: false, reason: 'Brak kluczy' });
  }
  const results = {};

  // Metoda A: oficjalny support PHP — Authorization header + base64(hex_hmac) + RFC1738 encoding
  try {
    const sign = zadarmaSign('/v1/info/balance/', {});
    const r = await axios.get('https://api.zadarma.com/v1/info/balance/', {
      headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000
    });
    results.methodA = { ok: true, data: r.data, desc: 'Authorization header + base64(hex_hmac) RFC1738 [oficjalny]' };
  } catch(e) {
    results.methodA = { ok: false, error: e.response?.data || e.message, desc: 'Authorization header + base64(hex_hmac) RFC1738 [oficjalny]' };
  }

  // Metoda B: stare TypeScript repo — Authorization header + base64(binary_hmac) + method+md5 only
  try {
    const paramString = '';
    const md5Hash = crypto.createHash('md5').update(paramString).digest('hex');
    const sign = crypto.createHmac('sha1', ZADARMA_SECRET).update(`/v1/info/balance/${md5Hash}`).digest('base64');
    const r = await axios.get('https://api.zadarma.com/v1/info/balance/', {
      headers: { 'Authorization': `${ZADARMA_KEY}:${sign}` }, timeout: 10000
    });
    results.methodB = { ok: true, data: r.data, desc: 'Authorization header + base64(binary_hmac) method+md5 [stare repo]' };
  } catch(e) {
    results.methodB = { ok: false, error: e.response?.data || e.message, desc: 'Authorization header + base64(binary_hmac) method+md5 [stare repo]' };
  }

  res.json({ key: ZADARMA_KEY?.slice(0, 8) + '...', secret: ZADARMA_SECRET?.slice(0, 4) + '...', ...results });
});

// Endpoint diagnostyczny — pokazuje dokładne wartości podpisu do weryfikacji ręcznej
app.get('/api/call/debug-sign', (req, res) => {
  if (!ZADARMA_KEY || !ZADARMA_SECRET) {
    return res.json({ error: 'Brak kluczy w env' });
  }

  const key    = ZADARMA_KEY.trim();
  const secret = ZADARMA_SECRET.trim();
  const method = '/v1/info/balance/';
  const paramsStr = '';
  const md5ofParams = crypto.createHash('md5').update(paramsStr).digest('hex');
  const signInput   = method + paramsStr + md5ofParams;
  const hmacHex     = crypto.createHmac('sha1', secret).update(signInput).digest('hex');
  const signBase64  = Buffer.from(hmacHex).toString('base64');
  const authHeader  = `${key}:${signBase64}`;

  res.json({
    // Diagnostyka kluczy
    key_raw_length:    ZADARMA_KEY.length,
    key_trimmed_length: key.length,
    key_has_whitespace: ZADARMA_KEY !== key,
    secret_raw_length:    ZADARMA_SECRET.length,
    secret_trimmed_length: secret.length,
    secret_has_whitespace: ZADARMA_SECRET !== secret,
    key_first8:    key.slice(0, 8),
    secret_first4: secret.slice(0, 4),
    // Wartości pośrednie
    method,
    paramsStr,
    md5ofParams,
    signInput,
    hmacHex,
    signBase64,
    // Gotowy nagłówek do curl:
    curl_command: `curl -H "Authorization: ${authHeader}" https://api.zadarma.com/v1/info/balance/`
  });
});

app.get('/api/call/test-auth', async (req, res) => {
  if (!ZADARMA_KEY || !ZADARMA_SECRET) {
    return res.json({ ok: false, reason: 'Brak ZADARMA_KEY lub ZADARMA_SECRET w .env' });
  }
  try {
    const sign = zadarmaSign('/v1/pbx/internal/', {});
    const response = await axios.get(
      'https://api.zadarma.com/v1/pbx/internal/',
      { headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000 }
    );
    res.json({ ok: true, data: response.data, key: ZADARMA_KEY.slice(0, 8) + '...' });
  } catch (err) {
    res.json({ ok: false, error: err.response?.data || err.message, key: ZADARMA_KEY?.slice(0, 8) + '...' });
  }
});

// ─── SYSTEM ZADAŃ (Task Pool) — Supabase + fallback RAM ──────────────────────
// Fallback RAM gdy Supabase niedostępne
const tasksPool = new Map();
let taskIdCounter = 1000;

// Helper: mapuj wiersz Supabase → obiekt zadania
function mapTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    contactId: row.contact_id,
    contactName: row.contact_name,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to_name,
    status: row.status || 'pending',
    pool: row.pool || false,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ghlTaskId: row.ghl_task_id
  };
}

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, description, contactId, contactName, dueDate, assignedTo } = req.body;
    const userId = req.headers['x-user-id'] || 'unknown';
    const isPool = !assignedTo || assignedTo === 'pool';
    const assignedUser = assignedTo ? Object.values(USERS).find(u => u.id === assignedTo) : null;

    let task;

    if (supabase) {
      const { data, error } = await supabase.from('tasks').insert({
        title,
        description: description || null,
        contact_id: contactId || null,
        contact_name: contactName || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        assigned_to: isPool ? null : (assignedTo || null),
        assigned_to_name: assignedUser?.name || null,
        status: 'pending',
        pool: isPool,
        created_by: userId
      }).select().single();
      if (error) throw new Error(error.message);
      task = mapTaskRow(data);
    } else {
      // Fallback RAM
      const taskId = `task_${taskIdCounter++}`;
      task = { id: taskId, title, description, contactId, contactName, dueDate,
        assignedTo: isPool ? null : (assignedTo || null), status: 'pending',
        pool: isPool, createdBy: userId, createdAt: new Date().toISOString() };
      tasksPool.set(taskId, task);
    }

    // Synchronizuj z GHL jeśli contactId i przypisany użytkownik
    if (contactId && assignedUser?.ghlUserId) {
      try {
        const ghlResp = await axios.post(
          `https://services.leadconnectorhq.com/contacts/${contactId}/tasks`,
          { title, body: description, dueDate: new Date(dueDate).toISOString().split('T')[0], assignedTo: assignedUser.ghlUserId },
          { headers: ghlHeaders, timeout: 10000 }
        );
        // Zapisz GHL task ID w Supabase
        if (supabase && task.id && ghlResp.data?.id) {
          supabase.from('tasks').update({ ghl_task_id: ghlResp.data.id }).eq('id', task.id).then(() => {});
        }
      } catch(e) { console.error('[GHL Task] Sync error:', e.message); }
    }

    broadcast({ type: 'TASK_CREATED', task });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', async (req, res) => {
  const userId = req.query.userId;
  const filter = req.query.filter || 'all'; // all, mine, unassigned

  if (supabase) {
    try {
      let query = supabase.from('tasks').select('*').neq('status', 'deleted').order('due_date', { ascending: true, nullsFirst: false });
      if (filter === 'mine' && userId) {
        query = query.eq('assigned_to', userId);
      } else if (filter === 'unassigned') {
        query = query.is('assigned_to', null);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return res.json({ tasks: (data || []).map(mapTaskRow) });
    } catch(e) {
      console.error('[Tasks] Supabase error, fallback RAM:', e.message);
    }
  }

  // Fallback RAM
  let tasks = Array.from(tasksPool.values());
  if (filter === 'mine' && userId) tasks = tasks.filter(t => t.assignedTo === userId);
  else if (filter === 'unassigned') tasks = tasks.filter(t => !t.assignedTo);
  tasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  res.json({ tasks });
});

app.patch('/api/tasks/:id', async (req, res) => {
  const { assignedTo, status, title, description, dueDate } = req.body;
  const taskId = req.params.id;

  if (supabase) {
    try {
      const updates = {};
      if (assignedTo !== undefined) {
        updates.assigned_to = assignedTo || null;
        const assignedUser = assignedTo ? Object.values(USERS).find(u => u.id === assignedTo) : null;
        updates.assigned_to_name = assignedUser?.name || null;
        updates.pool = !assignedTo;
      }
      if (status !== undefined) updates.status = status;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (dueDate !== undefined) updates.due_date = dueDate ? new Date(dueDate).toISOString() : null;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from('tasks').update(updates).eq('id', taskId).select().single();
      if (error) throw new Error(error.message);
      const task = mapTaskRow(data);
      broadcast({ type: 'TASK_UPDATED', task });
      return res.json({ success: true, task });
    } catch(e) {
      console.error('[Tasks] Patch Supabase error:', e.message);
    }
  }

  // Fallback RAM
  const task = tasksPool.get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (assignedTo !== undefined) task.assignedTo = assignedTo;
  if (status !== undefined) task.status = status;
  tasksPool.set(taskId, task);
  broadcast({ type: 'TASK_UPDATED', task });
  res.json({ success: true, task });
});

app.delete('/api/tasks/:id', async (req, res) => {
  const taskId = req.params.id;
  if (supabase) {
    try {
      await supabase.from('tasks').update({ status: 'deleted' }).eq('id', taskId);
      broadcast({ type: 'TASK_DELETED', id: taskId });
      return res.json({ success: true });
    } catch(e) { console.error('[Tasks] Delete error:', e.message); }
  }
  tasksPool.delete(taskId);
  broadcast({ type: 'TASK_DELETED', id: taskId });
  res.json({ success: true });
});

// ─── POPUP DANYCH KONTAKTU (szybkie dane dla popupu połączenia) ─────────────────
// Zwraca: etap GHL, status operacyjny, W0, ostatnią notatkę — bez pełnych activities
app.get('/api/contact/:id/popup', async (req, res) => {
  const contactId = req.params.id;
  try {
    // 1. Pobierz dane z GHL (kontakt + szansa sprzedaży)
    const [contactResp, oppsResp] = await Promise.allSettled([
      axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, { headers: ghlHeaders, timeout: 8000 }),
      axios.get(`https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}&limit=1`, { headers: ghlHeaders, timeout: 8000 })
    ]);
    const contact = contactResp.status === 'fulfilled' ? (contactResp.value.data?.contact || {}) : {};
    const opps    = oppsResp.status === 'fulfilled'    ? (oppsResp.value.data?.opportunities || []) : [];
    const latestOpp = opps[0] || null;
    // 2. Mapuj custom fields
    const cf = contact.customFields || [];
    const getField = (id) => cf.find(f => f.id === id);
    const mainProblem = getField('k1OizGtL0V6IaWjGlVBK');
    const w0DateField = getField('IUjxWY10y6kuITsSjfSw');
    // 3. Pobierz dane z Supabase (contacts + last event/note)
    let contactRow = null, lastNote = null, w0FromDB = null;
    if (supabase) {
      try {
        const { data: cRow } = await supabase.from('contacts')
          .select('w0_scheduled, w0_date, w0_doctor, contact_status, first_call_at, last_note, last_note_at, ghl_stage_name')
          .eq('ghl_contact_id', contactId)
          .single();
        contactRow = cRow;
      } catch(e) { /* kontakt może nie istnieć w Supabase */ }
      // Ostatnia notatka z events
      try {
        const { data: lastEvent } = await supabase.from('events')
          .select('description, created_at, event_type, source')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (lastEvent) lastNote = { text: lastEvent.description, at: lastEvent.created_at, type: lastEvent.event_type, source: lastEvent.source };
      } catch(e) { /* brak eventów */ }
      // W0 z calls (fallback)
      if (!contactRow?.w0_scheduled) {
        try {
          const { data: w0Calls } = await supabase.from('calls')
            .select('scheduled_w0, w0_date, w0_doctor')
            .eq('ghl_contact_id', contactId)
            .eq('scheduled_w0', true)
            .order('created_at', { ascending: false })
            .limit(1);
          if (w0Calls && w0Calls.length > 0) {
            w0FromDB = { scheduled: true, date: w0Calls[0].w0_date, doctor: w0Calls[0].w0_doctor };
          }
        } catch(e) { /* brak W0 */ }
      }
    }
    // 4. Ustal W0 (priorytet: contacts > calls > GHL custom field)
    const w0Scheduled = contactRow?.w0_scheduled || w0FromDB?.scheduled || !!(w0DateField?.value);
    const w0Date = contactRow?.w0_date || w0FromDB?.date || (w0DateField?.value ? new Date(Number(w0DateField.value)).toISOString() : null);
    const w0Doctor = contactRow?.w0_doctor || w0FromDB?.doctor || null;
    // 5. Ustal etap GHL
    const stageName = latestOpp ? (GHL_STAGES[latestOpp.pipelineStageId] || latestOpp.pipelineStageId || null) : null;
    res.json({
      id: contactId,
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      phone: contact.phone || '',
      zglosza: mainProblem?.value || '',
      stageName,
      stageId: latestOpp?.pipelineStageId || null,
      opportunityId: latestOpp?.id || null,
      contactStatus: contactRow?.contact_status || null,
      firstCallAt: contactRow?.first_call_at || null,
      w0_scheduled: w0Scheduled,
      w0_date: w0Date,
      w0_doctor: w0Doctor,
      lastNote,
      lead_created_at: contact.dateAdded || null
    });
  } catch (err) {
    console.error('[Popup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── KARTA PACJENTA (Patient Card) ──────────────────────────────────────────────
app.get('/api/contact/:id/card', async (req, res) => {
  try {
    const contactId = req.params.id;
    const contactResp = await axios.get(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      { headers: ghlHeaders, timeout: 10000 }
    );
    const contact = contactResp.data?.contact || {};

    let activities = [];
    try {
      const activitiesResp = await axios.get(
        `https://services.leadconnectorhq.com/contacts/${contactId}/activities?limit=50`,
        { headers: ghlHeaders, timeout: 8000 }
      );
      activities = activitiesResp.data?.activities || activitiesResp.data?.data || [];
    } catch (e) {
      console.warn('[Patient Card] GHL activities error (non-fatal):', e.message);
    }

    let opportunities = [];
    try {
      const oppsResp = await axios.get(
        `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}&limit=10`,
        { headers: ghlHeaders, timeout: 10000 }
      );
      opportunities = oppsResp.data?.opportunities || [];
    } catch (e) {
      console.warn('[Patient Card] GHL opportunities error (non-fatal):', e.message);
    }

    // Pobierz notatki z GHL (i zsynchronizuj z events)
    let ghlNotes = [];
    try {
      const notesResp = await axios.get(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        { headers: ghlHeaders, timeout: 8000 }
      );
      ghlNotes = notesResp.data?.notes || [];
      // Synchronizuj notatki GHL do tabeli events (upsert po ghl_note_id w metadata)
      if (supabase && ghlNotes.length > 0) {
        for (const note of ghlNotes) {
          try {
            // Sprawdź czy notatka już istnieje w events
            const { data: existing } = await supabase.from('events')
              .select('id')
              .eq('contact_id', contactId)
              .eq('source', 'ghl')
              .filter('metadata->ghl_note_id', 'eq', note.id)
              .limit(1);
            if (!existing || existing.length === 0) {
              await supabase.from('events').insert({
                event_type: 'ghl_note',
                contact_id: contactId,
                contact_name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
                source: 'ghl',
                description: note.body || note.text || '(notatka bez treści)',
                metadata: { ghl_note_id: note.id, userId: note.userId },
                created_at: note.dateAdded || new Date().toISOString()
              });
            }
          } catch(e) { /* ignoruj błędy synchronizacji pojedynczej notatki */ }
        }
      }
    } catch (e) {
      console.warn('[Patient Card] GHL notes error:', e.message);
    }
    // Pobierz historię połączeń z Supabase
    let callHistory = [];
    if (supabase) {
      try {
        const { data: calls, error } = await supabase
          .from('calls')
          .select('*')
          .eq('ghl_contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(20);
        
        if (!error && calls) {
          callHistory = calls;
        }
      } catch (e) {
        console.warn('[Patient Card] Supabase call history error:', e.message);
      }
    }

    // Pobierz historię zadań z Supabase
    let taskHistory = [];
    if (supabase) {
      try {
        const { data: tasks } = await supabase.from('tasks')
          .select('*')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(30);
        if (tasks) taskHistory = tasks;
      } catch(e) { console.warn('[Patient Card] Tasks error:', e.message); }
    }
    // Pobierz ujednolicony Timeline z tabeli events (app + ghl)
    let unifiedTimeline = [];
    if (supabase) {
      try {
        const { data: eventsData } = await supabase.from('events')
          .select('*')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (eventsData) unifiedTimeline = eventsData;
      } catch(e) { console.warn('[Patient Card] Events fetch error:', e.message); }
    }

    // Mapowanie GHL custom fields po ID lub key
    const cf = contact.customFields || [];
    const getField = (id) => cf.find(f => f.id === id);
    const getFieldByKey = (key) => cf.find(f => (f.fieldKey || '').toLowerCase().includes(key.toLowerCase()));
    const mainProblem   = getField('k1OizGtL0V6IaWjGlVBK') || getFieldByKey('z_czym_si_zgasza');
    const marketing     = getField('R0X7n8GG7545mnrGnREg') || getFieldByKey('zgoda_marketingowa');
    const w0DateField   = getField('IUjxWY10y6kuITsSjfSw');
    const w0NotesField  = getField('v04mALNDZzMgyH8YzK46');
    // Nowe pola
    const sourceContact  = getFieldByKey('rdo_kontaktu');
    const prefChannel    = getFieldByKey('preferowany_kana');
    const potProgram     = getFieldByKey('potencjalny_program');
    const firstCallNote  = getFieldByKey('notatka_z_pierwszej_rozmowy');
    const leadSource     = getFieldByKey('rdo_leada') || getFieldByKey('lead_source');
    const zgodaMarketing = getField('R0X7n8GG7545mnrGnREg') || getFieldByKey('zgoda_marketingowa');

    // Informacja o osobie przypisanej do szansy (kto wykonywał pierwsze połączenie wychodzące)
    const firstOpp = opportunities[0] || null;

    // Sprawdź W0 z raportów w Supabase
    let w0FromReports = { scheduled: false, date: null, doctor: null };
    if (supabase) {
      try {
        const { data: w0Calls } = await supabase
          .from('calls')
          .select('scheduled_w0, w0_date, w0_doctor, created_at')
          .eq('ghl_contact_id', contactId)
          .eq('scheduled_w0', true)
          .order('created_at', { ascending: false })
          .limit(1);
        if (w0Calls && w0Calls.length > 0) {
          w0FromReports = { scheduled: true, date: w0Calls[0].w0_date, doctor: w0Calls[0].w0_doctor };
        }
      } catch(e) {}
    }

    // Pobierz W0 z contacts table (globalne — priorytet nad calls)
    let contactW0 = { scheduled: w0FromReports.scheduled, date: w0FromReports.date, doctor: w0FromReports.doctor };
    if (supabase) {
      try {
        const { data: cRow } = await supabase.from('contacts')
          .select('w0_scheduled, w0_date, w0_doctor, contact_status, first_call_at')
          .eq('ghl_contact_id', contactId)
          .single();
        if (cRow) {
          if (cRow.w0_scheduled) contactW0 = { scheduled: true, date: cRow.w0_date, doctor: cRow.w0_doctor };
        }
      } catch(e) { /* kontakt może nie istnieć w Supabase */ }
    }
    res.json({
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        city: contact.city || '',
        gender: contact.gender || '',
        dateOfBirth: contact.dateOfBirth || '',
        source: contact.source,
        tags: contact.tags || [],
        createdAt: contact.createdAt,
        // Zmapowane custom fields
        mainProblem: mainProblem?.value || '',
        sourceContact: sourceContact?.value || '',
        marketingConsent: (zgodaMarketing?.value || marketing?.value || '') ? true : false,
        marketingConsentRaw: zgodaMarketing?.value || marketing?.value || '',
        preferredChannel: prefChannel?.value || '',
        potentialProgram: potProgram?.value || '',
        firstCallNote: firstCallNote?.value || '',
        leadSource: leadSource?.value || contact.source || '',
        // Osoba przypisana do szansy sprzedaży
        opportunityAssignedTo: firstOpp?.assignedTo || null,
        opportunityAssignedToName: firstOpp?.assignedTo || null,
        // Pipeline
        pipelineId: firstOpp?.pipelineId || null,
        pipelineStageName: GHL_STAGES[firstOpp?.pipelineStageId] || null,
        pipelineStageId: firstOpp?.pipelineStageId || null,
        w0_date: contactW0.date || (w0DateField?.value ? new Date(Number(w0DateField.value)).toISOString() : null),
        w0_notes: w0NotesField?.value || '',
        w0_scheduled: !!(contactW0.scheduled || w0DateField?.value),
        w0_doctor: contactW0.doctor || null,
        // Surowe custom fields (do debugowania / mapowania nowych pól)
        customFields: cf
      },
      // Pipeline info
      pipeline: opportunities.length > 0 ? {
        id: opportunities[0].pipelineId,
        stageId: opportunities[0].pipelineStageId,
        stageName: GHL_STAGES[opportunities[0].pipelineStageId] || 'Nieznany',
        assignedTo: opportunities[0].assignedTo || null,
        status: opportunities[0].status
      } : null,
      // Historia zadań
      taskHistory: taskHistory.map(t => ({
        id: t.id,
        title: t.title,
        body: t.body,
        status: t.status,
        dueDate: t.due_date,
        assignedTo: t.assigned_to,
        completedAt: t.completed_at,
        createdAt: t.created_at
      })),
      // Ujednolicony Timeline (app + ghl) — z tabeli events
      unifiedTimeline: unifiedTimeline.map(e => ({
        id: e.id,
        type: e.event_type,
        source: e.source || 'app',
        description: e.description,
        createdAt: e.created_at,
        userId: e.user_id,
        metadata: e.metadata
      })),
      // GHL Activities (legacy — zachowane dla kompatybilności)
      timeline: activities.map(a => ({
        id: a.id,
        type: a.type,
        description: a.description,
        createdAt: a.createdAt,
        userId: a.userId,
        userName: a.userName
      })),
      opportunities: opportunities.map(o => ({
        id: o.id,
        title: o.title,
        status: o.status,
        stageId: o.pipelineStageId,
        stageName: GHL_STAGES[o.pipelineStageId],
        value: o.monetaryValue,
        updatedAt: o.updatedAt
      })),
      callHistory: callHistory.map(c => ({
        id: c.call_id,
        direction: c.direction,
        status: c.status,
        tag: c.call_tag,
        contactType: c.contact_type,
        callEffect: c.call_effect,
        notes: c.notes,
        duration: c.duration_seconds,
        recordingUrl: c.recording_url,
        createdAt: c.created_at
      }))
    });
  } catch (err) {
    console.error('[Patient Card] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STATYSTYKI (G) ───────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 1;
    const { userId, role } = req.query;
    const [contactsResp, oppsResp] = await Promise.allSettled([
      axios.get(`https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`, { headers: ghlHeaders, timeout: 10000 }),
      axios.get(`https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${GHL_PIPELINE_ID}&limit=100`, { headers: ghlHeaders, timeout: 10000 })
    ]);

    const contacts = contactsResp.status === 'fulfilled' ? (contactsResp.value.data.contacts || []) : [];
    const opps     = oppsResp.status === 'fulfilled'     ? (oppsResp.value.data.opportunities || []) : [];

    let periodCalls = getRecentCalls(days);

    // Filtrowanie połączeń per rola/użytkownik
    if (role !== 'admin' && userId) {
      const user = USERS[userId];
      if (user && user.ext) {
        periodCalls = periodCalls.filter(c => {
          if (c.userId === userId) return true;
          const from = String(c.from || '');
          const to = String(c.to || '');
          const extNum = user.ext;
          if (from === extNum || to === extNum) return true;
          if (from.endsWith(extNum) || to.endsWith(extNum)) return true;
          return false;
        });
      }
    }

    const totalCalls  = periodCalls.length;
    const answered    = periodCalls.filter(c => c.status === 'ended' && c.tag === 'connected').length;
    const missed      = periodCalls.filter(c => c.tag === 'missed').length;
    const outbound    = periodCalls.filter(c => c.direction === 'outbound').length;
    const answeredPct = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0;
    const callbackDone = periodCalls.filter(c => c.tag === 'missed' && c.callbackDone).length;

    // Rozkład połączeń wg godzin (do wykresu)
    const callsByHour = Array(24).fill(0);
    periodCalls.forEach(c => {
      const h = new Date(c.timestamp).getHours();
      callsByHour[h]++;
    });

    // Źródła leadów (z GHL)
    const leadSources = {};
    contacts.forEach(c => {
      const src = c.source || 'Nieznane';
      leadSources[src] = (leadSources[src] || 0) + 1;
    });

    // Statystyki rozszerzone (Reception OS)
    let followUpStats = { total: 0, done: 0, overdue: 0, conversionToW0: 0 };
    let metrics = { leadToFirstCallAvg: 0, firstCallToW0Avg: 0, w0WaitAvg: 0 };
    let avgResponseTimeMins = null;
    let newPatientsCount = 0;
    let firstCallsCount = 0;
    let cancellationStats = {};

    if (supabase) {
      try {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // 1. Follow-up tasks & conversion
        const { data: fuTasks } = await supabase.from('tasks')
          .select('status, completed_at, due_date, contact_id')
          .eq('task_type', 'follow_up_call')
          .gte('created_at', since);
        
        if (fuTasks) {
          followUpStats.total = fuTasks.length;
          followUpStats.done = fuTasks.filter(t => t.status === 'done').length;
          followUpStats.overdue = fuTasks.filter(t => t.status !== 'done' && new Date(t.due_date) < new Date()).length;
          
          // Konwersja follow-up -> W0
          const fuContactIds = fuTasks.map(t => t.contact_id);
          if (fuContactIds.length > 0) {
            const { data: converted } = await supabase.from('events')
              .select('contact_id')
              .eq('event_type', 'w0_scheduled')
              .in('contact_id', fuContactIds);
            const uniqueConverted = new Set(converted?.map(e => e.contact_id)).size;
            followUpStats.conversionToW0 = fuTasks.length > 0 ? Math.round((uniqueConverted / fuTasks.length) * 100) : 0;
          }
        }

        // 2. Metryki czasu (Lead -> First Call -> W0)
        const { data: contactsData } = await supabase.from('contacts')
          .select('response_time_minutes, lead_to_w0_days, w0_wait_days, is_new_patient')
          .gte('updated_at', since);

        if (contactsData) {
          const respTimes = contactsData.map(c => c.response_time_minutes).filter(t => t != null);
          metrics.leadToFirstCallAvg = respTimes.length > 0 ? Math.round(respTimes.reduce((a,b) => a+b, 0) / respTimes.length) : 0;
          avgResponseTimeMins = metrics.leadToFirstCallAvg;
          
          const l2w0Times = contactsData.map(c => c.lead_to_w0_days).filter(t => t != null);
          metrics.firstCallToW0Avg = l2w0Times.length > 0 ? Math.round(l2w0Times.reduce((a,b) => a+b, 0) / l2w0Times.length) : 0;
          
          const waitTimes = contactsData.map(c => c.w0_wait_days).filter(t => t != null);
          metrics.w0WaitAvg = waitTimes.length > 0 ? Math.round(waitTimes.reduce((a,b) => a+b, 0) / waitTimes.length) : 0;
          
          newPatientsCount = contactsData.filter(c => c.is_new_patient).length;
        }

        // 3. Powody odwołań (z events)
        const { data: cancellations } = await supabase.from('events')
          .select('metadata')
          .eq('event_type', 'visit_cancelled')
          .gte('created_at', since);
        
        if (cancellations) {
          cancellations.forEach(c => {
            const reason = c.metadata?.cancellationReason || 'Nieznany';
            cancellationStats[reason] = (cancellationStats[reason] || 0) + 1;
          });
        }
      } catch(e) { console.warn('[Stats] Supabase error:', e.message); }
    }

    // Oblicz firstCallsCount z połączeń (połączenia wychodzące zakończone sukcesem)
    firstCallsCount = periodCalls.filter(c => c.direction === 'outbound' && c.tag === 'connected').length;

        res.json({
      totalContacts: contacts.length,
      totalOpportunities: opps.length,
      stats: {
        totalCalls,
        answered,
        missed,
        outbound,
        answeredPercent: answeredPct,
        callbackRate: missed > 0 ? Math.round((callbackDone / missed) * 100) : 100,
        uniquePatients: contacts.length,
        newLeads: opps.filter(o => o.status === 'pending').length,
        // Reception OS metrics
        newPatients: newPatientsCount,
        firstCalls: firstCallsCount,
        avgResponseTimeMins,
        followUp: followUpStats,
        metrics  // ← metryki czasu (leadToFirstCallAvg, firstCallToW0Avg, w0WaitAvg)
      },
      callsByStatus: {
        connected: periodCalls.filter(c => c.tag === 'connected').length,
        missed,
        ineffective: periodCalls.filter(c => c.tag === 'ineffective').length
      },
      callsByHour,
      leadSources,
      cancellationStats,
      recentCalls: periodCalls.slice(0, 100),
      // Podział per stanowisko i osoba (tylko dla admina)
      agentBreakdown: (() => {
        const allUsersArr = Object.values(USERS);
        // Grupuj połączenia po ext (stanowisko)
        const stations = {
          reception: { label: 'Recepcja', ext: '103', calls: [], agents: {} },
          agata_o:   { label: 'Agata (Opiekun)', ext: '101', calls: [], agents: {} },
          aneta_o:   { label: 'Aneta (Opiekun)', ext: '102', calls: [], agents: {} },
        };
        const allCallsAll = getRecentCalls(days); // wszystkie, bez filtrowania
        allCallsAll.forEach(c => {
          const from = String(c.from || '');
          const to   = String(c.to || '');
          // Przypisz do stanowiska po ext
          for (const [key, station] of Object.entries(stations)) {
            const ext = station.ext;
            if (from === ext || to === ext || from.endsWith(ext) || to.endsWith(ext)) {
              station.calls.push(c);
              // Przypisz do agenta po userId (jeśli jest)
              if (c.userId) {
                if (!station.agents[c.userId]) station.agents[c.userId] = { name: USERS[c.userId]?.name || c.userId, calls: 0, connected: 0, missed: 0 };
                station.agents[c.userId].calls++;
                if (c.tag === 'connected') station.agents[c.userId].connected++;
                if (c.tag === 'missed') station.agents[c.userId].missed++;
              }
              break;
            }
          }
        });
        return Object.entries(stations).map(([key, s]) => ({
          key,
          label: s.label,
          ext: s.ext,
          total: s.calls.length,
          connected: s.calls.filter(c => c.tag === 'connected').length,
          missed: s.calls.filter(c => c.tag === 'missed').length,
          ineffective: s.calls.filter(c => c.tag === 'ineffective').length,
          agents: Object.values(s.agents)
        }));
      })()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pokaż publiczne IP serwera (potrzebne do konfiguracji Zadarma)
app.get('/api/server-ip', async (req, res) => {
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    res.json({ serverIp: r.data.ip, note: 'Dodaj to IP do dozwolonych w ustawieniach klucza API Zadarma' });
  } catch(e) {
    res.json({ serverIp: 'nie udało się pobrać', error: e.message });
  }
});

// ─── SYSTEM UŻYTKOWNIKÓW — definicja przeniesiona na górę pliku ───────────────

app.get('/api/users', (req, res) => {
  const list = Object.values(USERS).map(u => ({ id: u.id, name: u.name, role: u.role, ghlUserId: u.ghlUserId }));
  res.json({ users: list });
});

app.get('/api/user/:id', async (req, res) => {
  const user = USERS[req.params.id];
  if (!user) return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
  
  // Rejestruj aktywność (last_login_at)
  if (supabase) {
    try {
      await supabase.from('user_activity').upsert({
        user_id: user.id,
        user_name: user.name,
        last_login_at: new Date().toISOString(),
        is_active_today: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    } catch(e) { console.error('[Activity] Error:', e.message); }
  }

  // Zaktualizuj mapę aktywnych użytkowników (ext → userId)
  if (user.ext) {
    activeExtMap.set(user.ext, user.id);
    console.log(`[ActiveExt] Login: ext ${user.ext} → ${user.id}`);
  }
  
  res.json(user);
});

// Stage mapping (frontend potrzebuje nazw)
app.get('/api/stages', (req, res) => {
  res.json({ stages: GHL_STAGES });
});

// Przenieś szansę sprzedaży do innego stage w lejku GHL
app.post('/api/opportunity/:id/move-stage', async (req, res) => {
  try {
    const { stageId } = req.body;
    if (!stageId) return res.status(400).json({ error: 'Brak stageId' });
    const response = await axios.patch(
      `https://services.leadconnectorhq.com/opportunities/${req.params.id}`,
      { pipelineStageId: stageId },
      { headers: ghlHeaders, timeout: 10000 }
    );
    // Dodaj tag z nazwą stage
    const stageName = GHL_STAGES[stageId];
    if (stageName && response.data?.contactId) {
      try {
        await axios.post(
          `https://services.leadconnectorhq.com/contacts/${response.data.contactId}/tags`,
          { tags: [stageName] },
          { headers: ghlHeaders, timeout: 10000 }
        );
      } catch(e) { /* tag opcjonalny */ }
    }
    broadcast({ type: 'opportunity_stage_changed', id: req.params.id, stageId, stageName });
    console.log(`[GHL] Opportunity ${req.params.id} → stage "${stageName || stageId}"`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error('[GHL] Move stage error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// ─── CHAT DO SONI (prywatny per użytkownik) ──────────────────────────────────
const chatMessages = {};
const SONIA_ID = 'sonia';

app.post('/api/chat/send', async (req, res) => {
  const { fromUserId, toUserId, text } = req.body;
  if (!fromUserId || !toUserId || !text) return res.status(400).json({ error: 'Missing fields' });
  const convKey = [fromUserId, toUserId].sort().join(':');
  if (!chatMessages[convKey]) chatMessages[convKey] = [];
  const fromUser = USERS[fromUserId];
  const msg = {
    from: fromUserId, fromName: fromUser?.name || fromUserId,
    to: toUserId, text, ts: new Date().toISOString(),
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
  };
  chatMessages[convKey].push(msg);
  if (chatMessages[convKey].length > 500) chatMessages[convKey] = chatMessages[convKey].slice(-500);
  broadcast({ type: 'CHAT_PRIVATE', convKey, msg });
  // Supabase
  if (supabase) {
    supabase.from('chat_messages').insert({
      conv_key: convKey, from_user: fromUserId,
      from_name: fromUser?.name || fromUserId,
      to_user: toUserId, text, created_at: msg.ts
    }).then(({ error }) => { if (error) console.error('[Supabase] chat error:', error.message); });
  }
  res.json({ success: true, msg });
});

app.get('/api/chat/history/:convKey', async (req, res) => {
  const convKey = req.params.convKey;
  if (chatMessages[convKey] && chatMessages[convKey].length > 0) {
    return res.json({ messages: chatMessages[convKey] });
  }
  if (supabase) {
    try {
      const { data, error } = await supabase.from('chat_messages')
        .select('*').eq('conv_key', convKey)
        .order('created_at', { ascending: true }).limit(200);
      if (!error && data) {
        const msgs = data.map(r => ({
          from: r.from_user, fromName: r.from_name, to: r.to_user,
          text: r.text, ts: r.created_at, id: String(r.id)
        }));
        chatMessages[convKey] = msgs;
        return res.json({ messages: msgs });
      }
    } catch(e) { /* fallback */ }
  }
  res.json({ messages: [] });
});

// Lista konwersacji Soni (z liczbą nieprzeczytanych)
app.get('/api/chat/sonia-inbox', (req, res) => {
  const conversations = [];
  for (const [key, msgs] of Object.entries(chatMessages)) {
    if (!key.includes(SONIA_ID)) continue;
    const otherUserId = key.split(':').find(id => id !== SONIA_ID);
    const otherUser = USERS[otherUserId];
    const lastMsg = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.to === SONIA_ID && !m.read).length;
    conversations.push({
      convKey: key,
      otherUserId,
      otherUserName: otherUser?.name || otherUserId,
      lastMessage: lastMsg?.text || '',
      lastTs: lastMsg?.ts || '',
      unread
    });
  }
  conversations.sort((a, b) => b.lastTs.localeCompare(a.lastTs));
  res.json({ conversations });
});

// ─── ZAPIS RAPORTU DO SUPABASE ──────────────────────────────────────────────────
app.patch('/api/calls/:callId/report', async (req, res) => {
  const { callId } = req.params;
  const {
    contactType, callEffect, notes, program, outcome,
    userId, contactId, contactName, recordingUrl
  } = req.body;

  // Aktualizuj in-memory store
  const existing = callsStore.find(c => c.callId === callId);
  if (existing) {
    if (contactType)   existing.contactType   = contactType;
    if (callEffect)    existing.callEffect    = callEffect;
    if (notes !== undefined) existing.notes    = notes;
    if (program)       existing.program       = program;
    if (outcome)       existing.outcome       = outcome;
    if (userId)        existing.userId        = userId;
    if (recordingUrl)  existing.recordingUrl  = recordingUrl;
    existing.reportSavedAt = new Date().toISOString();
    existing.reportSavedBy = userId || existing.userId;
  }

  // Zapisz do Supabase
  if (supabase) {
      try {
        const {
          cancellationReason,
          isFollowUp,
          w0Date,
          firstCallAt,
          notatkaZPierwszejRozmowy,
          zrodloLeada,
          zrodloKontaktu
        } = req.body;

        const updates = {
          updated_at: new Date().toISOString(),
          report_saved_at: new Date().toISOString(),
          report_saved_by: userId
        };
        if (contactType)        updates.contact_type   = contactType;
        if (callEffect)         updates.call_effect    = callEffect;
        if (notes !== undefined) updates.notes          = notes;
        if (program)            updates.treatment      = program;
        if (outcome)            updates.call_reason    = outcome;
        if (userId)             updates.user_id        = userId;
        if (contactId)          updates.ghl_contact_id = contactId;
        if (contactName)        updates.patient_name   = contactName;
        if (recordingUrl)       updates.recording_url  = recordingUrl;
        
        // Nowe pola Reception OS
        if (cancellationReason) updates.cancellation_reason = cancellationReason;
        if (isFollowUp !== undefined) updates.is_follow_up = isFollowUp;
        if (w0Date) {
          updates.w0_date = new Date(w0Date).toISOString();
          updates.w0_booked_at = new Date().toISOString();
        }
        if (firstCallAt) updates.first_call_at = new Date(firstCallAt).toISOString();
        // Ustaw scheduled_w0 = true na calls gdy w0Date jest ustawione
        if (w0Date) updates.scheduled_w0 = true;

        const { error } = await supabase.from('calls').update(updates).eq('call_id', callId);
        if (error) throw error;
        // Globalne W0 — aktualizuj contacts gdy w0Date jest ustawione
        if (w0Date && contactId) {
          try {
            const w0Doctor = req.body.w0Doctor || null;
            await supabase.from('contacts').update({
              w0_scheduled: true,
              w0_date: new Date(w0Date).toISOString(),
              w0_doctor: w0Doctor,
              updated_at: new Date().toISOString()
            }).eq('ghl_contact_id', contactId);
            // Event: W0 umówione
            await supabase.from('events').insert({
              event_type: 'w0_scheduled',
              contact_id: contactId,
              contact_name: contactName,
              user_id: userId,
              source: 'app',
              description: `Umówiono wizytę W0 na ${new Date(w0Date).toLocaleDateString('pl-PL')}${w0Doctor ? ` u dr ${w0Doctor}` : ''}`,
              metadata: { callId, w0Date, w0Doctor }
            });
          } catch(e) { console.warn('[ReceptionOS] W0 global update error:', e.message); }
        }

        // Notatka z pierwszej rozmowy (NOWY_PACJENT) — zapisz na stałe w kontakcie
        if (contactType === 'NOWY_PACJENT' && contactId && notatkaZPierwszejRozmowy) {
          try {
            // Zapisz do contacts w Supabase
            await supabase.from('contacts').upsert({
              ghl_contact_id: contactId,
              first_call_note: notatkaZPierwszejRozmowy,
              contact_status: 'nowy_pacjent',
              first_call_at: new Date().toISOString(),
              first_call_by: userId,
              updated_at: new Date().toISOString()
            }, { onConflict: 'ghl_contact_id' });
            // Event
            await supabase.from('events').insert({
              event_type: 'first_call',
              contact_id: contactId,
              contact_name: contactName,
              user_id: userId,
              source: 'app',
              description: `Pierwsza rozmowa (nowy pacjent): ${notatkaZPierwszejRozmowy.substring(0, 200)}`,
              metadata: { callId, program, zrodloLeada, zrodloKontaktu }
            });
            // Wyślij do GHL jako custom field
            if (GHL_TOKEN) {
              try {
                await axios.patch(
                  `https://services.leadconnectorhq.com/contacts/${contactId}`,
                  { customFields: [
                    { key: 'notatka_z_pierwszej_rozmowy', field_value: notatkaZPierwszejRozmowy },
                    ...(zrodloLeada ? [{ key: 'rdo_leada', field_value: zrodloLeada }] : []),
                    ...(zrodloKontaktu ? [{ key: 'rdo_kontaktu', field_value: zrodloKontaktu }] : [])
                  ]},
                  { headers: ghlHeaders, timeout: 10000 }
                );
              } catch(e) { console.warn('[Report] GHL custom fields update error:', e.message); }
            }
          } catch(e) { console.warn('[Report] First call note save error:', e.message); }
        }

        // Logika Eventów: Odwołanie wizyty
        if (callEffect === 'visit_cancelled' || outcome === 'odwolanie_wizyty') {
          await supabase.from('events').insert({
            event_type: 'visit_cancelled',
            contact_id: contactId,
            contact_name: contactName,
            user_id: userId,
            description: `Odwołanie wizyty. Powód: ${cancellationReason || 'nie podano'}`,
            metadata: { callId, cancellationReason }
          });
          
          // Jeśli BRAK nowego terminu -> Automatyczny task follow-up (Reception OS)
          if (!w0Date) {
            const followUpDate = new Date();
            followUpDate.setDate(followUpDate.getDate() + 3); // Domyślnie 3 dni
            await supabase.from('tasks').insert({
              title: `Oddzwoń po odwołaniu: ${contactName || 'Pacjent'}`,
              description: `Pacjent odwołał wizytę. Powód: ${cancellationReason || 'nie podano'}. Brak nowego terminu.`,
              contact_id: contactId,
              contact_name: contactName,
              phone: req.body.phone,
              due_date: followUpDate.toISOString(),
              task_type: 'follow_up_call',
              status: 'pending',
              pool: true,
              created_by: 'system'
            });
            
            await supabase.from('events').insert({
              event_type: 'follow_up_created',
              contact_id: contactId,
              contact_name: contactName,
              user_id: userId,
              source: 'app',
              description: `Utworzono auto-task po odwołaniu wizyty`
            });
          }
        }

        // Logika Automatycznych Zadań: Follow-up
        if (isFollowUp || callEffect === 'followup') {
          const delay = req.body.followUpDelay || '3d';
          const days = parseInt(delay) || 3;
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + days);

          await supabase.from('tasks').insert({
            title: `Follow-up: ${contactName || 'Pacjent'}`,
            description: `Automatyczny follow-up po rozmowie. Notatka: ${notes || ''}`,
            contact_id: contactId,
            contact_name: contactName,
            due_date: dueDate.toISOString(),
            task_type: 'follow_up_call',
            follow_up_delay: delay,
            status: 'open_pool',
            pool: true,
            created_by: 'system'
          });

          await supabase.from('events').insert({
            event_type: 'follow_up_created',
            contact_id: contactId,
            contact_name: contactName,
            user_id: userId,
            source: 'app',
            description: `Utworzono automatyczny follow-up na za ${delay}`
          });
        }
        // Ustaw call_type na podstawie contactType i callEffect
        let callType = 'other';
        if (contactType === 'NOWY_PACJENT' && !req.body.isFollowUp) callType = 'first_call';
        else if (req.body.isFollowUp || callEffect === 'followup') callType = 'follow_up';
        else if (contactType === 'WIZYTA_BIEZACA') callType = 'visit_related';
        updates.call_type = callType;

        // Aktualizuj kontakt: is_new_patient + first_call_at + response_time
        if (contactId && contactType === 'NOWY_PACJENT') {
          try {
            const now = new Date().toISOString();
            // Sprawdz czy kontakt istnieje w Supabase
            const { data: contactData } = await supabase.from('contacts')
              .select('is_new_patient, lead_created_at, first_call_at')
              .eq('ghl_contact_id', contactId)
              .single();

            if (contactData && !contactData.first_call_at) {
              // Pierwszy raz dzwonimy do tego pacjenta
              const leadCreatedAt = contactData.lead_created_at || now;
              const firstCallAt = now;
              const responseTimeMs = new Date(firstCallAt) - new Date(leadCreatedAt);
              const responseTimeMins = Math.round(responseTimeMs / 60000);

              await supabase.from('contacts').update({
                first_call_at: firstCallAt,
                response_time_minutes: responseTimeMins,
                is_new_patient: true,
                updated_at: now
              }).eq('ghl_contact_id', contactId);

              // Event: Pierwszy kontakt
              await supabase.from('events').insert({
                event_type: 'first_call',
                contact_id: contactId,
                contact_name: contactName,
                user_id: userId,
                source: 'app',
                description: `Pierwszy kontakt. Czas reakcji: ${responseTimeMins} min`,
                metadata: { callId, responseTimeMins }
              });
            }
          } catch(e) { console.warn('[ReceptionOS] Contact update error:', e.message); }
        }

        // Automatyczny task przy odwołaniu bez nowego terminu
        if ((callEffect === 'odwolanie' || outcome === 'odwolanie') && !req.body.w0Date) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3);
          try {
            await supabase.from('tasks').insert({
              title: `Oddzwoń po odwołaniu: ${contactName || 'Pacjent'}`,
              description: `Odwołanie wizyty. Powód: ${req.body.cancellationReason || 'nie podano'}. Umów nowy termin.`,
              contact_id: contactId,
              contact_name: contactName,
              due_date: dueDate.toISOString(),
              task_type: 'follow_up_call',
              follow_up_delay: '3d',
              status: 'open_pool',
              pool: true,
              created_by: 'system'
            });
          } catch(e) { console.warn('[ReceptionOS] Auto-task error:', e.message); }
        }

      } catch (err) {
        console.error('[Supabase] report update error:', err.message);
      }
  }

  res.json({ success: true });
});

// Pobierz raport pojedynczego połączenia
app.get('/api/calls/:callId/report', async (req, res) => {
  const { callId } = req.params;

  // Najpierw z in-memory
  const call = callsStore.find(c => c.callId === callId);

  // Jeśli jest Supabase, pobierz świeże dane
  if (supabase) {
    try {
      const { data, error } = await supabase.from('calls')
        .select('*')
        .eq('call_id', callId)
        .single();
      if (!error && data) {
        return res.json({
          callId: data.call_id,
          contactType: data.contact_type,
          callEffect: data.call_effect,
          notes: data.notes,
          program: data.treatment,
          outcome: data.call_reason,
          userId: data.user_id,
          contactName: data.patient_name,
          contactId: data.ghl_contact_id,
          recordingUrl: data.recording_url,
          direction: data.direction,
          duration: data.duration_seconds,
          status: data.status,
          from: data.caller_phone,
          to: data.called_phone,
          timestamp: data.created_at,
          answeredAt: data.answered_at,
          endedAt: data.ended_at
        });
      }
    } catch(e) { /* fallback to in-memory */ }
  }

  if (call) {
    return res.json({
      callId: call.callId,
      contactType: call.contactType,
      callEffect: call.callEffect,
      notes: call.notes,
      program: call.program,
      outcome: call.outcome,
      userId: call.userId,
      contactName: call.contactName,
      contactId: call.contactId,
      recordingUrl: call.recordingUrl,
      direction: call.direction,
      duration: call.duration,
      status: call.status,
      from: call.from,
      to: call.to,
      timestamp: call.timestamp,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt
    });
  }
  res.status(404).json({ error: 'Nie znaleziono połączenia' });
});

// Historia raportów — admin widzi wszystkie, recepcja tylko swoje
app.get('/api/reports/history', async (req, res) => {
  const { userId, role, days } = req.query;
  const daysNum = parseInt(days) || 30;
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

  if (supabase) {
    try {
      let query = supabase.from('calls')
        .select('*')
        .not('contact_type', 'is', null) // tylko te z raportem
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);

      // Recepcja widzi tylko swoje raporty
      if (role !== 'admin' && userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const reports = (data || []).map(row => ({
        callId: row.call_id,
        contactType: row.contact_type,
        callEffect: row.call_effect,
        notes: row.notes,
        program: row.treatment,
        outcome: row.call_reason,
        userId: row.user_id,
        contactName: row.patient_name,
        contactId: row.ghl_contact_id,
        recordingUrl: row.recording_url,
        direction: row.direction,
        duration: row.duration_seconds,
        from: row.caller_phone,
        to: row.called_phone,
        timestamp: row.created_at,
        updatedAt: row.updated_at
      }));
      return res.json({ reports });
    } catch(e) {
      console.error('[Reports] Error:', e.message);
    }
  }
  // Fallback in-memory
  let calls = getRecentCalls(daysNum).filter(c => c.contactType);
  if (role !== 'admin' && userId) calls = calls.filter(c => c.userId === userId);
  res.json({ reports: calls });
});

// Statystyki raportów (punkt 4 — admin)
app.get('/api/reports/stats', async (req, res) => {
  const { days } = req.query;
  const daysNum = parseInt(days) || 30;
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();

  if (supabase) {
    try {
      const { data, error } = await supabase.from('calls')
        .select('contact_type, call_effect, treatment, call_reason, user_id')
        .not('contact_type', 'is', null)
        .gte('created_at', since);

      if (error) throw new Error(error.message);
      const rows = data || [];

      const contactTypeCounts = {};
      const callEffectCounts = {};
      const programCounts = {};
      const outcomeCounts = {};
      const userCounts = {};

      rows.forEach(r => {
        if (r.contact_type) contactTypeCounts[r.contact_type] = (contactTypeCounts[r.contact_type] || 0) + 1;
        if (r.call_effect)  callEffectCounts[r.call_effect]   = (callEffectCounts[r.call_effect] || 0) + 1;
        if (r.treatment)    programCounts[r.treatment]         = (programCounts[r.treatment] || 0) + 1;
        if (r.call_reason)  outcomeCounts[r.call_reason]       = (outcomeCounts[r.call_reason] || 0) + 1;
        if (r.user_id)      userCounts[r.user_id]              = (userCounts[r.user_id] || 0) + 1;
      });

      return res.json({
        totalReports: rows.length,
        contactTypeCounts,
        callEffectCounts,
        programCounts,
        outcomeCounts,
        userCounts
      });
    } catch(e) {
      console.error('[ReportStats] Error:', e.message);
    }
  }

  // Fallback
  res.json({ totalReports: 0, contactTypeCounts: {}, callEffectCounts: {}, programCounts: {}, outcomeCounts: {}, userCounts: {} });
});

// Pobierz historię połączeń z Supabase (z raportami i nagraniami)
app.get('/api/calls/history', async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { userId, role, dateFrom, dateTo, search, station, agentId } = req.query;

  // Zakres dat
  let since;
  if (dateFrom) {
    since = new Date(dateFrom).toISOString();
  } else {
    since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  const until = dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : null;

  if (supabase) {
    try {
      let query = supabase.from('calls')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500);

      if (until) query = query.lte('created_at', until);
      if (search && search.trim()) query = query.ilike('patient_name', `%${search.trim()}%`);

      const { data, error } = await query;
      // Filtrowanie po ext po stronie serwera
      let filteredRows = data || [];

      // Zbierz user_id dla każdego stanowiska (recepcja/opiekunowie)
      const receptionIds = Object.values(USERS).filter(u => u.role === 'reception').map(u => u.id);
      const agataOIds    = ['agata_o'];
      const anetaOIds    = ['aneta_o'];

      // Recepcja widzi WSZYSTKIE połączenia — opiekunowie tylko swoje
      if (role !== 'admin' && userId) {
        const userObj = USERS[userId];
        if (userObj?.role === 'opiekun') {
          const ext = userObj.ext;
          filteredRows = filteredRows.filter(row => {
            if (row.user_id === userId) return true;
            if (!row.user_id) {
              const from = String(row.caller_phone || '');
              const to   = String(row.called_phone || '');
              return from === ext || to === ext;
            }
            return false;
          });
        }
      }

      // Admin: filtr po stanowisku (po user_id, nie po numerze telefonu)
      if (role === 'admin' && station && station !== 'all') {
        let stationIds;
        if (station === 'reception') stationIds = receptionIds;
        else if (station === 'agata_o') stationIds = agataOIds;
        else if (station === 'aneta_o') stationIds = anetaOIds;
        if (stationIds) {
          filteredRows = filteredRows.filter(row => {
            if (row.user_id && stationIds.includes(row.user_id)) return true;
            // Stare rekordy bez user_id — dla recepcji sprawdź ext 103
            if (!row.user_id && station === 'reception') {
              const from = String(row.caller_phone || '');
              const to   = String(row.called_phone || '');
              return from === '103' || to === '103' || from.endsWith('103') || to.endsWith('103');
            }
            return false;
          });
        }
      }
      // Admin: filtr po konkretnej osobie
      if (role === 'admin' && agentId && agentId !== 'all') {
        filteredRows = filteredRows.filter(row => row.user_id === agentId);
      }
      if (error) throw new Error(error.message);
      
      const filteredData = filteredRows.filter(row => {
        // Usuń techniczne wpisy "0" lub puste numery, o ile nie mają przypisanego pacjenta
        const isTechnicalZero = (row.caller_phone === '0' || !row.caller_phone) && 
                                (row.called_phone === '0' || !row.called_phone) && 
                                !row.patient_name;
        return !isTechnicalZero;
      });

      // Usuń duplikaty pbx_call_id (Zadarma czasem wysyła dwa zdarzenia z różnymi call_id dla tego samego pbx_call_id)
      const seenPbxIds = new Set();
      const uniqueCalls = [];
      for (const row of filteredData) {
        if (row.pbx_call_id && seenPbxIds.has(row.pbx_call_id)) continue;
        if (row.pbx_call_id) seenPbxIds.add(row.pbx_call_id);
        
        uniqueCalls.push({
          callId: row.call_id,
          pbxCallId: row.pbx_call_id,
          from: row.caller_phone,
          to: row.called_phone,
          direction: row.direction,
          status: row.status,
          duration: row.duration_seconds,
          recordingUrl: row.recording_url,
          contactName: row.patient_name,
          contactId: row.ghl_contact_id,
          userId: row.user_id,
          agentName: row.user_id && USERS[row.user_id] ? USERS[row.user_id].name : null,
          outsideWorkingHours: row.created_at ? isOutsideWorkingHours(row.created_at) : false,
          tag: row.call_tag || row.contact_type || (row.status === 'ended' && row.duration_seconds > 0 ? 'connected' : row.direction === 'inbound' ? 'missed' : 'ineffective'),
          contactType: row.contact_type,
          callEffect: row.call_effect,
          notes: row.notes,
          program: row.treatment,
          outcome: row.call_reason,
          timestamp: row.created_at,
          answeredAt: row.answered_at,
          endedAt: row.ended_at
        });
      }

      return res.json({ calls: uniqueCalls.slice(0, 200) });
    } catch(e) {
      console.error('[History] Supabase error:', e.message);
    }
  }
  // Fallback
  res.json({ calls: getRecentCalls(days) });
});

// ─── EDIT REQUESTS ───────────────────────────────────────────────────────────────────────────────────

// Utwórz prośbę o edycję danych kontaktu
app.post('/api/contact/:id/request-edit', async (req, res) => {
  try {
    const { contactName, notes, fieldName, oldValue, newValue, requestedBy } = req.body;
    const contactId = req.params.id;

    // 1. Zapisz do Supabase edit_requests
    if (supabase) {
      try {
        await supabase.from('edit_requests').insert({
          contact_id: contactId,
          contact_name: contactName,
          requested_by: requestedBy || 'unknown',
          field_name: fieldName || 'general',
          old_value: oldValue || null,
          new_value: newValue || null,
          notes: notes || null,
          status: 'pending'
        });
      } catch(e) { console.warn('[EditRequest] Supabase error:', e.message); }
    }

    // 2. Utwórz zadanie dla Soni w GHL
    const taskData = {
      title: `Prośba o edycję: ${contactName || 'Pacjent'}`,
      body: `Pole: ${fieldName || 'ogólne'}\nStara wartość: ${oldValue || '-'}\nNowa wartość: ${newValue || '-'}\nNotatka: ${notes || ''}`,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'incompleted',
      assignedTo: GHL_SONIA_USER_ID
    };
    const response = await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/tasks`,
      taskData,
      { headers: ghlHeaders, timeout: 10000 }
    );

    broadcast({ type: 'edit_request_created', contactId, contactName, fieldName });
    res.json({ success: true, task: response.data });
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Pobierz wszystkie prośby o edycję (admin)
app.get('/api/edit-requests', async (req, res) => {
  if (!supabase) return res.json({ requests: [] });
  try {
    const { data, error } = await supabase.from('edit_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ requests: data || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Zatwierdź / odrzuc prośbę o edycję
app.patch('/api/edit-requests/:id', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Supabase niedostępne' });
  try {
    const { status, resolvedBy } = req.body;
    const { error } = await supabase.from('edit_requests').update({
      status,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── STATUS UŻYTKOWNIKÓW (online/offline) ───────────────────────────────────────────────────────────────────────────────────

app.get('/api/users/activity', async (req, res) => {
  const users = Object.values(USERS);
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minut

  if (supabase) {
    try {
      const { data, error } = await supabase.from('user_activity').select('*');
      if (!error && data) {
        const activityMap = {};
        data.forEach(a => { activityMap[a.user_id] = a; });

        const result = users.map(u => {
          const activity = activityMap[u.id];
          const lastLogin = activity?.last_login_at ? new Date(activity.last_login_at).getTime() : null;
          const isOnline = lastLogin ? (now - lastLogin) < ONLINE_THRESHOLD_MS : false;
          return {
            id: u.id,
            name: u.name,
            role: u.role,
            isOnline,
            lastLoginAt: activity?.last_login_at || null,
            isActiveToday: activity?.is_active_today || false
          };
        });
        return res.json({ users: result });
      }
    } catch(e) { console.warn('[UserActivity] Error:', e.message); }
  }

  // Fallback bez Supabase
  res.json({ users: users.map(u => ({ id: u.id, name: u.name, role: u.role, isOnline: false, lastLoginAt: null })) });
});

// Aktualizuj aktywność użytkownika (heartbeat)
app.post('/api/users/:id/heartbeat', async (req, res) => {
  const user = USERS[req.params.id];
  if (!user) return res.status(404).json({ error: 'Nie znaleziono' });
  if (supabase) {
    try {
      await supabase.from('user_activity').upsert({
        user_id: user.id,
        user_name: user.name,
        last_login_at: new Date().toISOString(),
        is_active_today: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    } catch(e) { /* ignoruj */ }
  }
  // Odśwież mapę aktywnych użytkowników
  if (user.ext) {
    activeExtMap.set(user.ext, user.id);
  }
  res.json({ success: true });
});

// ─── FOLLOW-UP OVERDUE CHECK ───────────────────────────────────────────────────────────────────────────────────

// Co 30 minut sprawdzaj przeterminowane follow-upy i oznaczaj je
async function checkOverdueFollowUps() {
  if (!supabase) return;
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('tasks')
      .update({ status: 'overdue', updated_at: now })
      .eq('task_type', 'follow_up_call')
      .not('status', 'in', '("completed","overdue")')
      .lt('due_date', now);
    if (error) console.warn('[FollowUp] Overdue check error:', error.message);
    else console.log('[FollowUp] Overdue check complete');
  } catch(e) { console.warn('[FollowUp] Exception:', e.message); }
}

// Uruchom co 30 minut
setInterval(checkOverdueFollowUps, 30 * 60 * 1000);

// ─── Health check ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
});

// ─── Fallback SPA ───────────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Navigator Call v6 running on port ${PORT}`);
  await loadCallsFromSupabase();
});
