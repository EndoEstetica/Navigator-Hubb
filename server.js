// Navigator Call v6 — Full Production Backend
// Node.js + Express + Supabase + Zadarma + GHL API

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Konfiguracja ────────────────────────────────────────────────────────────

const GHL_TOKEN = process.env.GHL_TOKEN || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const ZADARMA_KEY = process.env.ZADARMA_KEY || '';
const ZADARMA_SECRET = process.env.ZADARMA_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PORT = process.env.PORT || 3000;

// Pipeline ID
const PIPELINE_ID = 'FVgB3ga52b0PUi6QjJ0x';

// Stage IDs
const STAGES = {
  NOWE_ZGLOSZENIE: '4d006021-f3b2-4efc-8efc-4f049522379c',
  PO_PIERWSZEJ_PROBIE: '002dbc5a-c6a4-4931-a9a3-af4877b2c525',
  PO_DRUGIEJ_PROBIE: 'de0a619e-ee22-41c3-9a90-eccfcb1a8fb8',
  DZIEN_2_EMAIL: '6d0c5ca9-8b79-4bf3-a091-381e636cd21e',
  DZIEN_4_SMS: '53ad4911-a26c-41fa-9b23-bc3c88f98ea4',
  BEZ_KONTAKTU: '6517c39e-15fe-4041-a847-89ba822b3c96',
  PO_ROZMOWIE: '19126f1b-5529-48fc-be95-d6b64e264e59',
  UMOWIONY_W0: '73f6704f-1d6a-49dc-8591-4b129ba1b692',
  NA_W0_PODEJMUJE_DECYZJE: 'e946be7b-c766-4563-9b93-e60f465a2dab',
  NA_W0_ZAPISAL_SIE: 'c12bac70-da03-411e-89e8-9347977267fa',
  NA_W0_NO_SHOW: 'afc5a678-b78b-47bd-858e-78968724ac4d',
  NA_W0_ODMOWIL: '139cde76-d37e-4a14-ad45-ae94a843d78b',
};

// ─── Users ───────────────────────────────────────────────────────────────────

const users = {
  asia: { id: 'asia', name: 'Asia', role: 'reception', ext: '103', pin: '1001' },
  kasia: { id: 'kasia', name: 'Kasia', role: 'reception', ext: '103', pin: '1002' },
  agnieszka: { id: 'agnieszka', name: 'Agnieszka', role: 'reception', ext: '103', pin: '1003' },
  aneta: { id: 'aneta', name: 'Aneta', role: 'reception', ext: '103', pin: '1004' },
  agata: { id: 'agata', name: 'Agata', role: 'reception', ext: '103', pin: '1005' },
  bartosz: { id: 'bartosz', name: 'Bartosz', role: 'manager', ext: '103', pin: '2001' },
  sandra: { id: 'sandra', name: 'Sandra', role: 'manager', ext: '103', pin: '2002' },
  aneta_m: { id: 'aneta_m', name: 'Aneta (M)', role: 'manager', ext: '103', pin: '2003' },
  sonia: { id: 'sonia', name: 'Sonia', role: 'manager', ext: '103', pin: '2004' },
};

// ─── In-memory cache ─────────────────────────────────────────────────────────

let ghlContactsCache = [];
let ghlContactsLastSync = 0;
const GHL_SYNC_INTERVAL = 10 * 60 * 1000; // 10 minut

// ─── Supabase Helper ─────────────────────────────────────────────────────────

const supabase = {
  async query(path, method = 'GET', body = null, params = {}) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
    };
    
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    
    try {
      const res = await fetch(url.toString(), opts);
      if (!res.ok) {
        const text = await res.text();
        console.error(`[Supabase] ${method} ${path} error:`, text);
        return null;
      }
      const data = await res.json();
      return data;
    } catch (err) {
      console.error(`[Supabase] ${method} ${path} error:`, err.message);
      return null;
    }
  },
  
  async insertCall(callData) {
    return this.query('calls', 'POST', callData);
  },
  
  async updateCall(callId, updates) {
    return this.query(`calls?call_id=eq.${callId}`, 'PATCH', updates);
  },
  
  async getCallsToday() {
    const today = new Date().toISOString().slice(0, 10);
    return this.query('calls', 'GET', null, {
      'created_at': `gte.${today}T00:00:00`,
      'order': 'created_at.desc',
    });
  },
  
  async getOpenCalls() {
    return this.query('calls', 'GET', null, {
      'topic_closed': 'eq.false',
      'order': 'created_at.desc',
    });
  },
  
  async getClosedCalls() {
    return this.query('calls', 'GET', null, {
      'topic_closed': 'eq.true',
      'order': 'closed_at.desc',
      'limit': '100',
    });
  },
};

