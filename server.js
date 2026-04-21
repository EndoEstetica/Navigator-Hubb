require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

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

// ─── In-memory store połączeń (I4: /api/calls) ───────────────────────────────
// Przechowuje połączenia z ostatnich 7 dni (max 500 rekordów)
const callsStore = [];
const MAX_CALLS = 500;

function storeCall(callObj) {
  const idx = callsStore.findIndex(c => c.callId === callObj.callId);
  if (idx >= 0) {
    callsStore[idx] = { ...callsStore[idx], ...callObj };
  } else {
    callsStore.unshift(callObj);
    if (callsStore.length > MAX_CALLS) callsStore.pop();
  }
}

function getRecentCalls(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return callsStore.filter(c => new Date(c.timestamp).getTime() > cutoff);
}

// ─── Kolejka retry nagrań (D2) ────────────────────────────────────────────────
const recordingRetryQueue = new Map(); // callId → { attempts, pbxCallId, contactName }
const RETRY_DELAYS = [5000, 30000, 120000, 300000, 600000, 1200000]; // 5s, 30s, 2min, 5min, 10min, 20min

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
  try {
    const params = { call_id: pbxCallId };
    const sign = zadarmaSign('/v1/pbx/record/request/', params);
    const sorted = {}; Object.keys(params).sort().forEach(k => sorted[k] = params[k]);
    const qs = new URLSearchParams(sorted).toString();
    const response = await axios.get(
      `https://api.zadarma.com/v1/pbx/record/request/?${qs}`,
      { headers: { 'Authorization': zadarmaAuthHeader(sign) }, timeout: 10000 }
    );
    return response.data?.links?.[0] || response.data?.link || null;
  } catch (e) {
    return null;
  }
}

