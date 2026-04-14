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

const GHL_TOKEN = process.env.GHL_TOKEN || 'pit-7faaf428-8f3f-4f9b-82c1-a5fb63979645';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'A0NcokQ5ZPxUcHawpRJJ';
const ZADARMA_KEY = process.env.ZADARMA_KEY || '';
const ZADARMA_SECRET = process.env.ZADARMA_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PORT = process.env.PORT || 3000;

// Pipeline ID
const PIPELINE_ID = 'FVgB3ga52b0PUi6QjJ0x';

// Stage IDs — EndoEstetica pipeline
const STAGES = {
  NOWE_ZGLOSZENIE:    '4d006021-f3b2-4efc-8efc-4f049522379c', // Stage 1
  PO_PIERWSZEJ_PROBIE:'002dbc5a-c6a4-4931-a9a3-af4877b2c525', // Stage 2
  PO_DRUGIEJ_PROBIE:  'de0a619e-ee22-41c3-9a90-eccfcb1a8fb8', // Stage 3
  DZIEN_2_EMAIL:      '6d0c5ca9-8b79-4bf3-a091-381e636cd21e', // Stage 4
  DZIEN_4_SMS:        '53ad4911-a26c-41fa-9b23-bc3c88f98ea4', // Stage 5
  BEZ_KONTAKTU:       '6517c39e-15fe-4041-a847-89ba822b3c96', // Stage 6
  PO_ROZMOWIE:        '19126f1b-5529-48fc-be95-d6b64e264e59', // Stage 7
  UMOWIONY_W0:        '73f6704f-1d6a-49dc-8591-4b129ba1b692', // Stage 8
  NO_SHOW:            'afc5a678-b78b-47bd-858e-78968724ac4d', // Stage 9A — nie przyszedł
  ODMOWIL:            '139cde76-d37e-4a14-ad45-ae94a843d78b', // Stage 9B — odmówił
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
  baseURL: 'https://services.leadconnectorhq.com',
  headers: {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  },
});