// ─── GHL API Helper ──────────────────────────────────────────────────────────

const ghlApi = axios.create({
  baseURL: 'https://rest.gohighlevel.com/v1',
  headers: {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function syncGHLContacts() {
  try {
    console.log('[GHL] Syncing contacts...');
    let allContacts = [];
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const res = await ghlApi.get('/contacts/', {
        params: { locationId: GHL_LOCATION_ID, limit, startAfterIndex: offset },
      });
      
      const contacts = res.data.contacts || [];
      allContacts = allContacts.concat(contacts.map(c => ({
        id: c.id,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        phone: c.phone || '',
        email: c.email || '',
        tags: c.tags || [],
      })));
      
      if (contacts.length < limit) break;
      offset += limit;
      
      // Safety: max 5000 kontaktów
      if (offset > 5000) break;
    }
    
    ghlContactsCache = allContacts;
    ghlContactsLastSync = Date.now();
    console.log(`[GHL] Synced ${allContacts.length} contacts`);
  } catch (err) {
    console.error('[GHL] Sync contacts error:', err.message);
  }
}

async function getGHLContactByPhone(phone) {
  // Normalizuj numer
  const normalized = phone.replace(/[^0-9+]/g, '');
  
  // Szukaj w cache
  let contact = ghlContactsCache.find(c => {
    const cPhone = (c.phone || '').replace(/[^0-9+]/g, '');
    return cPhone === normalized || cPhone.endsWith(normalized.slice(-9)) || normalized.endsWith(cPhone.slice(-9));
  });
  
  if (contact) return contact;
  
  // Szukaj w GHL API
  try {
    const res = await ghlApi.get('/contacts/search', {
      params: { locationId: GHL_LOCATION_ID, q: phone },
    });
    if (res.data.contacts && res.data.contacts.length > 0) {
      const c = res.data.contacts[0];
      return {
        id: c.id,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        phone: c.phone || '',
        email: c.email || '',
        tags: c.tags || [],
      };
    }
  } catch (err) {
    console.error('[GHL] Search contact error:', err.message);
  }
  
  return null;
}

async function moveOpportunityToStage(contactId, stageId) {
  try {
    // Szukaj opportunity dla kontaktu
    const res = await ghlApi.get('/opportunities/search', {
      params: { locationId: GHL_LOCATION_ID, contactId, pipelineId: PIPELINE_ID },
    });
    
    if (res.data.opportunities && res.data.opportunities.length > 0) {
      const oppId = res.data.opportunities[0].id;
      await ghlApi.put(`/opportunities/${oppId}`, {
        stageId,
        pipelineId: PIPELINE_ID,
      });
      return true;
    }
    return false;
  } catch (err) {
    console.error('[GHL] Move opportunity error:', err.message);
    return false;
  }
}

async function addTagToContact(contactId, tag) {
  try {
    await ghlApi.post(`/contacts/${contactId}/tags`, {
      tags: [tag],
    });
    return true;
  } catch (err) {
    console.error('[GHL] Tag error:', err.message);
    return false;
  }
}

async function addNoteToContact(contactId, note) {
  try {
    await ghlApi.post(`/contacts/${contactId}/notes`, {
      body: note,
    });
    return true;
  } catch (err) {
    console.error('[GHL] Note error:', err.message);
    return false;
  }
}

async function getNewLeadsFromGHL() {
  try {
    const res = await ghlApi.get('/opportunities/search', {
      params: {
        locationId: GHL_LOCATION_ID,
        pipelineId: PIPELINE_ID,
        stageId: STAGES.NOWE_ZGLOSZENIE,
        limit: 50,
      },
    });
    
    return (res.data.opportunities || []).map(opp => ({
      id: opp.id,
      contactId: opp.contactId,
      name: opp.contactName || opp.name || 'Brak imienia',
      phone: opp.contactPhone || '',
      email: opp.contactEmail || '',
      createdAt: opp.createdAt,
      source: opp.source || '',
    }));
  } catch (err) {
    console.error('[GHL] Get new leads error:', err.message);
    return [];
  }
}

// ─── Zadarma API ─────────────────────────────────────────────────────────────

function zadarmaSign(method, params) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const signString = `${method}${paramString}${crypto.createHash('md5').update(paramString).digest('hex')}`;
  return crypto.createHmac('sha1', ZADARMA_SECRET).update(signString).digest('hex');
}

function verifyZadarmaSignature(params, signature) {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'sign')
    .sort();
  
  const paramString = sortedKeys
    .map(k => `${k}=${params[k]}`)
    .join('&');
  
  const md5Hash = crypto
    .createHash('md5')
    .update(paramString)
    .digest('hex');
  
  const hmac = crypto
    .createHmac('sha1', ZADARMA_SECRET)
    .update(md5Hash)
    .digest('base64');
  
  return hmac === signature;
}