function scheduleRecordingFetch(callId, pbxCallId, contactName) {
  if (recordingRetryQueue.has(callId)) return;
  recordingRetryQueue.set(callId, { attempts: 0, pbxCallId, contactName });

  function tryFetch() {
    const entry = recordingRetryQueue.get(callId);
    if (!entry) return;
    const { attempts, pbxCallId: pid } = entry;

    fetchRecordingFromZadarma(pid).then(url => {
      if (url) {
        // Nagranie gotowe — zaktualizuj store i broadcast
        storeCall({ callId, recordingUrl: url });
        broadcast({ type: 'CALL_RECORDING_READY', callId, recordingUrl: url });
        recordingRetryQueue.delete(callId);
        console.log(`[Recording] Ready for ${callId}: ${url}`);
      } else {
        const nextAttempt = attempts + 1;
        if (nextAttempt < RETRY_DELAYS.length) {
          recordingRetryQueue.set(callId, { ...entry, attempts: nextAttempt });
          setTimeout(tryFetch, RETRY_DELAYS[nextAttempt]);
          console.log(`[Recording] Retry ${nextAttempt}/${RETRY_DELAYS.length} for ${callId} in ${RETRY_DELAYS[nextAttempt]/1000}s`);
        } else {
          recordingRetryQueue.delete(callId);
          console.log(`[Recording] Max retries reached for ${callId}`);
        }
      }
    });
  }

  setTimeout(tryFetch, RETRY_DELAYS[0]);
}

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
          const zglosza = customFields.find(f =>
            f.id === 'z_czym_si_zgasza' ||
            f.fieldKey === 'contact.z_czym_si_zgasza' ||
            (f.key && f.key.includes('z_czym')) ||
            (f.name && f.name.toLowerCase().includes('zgłasza'))
          );
          opp.contact = {
            ...opp.contact,
            firstName: contact.firstName || opp.contact?.firstName,
            lastName:  contact.lastName  || opp.contact?.lastName,
            phone:     contact.phone     || opp.contact?.phone,
            email:     contact.email     || opp.contact?.email,
            tags:      contact.tags      || [],
            z_czym_si_zgasza: zglosza?.value || zglosza?.fieldValue || ''
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
    res.json(response.data);
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

// Pobierz zadania dla lokalizacji
app.get('/api/tasks', async (req, res) => {
  try {
    const response = await axios.get(
      `https://services.leadconnectorhq.com/contacts/tasks?locationId=${GHL_LOCATION_ID}&limit=50`,
      { headers: ghlHeaders }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Prośba o edycję kontaktu → zadanie dla Soni (E4/F2)
app.post('/api/contact/:id/request-edit', async (req, res) => {
  try {
    const { contactName, notes } = req.body;
    const taskData = {
      title: `Prośba o edycję kontaktu: ${contactName || 'Pacjent'}`,
      body: notes || 'Recepcja prosi o edycję danych kontaktu w systemie.',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: 'incompleted',
      assignedTo: GHL_SONIA_USER_ID
    };
    const response = await axios.post(
      `https://services.leadconnectorhq.com/contacts/${req.params.id}/tasks`,
      taskData,
      { headers: ghlHeaders }
    );
    broadcast({ type: 'edit_request_created', task: response.data });
    res.json({ success: true, task: response.data });
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

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

// Wszystkie połączenia z ostatnich 7 dni
app.get('/api/calls', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json({ calls: getRecentCalls(days) });
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
  if (call?.recordingUrl) {
    return res.json({ url: call.recordingUrl });
  }
  // Spróbuj pobrać z Zadarma
  const pbxCallId = call?.pbxCallId || callId;
  const url = await fetchRecordingFromZadarma(pbxCallId);
  if (url) {
    storeCall({ callId, recordingUrl: url });
    return res.json({ url });
  }
  res.json({ url: null, message: 'Nagranie jeszcze niedostępne' });
});

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

  if (event === 'NOTIFY_START' || event === 'INCOMING') {
    // Nowe połączenie przychodzące
    const callObj = {
      callId,
      pbxCallId,
      direction: 'inbound',
      status: 'ringing',
      from: caller,
      to: called,
      timestamp: new Date().toISOString(),
      recordingUrl: null,
      tag: null
    };
    storeCall(callObj);
    broadcast({ type: 'CALL_RINGING', ...callObj });
  }

  else if (event === 'NOTIFY_OUT_START' || event === 'OUTGOING') {
    // Połączenie wychodzące zainicjowane (C10)
    const callObj = {
      callId,
      pbxCallId,
      direction: 'outbound',
      status: 'ringing',
      from: called,
      to: caller || called,
      timestamp: new Date().toISOString(),
      recordingUrl: null,
      tag: null
    };
    storeCall(callObj);
    broadcast({ type: 'CALL_RINGING', ...callObj });
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

    // Zaplanuj pobieranie nagrania (D2) — tylko jeśli rozmowa trwała
    if (!isMissed && pbxCallId) {
      scheduleRecordingFetch(callId, pbxCallId, call?.from || caller);
    }
  }

  // Połączenie wychodzące Callback — NOTIFY_OUT_END (zakończone)
  else if (event === 'NOTIFY_OUT_END') {
    const duration = parseInt(data.seconds || data.duration) || 0;
    storeCall({ callId, status: 'ended', duration, tag: duration > 0 ? 'connected' : 'ineffective', endedAt: new Date().toISOString() });
    broadcast({ type: 'CALL_ENDED', callId, duration, tag: duration > 0 ? 'connected' : 'ineffective', direction: 'outbound' });
    if (duration > 0 && pbxCallId) scheduleRecordingFetch(callId, pbxCallId, caller);
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
    // 'from' = numer wewnętrzny recepcji (np. '103'), Zadarma najpierw tu zadzwoni
    // 'to'   = numer pacjenta
    // 'predicted: 1' = tryb callback
    const from = agentPhone || process.env.ZADARMA_DEFAULT_EXT || '103';
    const to   = phoneNumber;
    const callParams = { from, to, predicted: '1' };
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
      from: to,
      to,
      contactName: contactName || phoneNumber,
      contactId: contactId || null,
      timestamp: new Date().toISOString(),
      recordingUrl: null,
      tag: null
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

// ─── STATYSTYKI (G) ───────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 1;
    const [contactsResp, oppsResp] = await Promise.allSettled([
      axios.get(`https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`, { headers: ghlHeaders, timeout: 10000 }),
      axios.get(`https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${GHL_PIPELINE_ID}&limit=100`, { headers: ghlHeaders, timeout: 10000 })
    ]);

    const contacts = contactsResp.status === 'fulfilled' ? (contactsResp.value.data.contacts || []) : [];
    const opps     = oppsResp.status === 'fulfilled'     ? (oppsResp.value.data.opportunities || []) : [];

    const periodCalls = getRecentCalls(days);
    const totalCalls  = periodCalls.length;
    const answered    = periodCalls.filter(c => c.status === 'ended' && c.tag === 'connected').length;
    const missed      = periodCalls.filter(c => c.tag === 'missed').length;
    const outbound    = periodCalls.filter(c => c.direction === 'outbound').length;
    const answeredPct = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0;
    const callbackDone = periodCalls.filter(c => c.tag === 'missed' && c.callbackDone).length;

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
        newLeads: opps.filter(o => o.status === 'open').length
      },
      callsByStatus: {
        connected: periodCalls.filter(c => c.tag === 'connected').length,
        missed,
        ineffective: periodCalls.filter(c => c.tag === 'ineffective').length
      },
      recentCalls: periodCalls.slice(0, 100)
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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
});

// ─── Fallback SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Navigator Call v6 running on port ${PORT}`);
});