async function syncGHLContacts() {
  try {
    console.log('[GHL] Syncing contacts...');
    let allContacts = [];
    const limit = 100;
    let startAfter = null;
    let startAfterId = null;
    let page = 0;
    
    while (true) {
      const params = { locationId: GHL_LOCATION_ID, limit };
      if (startAfter)   params.startAfter   = startAfter;
      if (startAfterId) params.startAfterId = startAfterId;

      const res = await ghlApi.get('/contacts/', { params });
      const contacts = res.data.contacts || [];

      allContacts = allContacts.concat(contacts.map(c => ({
        id: c.id,
        name: (c.contactName || `${c.firstName || ''} ${c.lastName || ''}`).trim(),
        firstName: c.firstName || '',
        lastName:  c.lastName  || '',
        phone:     c.phone     || '',
        email:     c.email     || '',
        tags:      c.tags      || [],
      })));

      // GHL v2 paginacja przez startAfter/startAfterId z meta
      const meta = res.data.meta || {};
      if (!meta.nextPage || contacts.length < limit) break;
      // Pobierz startAfter z ostatniego kontaktu
      const last = contacts[contacts.length - 1];
      startAfter   = last.startAfter   ? last.startAfter[0]   : null;
      startAfterId = last.startAfter   ? last.startAfter[1]   : null;

      page++;
      if (page > 50) break; // Safety: max 5000 kontaktów
    }
    
    ghlContactsCache = allContacts;
    ghlContactsLastSync = Date.now();
    console.log(`[GHL] Synced ${allContacts.length} contacts`);
  } catch (err) {
    console.error('[GHL] Sync contacts error:', err.response?.data || err.message);
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
    const searchContacts = res.data.contacts || (res.data.data && res.data.data.contacts) || [];
    if (searchContacts.length > 0) {
      const c = searchContacts[0];
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

async function createOpportunityForContact(contactId, stageId, name, treatment, source) {
  try {
    const oppName = name ? `${name} — rozmowa` : 'Nowa szansa sprzedaży';
    const body = {
      pipelineId: PIPELINE_ID,
      locationId: GHL_LOCATION_ID,
      name: oppName,
      stageId,
      status: 'open',
      contactId,
    };
    if (source) body.source = source;
    const res = await ghlApi.post('/opportunities/', body);
    console.log(`[GHL] Created opportunity for contact ${contactId} at stage ${stageId}`);
    return res.data.opportunity || res.data;
  } catch (err) {
    console.error('[GHL] Create opportunity error:', err.response?.data || err.message);
    return null;
  }
}

async function moveOpportunityToStage(contactId, stageId) {
  try {
    // Szukaj opportunity dla kontaktu — GHL v2
    const res = await ghlApi.get('/opportunities/search', {
      params: { location_id: GHL_LOCATION_ID, contact_id: contactId, pipeline_id: PIPELINE_ID, limit: 10 },
    });
    
    const opps = res.data.opportunities || (res.data.data && res.data.data.opportunities) || [];
    if (opps.length > 0) {
      const oppId = opps[0].id;
      await ghlApi.put(`/opportunities/${oppId}`, {
        stageId,
        pipelineId: PIPELINE_ID,
      });
      console.log(`[GHL] Moved opportunity ${oppId} to stage ${stageId}`);
      return true;
    }
    console.log(`[GHL] No opportunity found for contact ${contactId}`);
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
    console.log(`[GHL] Pobieranie leadów z Etapu 1 | pipeline=${PIPELINE_ID} | stage=${STAGES.NOWE_ZGLOSZENIE} | location=${GHL_LOCATION_ID}`);

    // GHL API v1 — próba 1: /opportunities/search
    let opportunities = [];
    let lastError = null;

    // GHL API v2 — /opportunities/search z filtrem po stage
    try {
      const res = await ghlApi.get('/opportunities/search', {
        params: {
          location_id: GHL_LOCATION_ID,
          pipeline_id: PIPELINE_ID,
          pipeline_stage_id: STAGES.NOWE_ZGLOSZENIE,
          limit: 50,
        },
      });
      console.log('[GHL] Odpowiedź:', JSON.stringify(res.data).slice(0, 200));
      opportunities = res.data.opportunities || [];
    } catch(e) {
      lastError = e;
      console.error('[GHL] Błąd pobierania szans:', e.response?.data || e.message);
    }

    if (lastError && opportunities.length === 0) {
      console.error('[GHL] Nie udało się pobrać szans sprzedaży:', lastError.message);
    }

    console.log(`[GHL] Znaleziono ${opportunities.length} szans sprzedaży w Etapie 1`);

    const leads = [];
    for (const opp of opportunities) {
      // GHL v2: dane kontaktu są w opp.contact lub opp.relations[0]
      const contact = opp.contact || {};
      const relation = (opp.relations && opp.relations[0]) || {};

      const contactId = opp.contactId || contact.id || relation.recordId || '';

      // Imię: z contact.name, relation.fullName lub opp.name
      let contactName = contact.name || relation.fullName || relation.contactName || opp.name || '';

      // Telefon: z relation lub contact
      let contactPhone = relation.phone || contact.phone || '';
      let contactEmail = relation.email || contact.email || '';

      // Jeśli brak telefonu — pobierz pełne dane kontaktu z API
      if (contactId && !contactPhone) {
        try {
          const contactRes = await ghlApi.get(`/contacts/${contactId}`);
          const c = contactRes.data;
          const fn = c.firstName || '';
          const ln = c.lastName  || '';
          if (!contactName) contactName = (c.contactName || `${fn} ${ln}`).trim();
          contactPhone = c.phone || '';
          contactEmail = c.email || contactEmail;
          console.log(`[GHL] Pobrano kontakt ${contactId}: ${contactName} / ${contactPhone}`);
        } catch (e) {
          console.error(`[GHL] Błąd pobierania kontaktu ${contactId}:`, e.message);
        }
      }

      leads.push({
        id:        opp.id,
        contactId: contactId,
        name:      contactName || 'Brak imienia',
        phone:     contactPhone || '',
        email:     contactEmail || '',
        createdAt: opp.createdAt || new Date().toISOString(),
        source:    opp.source || '',
        oppName:   opp.name   || '',
      });
    }

    console.log(`[GHL] Zwrócono ${leads.length} leadów do aplikacji`);
    return leads;
  } catch (err) {
    console.error('[GHL] Get new leads error:', err.response?.data || err.message);
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
    contactType,
    callEffect,
    callReason,
    temperature,
    objections,
    userId,
    firstName,
    lastName,
    patientName,
    notes,
    source,
    treatment,
    referredBy,
    gender,
    birthDate,
    bookedVisit,
  } = req.body;

  // ─── Mapowanie callEffect → GHL stage ───────────────────────────────────
  // Etap 7 (PO_ROZMOWIE)  = po rozmowie, bez umówionej wizyty
  // Etap 8 (UMOWIONY_W0)  = wizyta umówiona
  // Etap 2 (PO_PIERWSZEJ_PROBIE) = nieodebrane
  // Etap 6 (BEZ_KONTAKTU) = nie kwalifikuje się / rezygnacja
  const EFFECT_TO_STAGE = {
    umowiony_w0:       STAGES.UMOWIONY_W0,         // Etap 8
    followup:          STAGES.PO_ROZMOWIE,          // Etap 7
    brak_decyzji:      STAGES.PO_ROZMOWIE,          // Etap 7
    rozwaza:           STAGES.PO_ROZMOWIE,          // Etap 7 (legacy)
    nie_odebral:       STAGES.PO_PIERWSZEJ_PROBIE,  // Etap 2
    nie_kwalifikuje_sie: STAGES.BEZ_KONTAKTU,       // Etap 6
    rezygnacja:        STAGES.BEZ_KONTAKTU,         // Etap 6
    nie_pacjent:       null,                        // Bez zmiany etapu
  };

  const EFFECT_TO_TAGS = {
    umowiony_w0:       ['umowiony_w0', 'etap_8'],
    followup:          ['followup', 'etap_7'],
    brak_decyzji:      ['brak_decyzji', 'etap_7'],
    nie_odebral:       ['nie_odebral', 'etap_2'],
    nie_kwalifikuje_sie: ['nie_kwalifikuje_sie', 'etap_6'],
    rezygnacja:        ['rezygnacja', 'etap_6'],
    nie_pacjent:       ['nie_pacjent'],
  };

  const isBooked = callEffect === 'umowiony_w0' || bookedVisit === true;

  // ─── Update w Supabase ───────────────────────────────────────────────────
  await supabase.updateCall(callId, {
    contact_type:  contactType  || null,
    call_effect:   callEffect,
    call_reason:   callReason   || null,
    temperature:   temperature  || null,
    objections:    objections   || null,
    user_id:       userId,
    patient_name:  patientName  || null,
    notes:         notes        || null,
    source:        source       || null,
    treatment:     treatment    || null,
    referred_by:   referredBy   || null,
    gender:        gender       || null,
    birth_date:    birthDate    || null,
    booked_visit:  isBooked,
    ghl_logged:    true,
  });

  // ─── Logika GHL ──────────────────────────────────────────────────────────
  // Krok 1: Pobierz pełne dane z’ Supabase (telefon + ghl_contact_id)
  const callRows = await supabase.query(`calls?call_id=eq.${callId}`, 'GET');
  const callRow  = callRows && callRows.length > 0 ? callRows[0] : null;
  const callerPhone = callRow ? (callRow.caller_phone || '') : '';

  // Krok 2: Ustal ghl_contact_id
  let resolvedContactId = ghlContactId || (callRow ? callRow.ghl_contact_id : null);

  // Krok 3: Jeśli brak kontaktu w GHL — utwórz go ZAWSZE (nawet bez imienia)
  if (!resolvedContactId) {
    try {
      const newContact = {
        firstName:  firstName  || 'Nieznany',
        lastName:   lastName   || '',
        locationId: GHL_LOCATION_ID,
      };
      if (callerPhone) newContact.phone = callerPhone;
      const result  = await ghlApi.post('/contacts/', newContact);
      const created = result.data.contact || result.data;
      resolvedContactId = created.id;
      console.log(`[GHL] Created contact: ${resolvedContactId} (${firstName} ${lastName} / ${callerPhone})`);
      // Zapisz w Supabase
      await supabase.updateCall(callId, { ghl_contact_id: resolvedContactId });
    } catch (err) {
      console.error('[GHL] Create contact error:', err.response?.data || err.message);
    }
  } else {
    // Krok 3b: Kontakt istnieje — zaktualizuj imię/nazwisko jeśli podano
    if (firstName || lastName) {
      try {
        const upd = {};
        if (firstName) upd.firstName = firstName;
        if (lastName)  upd.lastName  = lastName;
        await ghlApi.put(`/contacts/${resolvedContactId}`, upd);
        console.log(`[GHL] Updated contact ${resolvedContactId}: ${firstName} ${lastName}`);
      } catch (err) {
        console.error('[GHL] Update contact error:', err.response?.data || err.message);
      }
    }
  }

  // Krok 4: Przesuń / utwórz szansę sprzedaży
  if (resolvedContactId) {
    const targetStage = EFFECT_TO_STAGE[callEffect] ?? null;
    const tags = [...(EFFECT_TO_TAGS[callEffect] || []), 'lead_call'];
    if (treatment) tags.push(`leczenie_${treatment}`);
    if (source)    tags.push(`zrodlo_${source}`);

    if (targetStage) {
      const moved = await moveOpportunityToStage(resolvedContactId, targetStage);
      if (!moved) {
        await createOpportunityForContact(resolvedContactId, targetStage, patientName, treatment, source);
      }
    }

    for (const tag of tags) {
      await addTagToContact(resolvedContactId, tag);
    }

    // Notatka z raportu
    const noteLines = [];
    if (contactType) noteLines.push(`Typ kontaktu: ${contactType}`);
    if (callEffect)  noteLines.push(`Efekt rozmowy: ${callEffect}`);
    if (req.body.visitDate)    noteLines.push(`Data wizyty: ${req.body.visitDate}`);
    if (req.body.followupWhen) noteLines.push(`Kiedy kontakt: ${req.body.followupWhen}`);
    if (req.body.followupDate) noteLines.push(`Data kontaktu: ${req.body.followupDate}`);
    if (req.body.reasonNeg)    noteLines.push(`Powód: ${req.body.reasonNeg}`);
    if (source)      noteLines.push(`Źródło: ${source}`);
    if (referredBy)  noteLines.push(`Polecony przez: ${referredBy}`);
    if (notes)       noteLines.push(`Notatki: ${notes}`);
    if (callerPhone) noteLines.push(`Telefon: ${callerPhone}`);
    if (noteLines.length > 0) {
      await addNoteToContact(
        resolvedContactId,
        `[Navigator Call | ${userId} | ${new Date().toLocaleString('pl-PL')}]\n${noteLines.join('\n')}`
      );
    }
  }

  // Krok 5: Zaktualizuj lokalny cache kontaktów GHL
  if (resolvedContactId) {
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || patientName || 'Nieznany';
    const existingIdx = ghlContactsCache.findIndex(c => c.id === resolvedContactId);
    const contactEntry = {
      id:        resolvedContactId,
      name:      fullName,
      firstName: firstName || '',
      lastName:  lastName  || '',
      phone:     callerPhone || '',
      email:     '',
      tags:      [...(EFFECT_TO_TAGS[callEffect] || []), 'lead_call'],
    };
    if (existingIdx >= 0) {
      // Aktualizuj istniejący wpis
      ghlContactsCache[existingIdx] = { ...ghlContactsCache[existingIdx], ...contactEntry };
    } else {
      // Dodaj nowy na początek listy
      ghlContactsCache.unshift(contactEntry);
    }
    // Wyślij do wszystkich klientów WS — frontend odświeży zakładkę Kontakty
    broadcast({ type: 'CONTACT_UPSERTED', contact: contactEntry });
  }

  // Krok 6: Auto-zamknij temat w aplikacji po zapisaniu raportu
  await supabase.updateCall(callId, {
    topic_closed: true,
    closed_at: new Date().toISOString(),
  });

  broadcast({ type: 'CALL_OUTCOME_SAVED', callId, callEffect, contactType });
  broadcast({ type: 'CALL_TOPIC_CLOSED',  callId });
  res.json({ success: true });
});

// ─── API: Nowe zgłoszenia z GHL (Etap 1) ────────────────────────────────

app.get('/api/leads/new', async (req, res) => {
  const leads = await getNewLeadsFromGHL();
  res.json({ leads });
});

// ─── DIAGNOSTYKA: surowa odpowiedź z GHL (do debugowania) ───
app.get('/api/leads/debug', async (req, res) => {
  try {
    // Próba 1: /opportunities/search
    let r1 = null, r2 = null, err1 = null, err2 = null;
    try {
      const x = await ghlApi.get('/opportunities/search', {
        params: {
          location_id: GHL_LOCATION_ID,
          pipeline_id: PIPELINE_ID,
          pipeline_stage_id: STAGES.NOWE_ZGLOSZENIE,
          limit: 10,
        },
      });
      r1 = x.data;
    } catch(e) { err1 = e.response?.data || e.message; }

    // Próba 2: /opportunities/
    try {
      const x = await ghlApi.get('/opportunities/', {
        params: {
          locationId: GHL_LOCATION_ID,
          pipelineId: PIPELINE_ID,
          stageId: STAGES.NOWE_ZGLOSZENIE,
          limit: 10,
        },
      });
      r2 = x.data;
    } catch(e) { err2 = e.response?.data || e.message; }

    res.json({
      config: { PIPELINE_ID, STAGE_ID: STAGES.NOWE_ZGLOSZENIE, GHL_LOCATION_ID: GHL_LOCATION_ID ? '✅ ustawione' : '❌ brak' },
      search_endpoint: { result: r1, error: err1 },
      opportunities_endpoint: { result: r2, error: err2 },
    });
  } catch(e) {
    res.json({ error: e.message });
  }
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

// ─── API: Dodaj kontakt do GHL ───────────────────────────────────────

app.post('/api/contacts/add', async (req, res) => {
  const { firstName, lastName, phone, email, source, treatment, notes } = req.body;
  
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Numer telefonu jest wymagany' });
  }
  
  try {
    const contactData = {
      firstName: firstName || '',
      lastName: lastName || '',
      phone,
      locationId: GHL_LOCATION_ID,
    };
    if (email) contactData.email = email;
    if (source) contactData.source = source;
    
    const result = await ghlApi.post('/contacts/', contactData);
    const contact = result.data.contact || result.data;
    
    console.log(`[GHL] Contact created: ${contact.id} - ${firstName} ${lastName} (${phone})`);
    
    // Dodaj tagi
    const tags = ['lead_manual'];
    if (treatment) tags.push(`leczenie_${treatment}`);
    if (source) tags.push(`zrodlo_${source}`);
    
    try {
      await ghlApi.post(`/contacts/${contact.id}/tags`, { tags });
    } catch (e) { /* ignore tag error */ }
    
    // Dodaj notatkę
    if (notes) {
      try {
        await ghlApi.post(`/contacts/${contact.id}/notes`, { body: notes });
      } catch (e) { /* ignore */ }
    }
    
    // Dodaj do cache
    ghlContactsCache.push({
      id: contact.id,
      name: `${firstName} ${lastName}`.trim(),
      phone,
      email: email || '',
    });
    
    res.json({ success: true, contactId: contact.id });
  } catch (err) {
    console.error('[GHL] Add contact error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
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
  
  const typeCounts = { nowy:0, staly:0, wizyta:0, nie_pacjent:0 };
  allCalls.forEach(c => {
    const t = c.contact_type;
    if (t && typeCounts[t] !== undefined) typeCounts[t]++;
  });

  // ── KPI 1: Odbieralność (%)
  const inbound = allCalls.filter(c => c.direction !== 'outbound');
  const answeredInbound = inbound.filter(c => c.status === 'answered');
  const pickupRate = inbound.length > 0
    ? Math.round((answeredInbound.length / inbound.length) * 100)
    : null;

  // ── KPI 2: Oddzwanialność na nieodebrane (%)
  // Grupujemy nieodebrane po numerze telefonu (unikalne numery)
  // Jeśli na dany numer było oddzwonienie (answered call z tym numerem) — liczymy 1:1
  const missedCalls = inbound.filter(c => c.status === 'no-answer');
  const missedPhones = [...new Set(missedCalls.map(c => c.caller_phone).filter(Boolean))];
  const callbackPhones = new Set(
    allCalls
      .filter(c => c.direction === 'outbound' && c.status === 'answered')
      .map(c => c.caller_phone)
      .filter(Boolean)
  );
  // Także: jeśli po nieodebranym ten sam numer zadzwonił ponownie i został odebrany
  const answeredPhones = new Set(
    answeredInbound.map(c => c.caller_phone).filter(Boolean)
  );
  const calledBackCount = missedPhones.filter(phone =>
    callbackPhones.has(phone) || answeredPhones.has(phone)
  ).length;
  const callbackRate = missedPhones.length > 0
    ? Math.round((calledBackCount / missedPhones.length) * 100)
    : null;

  // ── KPI 3: Czas odebrania ≤ 35s (% połączeń odebranych w ciągu 35s)
  const KPI_PICKUP_SECONDS = 35;
  const KPI_PICKUP_TARGET  = 85; // % cel
  const callsWithTiming = answeredInbound.filter(c => c.answered_at && c.created_at);
  const fastPickup = callsWithTiming.filter(c => {
    const waitSec = (new Date(c.answered_at) - new Date(c.created_at)) / 1000;
    return waitSec <= KPI_PICKUP_SECONDS;
  });
  const fastPickupRate = callsWithTiming.length > 0
    ? Math.round((fastPickup.length / callsWithTiming.length) * 100)
    : null;

  const totals = {
    total:    allCalls.length,
    answered: answeredInbound.length,
    missed:   missedCalls.length,
    booked:   allCalls.filter(c => c.call_effect === 'umowiony_w0').length,
    followup: allCalls.filter(c => c.call_effect === 'followup' || c.call_effect === 'brak_decyzji').length,
  };

  const kpi = {
    pickupRate:     { value: pickupRate,     label: 'Odbieralność',          unit: '%', target: 90, higher_is_better: true },
    callbackRate:   { value: callbackRate,   label: 'Oddzwanialność',        unit: '%', target: 90, higher_is_better: true },
    fastPickupRate: { value: fastPickupRate, label: 'Odebrane ≤35s',         unit: '%', target: KPI_PICKUP_TARGET, higher_is_better: true },
    missedUnique:   { value: missedPhones.length, label: 'Unikalne nieodebrane', unit: '', target: null },
    calledBack:     { value: calledBackCount,     label: 'Oddzwoniono',          unit: '', target: null },
  };

  res.json({ totals, perUser, typeCounts, kpi });
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

// Zadarma verification (GET z zd_echo)
app.get('/webhook/zadarma', (req, res) => {
  if (req.query.zd_echo) return res.send(req.query.zd_echo);
  res.json({ status: 'ok' });
});

app.post('/webhook/zadarma', async (req, res) => {
  const { event, call_id, pbx_call_id, caller_id, called_did, seconds, sign, internal, disposition } = req.body;
  
  // Weryfikacja podpisu — tymczasowo wyłączona (debug)
  // if (!verifyZadarmaSignature(req.body, sign)) {
  //   console.log('[Zadarma] Invalid signature');
  //   return res.status(401).json({ error: 'Invalid signature' });
  // }
  console.log('[Zadarma] Webhook received:', JSON.stringify(req.body));
  
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