async function zadarmaClickToCall(fromExt, toNumber) {
  try {
    const params = {
      from: fromExt,
      to: toNumber,
    };
    
    const res = await axios.get('https://api.zadarma.com/v1/request/callback/', {
      params,
      headers: {
        'Authorization': `${ZADARMA_KEY}:${zadarmaSign('/v1/request/callback/', params)}`,
      },
    });
    
    return res.data;
  } catch (err) {
    console.error('[Zadarma] Click-to-Call error:', err.message);
    return { status: 'error', message: err.message };
  }
}

async function zadarmaGetRecording(callId) {
  try {
    const params = { call_id: callId };
    
    const res = await axios.get('https://api.zadarma.com/v1/pbx/record/request/', {
      params,
      headers: {
        'Authorization': `${ZADARMA_KEY}:${zadarmaSign('/v1/pbx/record/request/', params)}`,
      },
    });
    
    if (res.data && res.data.link) {
      return res.data.link;
    }
    return null;
  } catch (err) {
    console.error('[Zadarma] Get recording error:', err.message);
    return null;
  }
}

// ─── WebSocket broadcast ─────────────────────────────────────────────────────

function broadcast(msg) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  });
}

// ─── API: Logowanie ─────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { userId, pin } = req.body;
  const user = users[userId];
  
  if (!user || user.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowy PIN' });
  }
  
  res.json({
    success: true,
    user: { id: user.id, name: user.name, role: user.role, ext: user.ext },
  });
});

// ─── API: Otwarte połączenia (W obsłudze) ────────────────────────────────

app.get('/api/calls/open', async (req, res) => {
  const openCalls = await supabase.getOpenCalls();
  res.json({ calls: openCalls || [] });
});

// ─── API: Zamknięte połączenia (Archiwum) ────────────────────────────────

app.get('/api/calls/closed', async (req, res) => {
  const closedCalls = await supabase.getClosedCalls();
  res.json({ calls: closedCalls || [] });
});

// ─── API: Zamknij temat ─────────────────────────────────────────────────────

app.post('/api/call/close', async (req, res) => {
  const { callId } = req.body;
  
  await supabase.updateCall(callId, {
    topic_closed: true,
    closed_at: new Date().toISOString(),
  });
  
  broadcast({ type: 'CALL_TOPIC_CLOSED', callId });
  res.json({ success: true });
});

// ─── API: Otwórz ponownie temat ────────────────────────────────────────────

app.post('/api/call/reopen', async (req, res) => {
  const { callId } = req.body;
  
  await supabase.updateCall(callId, {
    topic_closed: false,
    closed_at: null,
  });
  
  broadcast({ type: 'CALL_TOPIC_REOPENED', callId });
  res.json({ success: true });
});

// ─── API: Wynik rozmowy ────────────────────────────────────────────────────

app.post('/api/call/outcome', async (req, res) => {
  const {
    callId,
    ghlContactId,
    callEffect,
    temperature,
    userId,
    patientName,
    notes,
    source,
    treatment,
    referredBy,
    gender,
    birthDate,
    bookedVisit,
  } = req.body;
  
  // Update w Supabase
  await supabase.updateCall(callId, {
    call_effect: callEffect,
    temperature: temperature || null,
    user_id: userId,
    patient_name: patientName || null,
    notes: notes || null,
    source: source || null,
    treatment: treatment || null,
    referred_by: referredBy || null,
    gender: gender || null,
    birth_date: birthDate || null,
    ghl_logged: true,
  });
  
  // Logika GHL — przesunięcie na etap
  if (ghlContactId) {
    let targetStage = null;
    let tags = [];
    
    if (callEffect === 'umowiony_w0' || bookedVisit === true) {
      targetStage = STAGES.UMOWIONY_W0;
      tags.push('umowiony_w0');
    } else if (callEffect === 'rozwaza') {
      targetStage = STAGES.PO_ROZMOWIE;
      tags.push('rozwaza_w0');
    } else if (callEffect === 'nie_kwalifikuje_sie') {
      targetStage = STAGES.BEZ_KONTAKTU;
      tags.push('nie_kwalifikuje_sie');
    } else if (callEffect === 'rezygnacja') {
      targetStage = STAGES.BEZ_KONTAKTU;
      tags.push('rezygnacja');
    }
    
    if (targetStage) {
      await moveOpportunityToStage(ghlContactId, targetStage);
    }
    
    for (const tag of tags) {
      await addTagToContact(ghlContactId, tag);
    }
    
    if (notes) {
      await addNoteToContact(ghlContactId, `[${userId}] ${notes}`);
    }
  }
  
  broadcast({ type: 'CALL_OUTCOME_SAVED', callId, callEffect });
  res.json({ success: true });
});

// ─── API: Nowe zgłoszenia z GHL (Etap 1) ────────────────────────────────

app.get('/api/leads/new', async (req, res) => {
  const leads = await getNewLeadsFromGHL();
  res.json({ leads });
});

// ─── API: Kontakty GHL (wyszukiwarka) ────────────────────────────────────

app.get('/api/contacts', (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.json({ contacts: ghlContactsCache.slice(0, 50) });
  }
  
  const query = q.toLowerCase();
  const results = ghlContactsCache.filter(c =>
    c.name.toLowerCase().includes(query) ||
    c.phone.includes(query) ||
    c.email.toLowerCase().includes(query)
  ).slice(0, 50);
  
  res.json({ contacts: results });
});

// ─── API: Click-to-Call ─────────────────────────────────────────────────────

app.post('/api/call/dial', async (req, res) => {
  const { toNumber, fromExt } = req.body;
  
  const ext = fromExt || '103';
  const result = await zadarmaClickToCall(ext, toNumber);
  
  res.json(result);
});

// ─── API: Nagranie ──────────────────────────────────────────────────────────

app.get('/api/call/recording/:callId', async (req, res) => {
  const { callId } = req.params;
  const link = await zadarmaGetRecording(callId);
  
  if (link) {
    res.json({ success: true, link });
  } else {
    res.json({ success: false, link: null });
  }
});

// ─── API: Statystyki per osoba ────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const allCalls = await supabase.query('calls', 'GET', null, {
    'created_at': `gte.${today}T00:00:00`,
  }) || [];
  
  const perUser = {};
  Object.values(users).forEach(u => {
    perUser[u.id] = { name: u.name, total: 0, answered: 0, missed: 0, booked: 0, effects: {} };
  });
  
  allCalls.forEach(c => {
    const uid = c.user_id || 'unassigned';
    if (!perUser[uid]) perUser[uid] = { name: uid, total: 0, answered: 0, missed: 0, booked: 0, effects: {} };
    perUser[uid].total++;
    if (c.status === 'answered') perUser[uid].answered++;
    if (c.status === 'no-answer') perUser[uid].missed++;
    if (c.call_effect === 'umowiony_w0') perUser[uid].booked++;
    const eff = c.call_effect || 'brak';
    perUser[uid].effects[eff] = (perUser[uid].effects[eff] || 0) + 1;
  });
  
  const totals = {
    total: allCalls.length,
    answered: allCalls.filter(c => c.status === 'answered').length,
    missed: allCalls.filter(c => c.status === 'no-answer').length,
    booked: allCalls.filter(c => c.call_effect === 'umowiony_w0').length,
  };
  
  res.json({ totals, perUser });
});

// ─── API: Health check ──────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ghlContacts: ghlContactsCache.length,
    ghlLastSync: ghlContactsLastSync ? new Date(ghlContactsLastSync).toISOString() : null,
  });
});

// ─── Webhook: Zadarma ───────────────────────────────────────────────────────

app.post('/webhook/zadarma', async (req, res) => {
  const { event, call_id, pbx_call_id, caller_id, called_did, seconds, sign, internal, disposition } = req.body;
  
  // Weryfikacja podpisu
  if (!verifyZadarmaSignature(req.body, sign)) {
    console.log('[Zadarma] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const callId = pbx_call_id || call_id || `call_${Date.now()}`;
  
  console.log(`[Zadarma] Event: ${event}, CallID: ${callId}, From: ${caller_id}, To: ${called_did}`);
  
  if (event === 'NOTIFY_START') {
    // Szukaj kontaktu w GHL
    const ghlContact = await getGHLContactByPhone(caller_id);
    
    const callData = {
      call_id: callId,
      pbx_call_id: pbx_call_id || null,
      caller_phone: caller_id,
      called_phone: called_did,
      direction: 'inbound',
      status: 'ringing',
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      ghl_logged: false,
      ghl_contact_id: ghlContact ? ghlContact.id : null,
      patient_name: ghlContact ? ghlContact.name : null,
      topic_closed: false,
      contact_attempts: 0,
    };
    
    // Zapisz w Supabase
    await supabase.insertCall(callData);
    
    broadcast({
      type: 'CALL_RINGING',
      call: callData,
    });
  } else if (event === 'NOTIFY_ANSWER') {
    await supabase.updateCall(callId, {
      status: 'answered',
      answered_at: new Date().toISOString(),
    });
    
    broadcast({ type: 'CALL_ANSWERED', callId });
  } else if (event === 'NOTIFY_END') {
    const duration = parseInt(seconds) || 0;
    const wasAnswered = disposition === 'answered' || duration > 0;
    const status = wasAnswered ? 'answered' : 'no-answer';
    
    const updates = {
      status,
      duration_seconds: duration,
      ended_at: new Date().toISOString(),
    };
    
    // Pobierz link do nagrania
    if (wasAnswered && pbx_call_id) {
      setTimeout(async () => {
        const recordingLink = await zadarmaGetRecording(pbx_call_id);
        if (recordingLink) {
          await supabase.updateCall(callId, { recording_url: recordingLink });
          broadcast({ type: 'CALL_RECORDING_READY', callId, recordingUrl: recordingLink });
        }
      }, 5000); // Czekamy 5s bo nagranie nie jest od razu dostępne
    }
    
    // Jeśli nieodebrane — zwiększ licznik prób
    if (status === 'no-answer') {
      // Pobierz aktualny stan
      const existing = await supabase.query(`calls?call_id=eq.${callId}`, 'GET');
      if (existing && existing.length > 0) {
        const attempts = (existing[0].contact_attempts || 0) + 1;
        updates.contact_attempts = attempts;
        
        // Jeśli 2 nieudane próby — tag w GHL
        if (attempts >= 2 && existing[0].ghl_contact_id) {
          await addTagToContact(existing[0].ghl_contact_id, '2_nieudane_proby');
        }
      }
    }
    
    await supabase.updateCall(callId, updates);
    
    broadcast({
      type: 'CALL_ENDED',
      callId,
      status,
      duration,
    });
  }
  
  res.json({ status: 'ok' });
});

// ─── Frontend static files ──────────────────────────────────────────────────

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ─── WebSocket: Initial sync ───────────────────────────────────────────────

wss.on('connection', async (ws) => {
  console.log('[WS] New connection');
  
  const openCalls = await supabase.getOpenCalls() || [];
  
  ws.send(JSON.stringify({
    type: 'INIT',
    calls: openCalls,
  }));
});

// ─── Startup ────────────────────────────────────────────────────────────────

async function startup() {
  // Sync kontaktów GHL
  await syncGHLContacts();
  
  // Odświeżanie co 10 minut
  setInterval(syncGHLContacts, GHL_SYNC_INTERVAL);
  
  server.listen(PORT, () => {
    console.log(`🚀 Navigator Call v6 running on port ${PORT}`);
    console.log(`📞 WebSocket: ws://localhost:${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log(`📋 GHL Contacts: ${ghlContactsCache.length}`);
  });
}

startup();
