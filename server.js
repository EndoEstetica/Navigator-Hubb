// Navigator Call v7 — server.js
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

// Obsługa aliasów zmiennych środowiskowych (kompatybilność z v6 i innymi wersjami)
const GHL_TOKEN = process.env.GHL_TOKEN || process.env.GHL_API_TOKEN || 'pit-1ddb3acd-eedb-4a40-bfae-a36188d9c971';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'A0NcokQ5ZPxUcHawpRJJ';
const ZADARMA_KEY = process.env.ZADARMA_KEY || process.env.ZADARMA_API_KEY || '80fb966e516fd1ac565e';
const ZADARMA_SECRET = process.env.ZADARMA_SECRET || process.env.ZADARMA_API_SECRET || 'fde11f66f6eb8372080f';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PORT = process.env.PORT || 3000;

// Sonia — użytkownik GHL do zadań edycji kontaktów
const SONIA_GHL_EMAIL = 'sonia.czajewicz.endoestetica@gmail.com';

// Pipeline ID
const PIPELINE_ID = 'FVgB3ga52b0PUi6QjJ0x';

// Stage IDs — EndoEstetica pipeline
const STAGES = {
  NOWE_ZGLOSZENIE:    '4d006021-f3b2-4efc-8efc-4f049522379c', // Stage 1 (EndoEstetica)
  NOWE_ZGLOSZENIE_ALT: '4d006021-f3b2-4efc-8efc-4f049522379c', // To samo co wyżej, ale upewnijmy się że jest używane poprawnie
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

// Role: reception | caretaker | admin
// reception    = Recepcja
// caretaker     = Opiekun Pacjenta
// admin         = Administracja

const users = {
  // ── RECEPCJA ─────────────────────────────────────────────────────────────
  kasia:       { id: 'kasia',       name: 'Kasia',       role: 'reception', ext: '101', pin: '1101' },
  asia:        { id: 'asia',        name: 'Asia',        role: 'reception', ext: '102', pin: '1102' },
  agata_r:     { id: 'agata_r',     name: 'Agata',       role: 'reception', ext: '103', pin: '1103' },
  agnieszka:   { id: 'agnieszka',   name: 'Agnieszka',   role: 'reception', ext: '104', pin: '1104' },
  zastepstwo:  { id: 'zastepstwo',  name: 'Zastępstwo',  role: 'reception', ext: '105', pin: '1105' },
  // ── OPIEKUN PACJENTA ─────────────────────────────────────────────────────
  aneta:       { id: 'aneta',       name: 'Aneta',       role: 'caretaker', ext: '101', pin: '2201' },
  agata_o:     { id: 'agata_o',     name: 'Agata (OP)',  role: 'caretaker', ext: '102', pin: '2202' },
  // ── ADMINISTRACJA (brak numeru wewnętrznego — nie obsługuje połączeń) ──────────────
  bartosz:     { id: 'bartosz',     name: 'Bartosz',     role: 'admin',     ext: null,  pin: '3301' },
  sandra:      { id: 'sandra',      name: 'Sandra',      role: 'admin',     ext: null,  pin: '3302' },
  aneta_a:     { id: 'aneta_a',     name: 'Aneta (ADM)', role: 'admin',     ext: null,  pin: '3303' },
  patrycja:    { id: 'patrycja',    name: 'Patrycja',    role: 'admin',     ext: null,  pin: '3304' },
  sonia:       { id: 'sonia',       name: 'Sonia',       role: 'admin',     ext: null,  pin: '3305' },
};

// ─── In-memory cache ─────────────────────────────────────────────────────────

let ghlContactsCache = [];
let ghlContactsLastSync = 0;
const GHL_SYNC_INTERVAL = 10 * 60 * 1000; // 10 minut

let ghlLeadsCache = null;
let ghlLeadsLastSync = 0;
const GHL_LEADS_CACHE_TTL = 10 * 1000; // 10 sekund cache dla nowych zgłoszeń (szybsza synchronizacja)

// ─── Supabase Helper ─────────────────────────────────────────────────────────

const supabase = {
  async query(path, method = 'GET', body = null, params = {}) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
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
    // Zadarma może wysyłać ten sam pbx_call_id w kilku zdarzeniach.
    // Jeśli call_id już istnieje — aktualizujemy rekord zamiast blokować INSERT.
    // Supabase: Prefer: resolution=merge-duplicates + on_conflict=call_id
    const url = new URL(`${SUPABASE_URL}/rest/v1/calls`);
    url.searchParams.set('on_conflict', 'call_id');
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    };
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(callData),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('[Supabase] insertCall upsert error:', text);
        // Fallback: jeśli upsert nie działa, użyj unikalnego call_id z timestamp
        const fallbackData = { ...callData, call_id: callData.call_id + '_' + Date.now() };
        return this.query('calls', 'POST', fallbackData);
      }
      return await res.json();
    } catch (err) {
      console.error('[Supabase] insertCall error:', err.message);
      return null;
    }
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

// ─── GHL: Sync kontaktów (tylko z numerem telefonu) ─────────────────────────

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

      // Używamy ghlRequest zamiast bezpośredniego ghlApi.get dla obsługi 429
      const data = await ghlRequest('get', '/contacts/', params);
      const contacts = data.contacts || [];

      // Pobieraj wszystkie kontakty (nawet bez telefonu)
      allContacts = allContacts.concat(contacts.map(c => ({
        id: c.id,
        name: (c.contactName || `${c.firstName || ''} ${c.lastName || ''}`).trim(),
        firstName: c.firstName || '',
        lastName:  c.lastName  || '',
        phone:     c.phone     || '',
        email:     c.email     || '',
        tags:      c.tags      || [],
      })));

      const meta = data.meta || {};
      if (!meta.nextPage || contacts.length < limit) break;
      
      const last = contacts[contacts.length - 1];
      // Poprawka paginacji GHL v2
      if (meta.startAfterId) {
          startAfterId = meta.startAfterId;
          startAfter = meta.startAfter;
      } else {
          startAfter   = last.startAfter   ? last.startAfter[0]   : null;
          startAfterId = last.startAfter   ? last.startAfter[1]   : null;
      }

      page++;
      if (page > 50) break;
      // Dodajemy małe opóźnienie między stronami, aby nie uderzać zbyt mocno w API
      await new Promise(r => setTimeout(r, 500));
    }
    
    ghlContactsCache = allContacts;
    ghlContactsLastSync = Date.now();
    console.log(`[GHL] Synced ${allContacts.length} contacts (with phone only)`);
  } catch (err) {
    console.error('[GHL] Sync contacts error:', err.response?.data || err.message);
  }
}

async function getGHLContactByPhone(phone) {
  const normalized = phone.replace(/[^0-9+]/g, '');
  
  let contact = ghlContactsCache.find(c => {
    const cPhone = (c.phone || '').replace(/[^0-9+]/g, '');
    return cPhone === normalized || cPhone.endsWith(normalized.slice(-9)) || normalized.endsWith(cPhone.slice(-9));
  });
  
  if (contact) return contact;
  
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
    await ghlApi.post(`/contacts/${contactId}/tags`, { tags: [tag] });
    return true;
  } catch (err) {
    console.error('[GHL] Tag error:', err.message);
    return false;
  }
}

async function addNoteToContact(contactId, note) {
  try {
    await ghlApi.post(`/contacts/${contactId}/notes`, { body: note });
    return true;
  } catch (err) {
    console.error('[GHL] Note error:', err.message);
    return false;
  }
}

// pkt 7: Utwórz zadanie w GHL dla Soni (edycja kontaktu)
async function createTaskForSonia(contactId, contactName, changeRequest, requestedBy) {
  try {
    // GHL User ID Soni — hardcoded (MPfq6I0r42R3P50ZqJ3V)
    const soniaUserId = 'MPfq6I0r42R3P50ZqJ3V';

    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 24);

    const taskBody = {
      title: `Edycja kontaktu: ${contactName}`,
      body: `Recepcja (${requestedBy}) prosi o zmianę danych:\n\n${changeRequest}\n\nKontakt: ${contactName} (ID: ${contactId})`,
      dueDate: dueDate.toISOString(),
      status: 'incompleted',
      contactId,
    };
    if (soniaUserId) taskBody.assignedTo = soniaUserId;

    await ghlApi.post(`/contacts/${contactId}/tasks`, taskBody);
    console.log(`[GHL] Task created for Sonia: edit contact ${contactId}`);
    return true;
  } catch (err) {
    console.error('[GHL] Create task error:', err.response?.data || err.message);
    return false;
  }
}

// pkt 2: Pobierz leady z Etapu 1 lejka — naprawiona wersja z retry
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ghlRequest(method, path, params = {}, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await ghlApi[method](path, { params });
      return res.data;
    } catch(e) {
      const status = e.response?.status;
      if (status === 429 && i < retries - 1) {
        const wait = Math.pow(2, i + 1) * 2000; // Exponential backoff: 4s, 8s, 16s, 32s
        console.warn(`[GHL] Rate limit (429), retry ${i+1}/${retries} in ${wait}ms...`);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      throw e;
    }
  }
}

async function getNewLeadsFromGHL() {
  try {
    console.log(`[GHL] Pobieranie leadów z Etapu 1 | pipeline=${PIPELINE_ID} | stage=${STAGES.NOWE_ZGLOSZENIE}`);
    let opportunities = [];

    // Metoda identyczna jak w v6 która działa:
    // GET /opportunities/search?location_id=...&pipeline_id=...&limit=100
    // Następnie filtrujemy po stageId po stronie serwera
    try {
      const data = await ghlRequest('get', '/opportunities/search', {
        location_id: GHL_LOCATION_ID,
        pipeline_id: PIPELINE_ID,
        limit: 100,
      });
      const all = data.opportunities || [];
      console.log(`[GHL] /opportunities/search zwróciło ${all.length} szans w pipeline`);

      // Filtruj po Stage 1 (Nowe Zgłoszenie)
      opportunities = all.filter(o =>
        o.stageId === STAGES.NOWE_ZGLOSZENIE ||
        o.pipelineStageId === STAGES.NOWE_ZGLOSZENIE
      );

      // Jeśli po filtrowaniu pusto, zaloguj dostępne stageId (diagnostyka)
      if (opportunities.length === 0 && all.length > 0) {
        const availableStages = [...new Set(all.map(o => o.stageId).filter(Boolean))];
        console.warn(`[GHL] Brak szans w Stage 1 (${STAGES.NOWE_ZGLOSZENIE}). Dostępne stageId: ${availableStages.join(', ')}`);
        // Fallback: pokaż otwarte szanse z całego pipeline
        opportunities = all.filter(o => o.status === 'open' || !o.status);
        console.log(`[GHL] Fallback: ${opportunities.length} otwartych szans z całego pipeline`);
      }

      console.log(`[GHL] Etap 1: ${opportunities.length} szans`);
    } catch(e) {
      console.error('[GHL] /opportunities/search błąd:', e.response?.data || e.message);
    }

    console.log(`[GHL] Znaleziono ${opportunities.length} szans sprzedaży w Etapie 1`);

    const leads = [];
    for (const opp of opportunities) {
      const contact = opp.contact || {};
      const relation = (opp.relations && opp.relations[0]) || {};

      const contactId = opp.contactId || contact.id || relation.recordId || '';

      let contactName = contact.name || relation.fullName || relation.contactName || opp.name || '';
      let contactPhone = relation.phone || contact.phone || '';
      let contactEmail = relation.email || contact.email || '';

      let zCzymSieZglasza = '';
      let contactTags = [];
      if (contactId) {
        try {
          const contactRes = await ghlApi.get(`/contacts/${contactId}`);
          const c = contactRes.data.contact || contactRes.data;
          const fn = c.firstName || '';
          const ln = c.lastName  || '';
          if (!contactName) contactName = (c.contactName || `${fn} ${ln}`).trim();
          if (!contactPhone) contactPhone = c.phone || '';
          if (!contactEmail) contactEmail = c.email || '';
          contactTags = c.tags || [];
          // Pole z_czym_sie_zglasza
          const customFields = c.customFields || c.customField || [];
          const zField = customFields.find(f =>
            f.key === 'z_czym_si_zgasza' || f.fieldKey === 'z_czym_si_zgasza' ||
            (f.name || '').toLowerCase().includes('z czym') ||
            (f.name || '').toLowerCase().includes('zgłasza')
          );
          if (zField) zCzymSieZglasza = zField.value || zField.fieldValue || '';
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
        source:    opp.source || opp.leadSource || '',
        oppName:   opp.name   || '',
        notes:     opp.notes  || '',
        z_czym_sie_zglasza: zCzymSieZglasza,
        tags:      contactTags,
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
  // Zadarma HMAC-SHA1 signature — zweryfikowana implementacja (zgodna z v6 która działa)
  // Źródło: https://zadarma.com/en/support/api/
  // Algorytm: base64( hmac_sha1( SECRET, queryString + md5(queryString) ) )
  // UWAGA: endpoint (method) NIE wchodzi do sygnatury — tylko query string!
  
  // 1. Sortowanie kluczy alfabetycznie
  const sortedKeys = Object.keys(params).sort();
  
  // 2. Budowanie query string (raw key=value, bez encodeURIComponent)
  const paramString = sortedKeys.map(k => `${k}=${String(params[k])}`).join('&');
  
  // 3. MD5 z query string → HEX
  const md5Hash = crypto.createHash('md5').update(paramString).digest('hex');
  
  // 4. String do podpisu: TYLKO query_string + md5 (bez nazwy endpointu!)
  const signString = paramString + md5Hash;
  
  // 5. HMAC-SHA1 z SECRET → BINARY → base64
  const signature = crypto.createHmac('sha1', ZADARMA_SECRET)
    .update(signString)
    .digest('base64');
  
  return signature;
}

function verifyZadarmaSignature(params, signature) {
  const sortedKeys = Object.keys(params).filter(k => k !== 'sign').sort();
  const paramString = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const md5Hash = crypto.createHash('md5').update(paramString).digest('hex');
  const hexSignature = crypto.createHmac('sha1', ZADARMA_SECRET)
    .update('/v1/request/callback/' + paramString + md5Hash).digest('hex');
  const computedSignature = Buffer.from(hexSignature).toString('base64');
  return computedSignature === signature;
}

async function zadarmaClickToCall(fromExt, toNumber, retries = 3) {
  // Zadarma callback API preferuje format z '+' dla numerów międzynarodowych
  let formattedTo = toNumber.trim();
  if (!formattedTo.startsWith('+')) {
    // Jeśli numer ma 9 cyfr, dodaj +48
    const digits = formattedTo.replace(/[^0-9]/g, '');
    if (digits.length === 9) {
      formattedTo = '+48' + digits;
    } else if (digits.length > 9 && !formattedTo.startsWith('00')) {
      formattedTo = '+' + digits;
    }
  }
  
  for (let i = 0; i < retries; i++) {
    try {
      // Parametr 'from' to numer wewnętrzny (extension), 'to' to numer docelowy
      const params = { from: String(fromExt), to: String(formattedTo) };
      const sign = zadarmaSign('/v1/request/callback/', params);
      const res = await axios.get('https://api.zadarma.com/v1/request/callback/', {
        params,
        headers: { 'Authorization': `${ZADARMA_KEY}:${sign}` },
        timeout: 10000,
      });
      console.log(`[Zadarma] Click-to-Call success: ${fromExt} -> ${formattedTo}`);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const errData = err.response?.data || err.message;
      console.error(`[Zadarma] Click-to-Call error (attempt ${i+1}/${retries}):`, errData);
      
      if ((status === 429 || status === 503) && i < retries - 1) {
        const wait = Math.pow(2, i + 1) * 1000;
        console.log(`[Zadarma] Retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      
      if (i === retries - 1) {
        return { status: 'error', message: typeof errData === 'object' ? errData.message : errData };
      }
    }
  }
}

async function zadarmaGetRecording(callId) {
  try {
    const params = { call_id: callId };
    const res = await axios.get('https://api.zadarma.com/v1/pbx/record/request/', {
      params,
      headers: { 'Authorization': `${ZADARMA_KEY}:${zadarmaSign('/v1/pbx/record/request/', params)}` },
    });
    if (res.data && res.data.link) return res.data.link;
    return null;
  } catch (err) {
    console.error('[Zadarma] Get recording error:', err.message);
    return null;
  }
}

// ─── Kolejka retry dla nagrań ──────────────────────────────────────────────────────
// Nagrania w Zadarma pojawiają się z opóźnieniem po zakończeniu rozmowy.
// Strategia retry: 5s, 30s, 2min, 5min, 10min, 20min

const RECORDING_RETRY_DELAYS = [5000, 30000, 120000, 300000, 600000, 1200000];
const recordingQueue = new Map(); // callId -> { pbxCallId, attempt, timer }

function scheduleRecordingFetch(callId, pbxCallId, attempt = 0) {
  if (attempt >= RECORDING_RETRY_DELAYS.length) {
    console.log(`[Recording] Max retries reached for ${callId}, giving up.`);
    recordingQueue.delete(callId);
    return;
  }
  const delay = RECORDING_RETRY_DELAYS[attempt];
  console.log(`[Recording] Scheduling attempt ${attempt + 1}/${RECORDING_RETRY_DELAYS.length} for ${callId} in ${delay/1000}s`);
  const timer = setTimeout(async () => {
    try {
      const link = await zadarmaGetRecording(pbxCallId);
      if (link) {
        console.log(`[Recording] Got recording for ${callId} on attempt ${attempt + 1}: ${link}`);
        await supabase.updateCall(callId, { recording_url: link });
        broadcast({ type: 'CALL_RECORDING_READY', callId, recordingUrl: link });
        recordingQueue.delete(callId);
      } else {
        console.log(`[Recording] Not ready yet for ${callId} (attempt ${attempt + 1}), retrying...`);
        scheduleRecordingFetch(callId, pbxCallId, attempt + 1);
      }
    } catch (err) {
      console.error(`[Recording] Error fetching for ${callId}:`, err.message);
      scheduleRecordingFetch(callId, pbxCallId, attempt + 1);
    }
  }, delay);
  recordingQueue.set(callId, { pbxCallId, attempt, timer });
}

// ─── WebSocket broadcast ─────────────────────────────────────────────────────────

function broadcast(msg) { wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(JSON.stringify(msg));
  });
}

// ─── API: Logowanie ─────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { userId, pin } = req.body;
  const user = users[userId];
  if (!user || user.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Nieprawidłowy PIN' });
  }
  res.json({ success: true, user: { id: user.id, name: user.name, role: user.role, ext: user.ext } });
});

// ─── API: Otwarte połączenia (W obsłudze) ────────────────────────────────

app.get('/api/calls/open', async (req, res) => {
  const openCalls = await supabase.getOpenCalls();
  res.json({ calls: openCalls || [] });
});

// ─── API: Wszystkie połączenia (widok Archiwum) ────────────────────────────────
// Zwraca połączenia z ostatnich 7 dni, posortowane od najnowszych

app.get('/api/calls', async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const calls = await supabase.query('calls', 'GET', null, {
    'created_at': `gte.${since.toISOString().slice(0,10)}T00:00:00`,
    'order': 'created_at.desc',
    'limit': '200',
  });
  res.json({ calls: calls || [] });
});

// ─── API: Zamknięte połączenia (Archiwum) ────────────────────────────────

app.get('/api/calls/closed', async (req, res) => {
  const closedCalls = await supabase.getClosedCalls();
  res.json({ calls: closedCalls || [] });
});

// ─── API: Debug połączeń ─────────────────────────────────────────────────────

app.get('/api/calls/debug', async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const calls = await supabase.query('calls', 'GET', null, {
    'created_at': `gte.${since.toISOString().slice(0,10)}T00:00:00`,
    'order': 'created_at.desc',
    'limit': '20',
  });
  res.json({
    count: (calls || []).length,
    calls: (calls || []).map(c => ({
      call_id: c.call_id,
      direction: c.direction,
      status: c.status,
      topic_closed: c.topic_closed,
      caller_phone: c.caller_phone,
      called_phone: c.called_phone,
      created_at: c.created_at,
      duration_seconds: c.duration_seconds,
    }))
  });
});

// ─── API: Zamknij temat ─────────────────────────────────────────────────────

app.post('/api/call/close', async (req, res) => {
  const { callId } = req.body;
  await supabase.updateCall(callId, { topic_closed: true, closed_at: new Date().toISOString() });
  broadcast({ type: 'CALL_TOPIC_CLOSED', callId });
  res.json({ success: true });
});

// ─── API: Otwórz ponownie temat ────────────────────────────────────────────

app.post('/api/call/reopen', async (req, res) => {
  const { callId } = req.body;
  await supabase.updateCall(callId, { topic_closed: false, closed_at: null });
  broadcast({ type: 'CALL_TOPIC_REOPENED', callId });
  res.json({ success: true });
});

// ─── API: Wynik rozmowy ────────────────────────────────────────────────────

app.post('/api/call/outcome', async (req, res) => {
  const {
    callId, ghlContactId, contactType, callEffect, callReason, temperature,
    objections, userId, firstName, lastName, patientName, notes, source,
    treatment, referredBy, gender, birthDate, bookedVisit,
  } = req.body;

  const EFFECT_TO_STAGE = {
    umowiony_w0:         STAGES.UMOWIONY_W0,
    followup:            STAGES.PO_ROZMOWIE,
    brak_decyzji:        STAGES.PO_ROZMOWIE,
    rozwaza:             STAGES.PO_ROZMOWIE,
    nie_odebral:         STAGES.PO_PIERWSZEJ_PROBIE,
    nie_kwalifikuje_sie: STAGES.BEZ_KONTAKTU,
    rezygnacja:          STAGES.BEZ_KONTAKTU,
    nie_pacjent:         null,
  };

  const EFFECT_TO_TAGS = {
    umowiony_w0:         ['umowiony_w0', 'etap_8'],
    followup:            ['followup', 'etap_7'],
    brak_decyzji:        ['brak_decyzji', 'etap_7'],
    nie_odebral:         ['nie_odebral', 'etap_2'],
    nie_kwalifikuje_sie: ['nie_kwalifikuje_sie', 'etap_6'],
    rezygnacja:          ['rezygnacja', 'etap_6'],
    nie_pacjent:         ['nie_pacjent'],
  };

  const isBooked = callEffect === 'umowiony_w0' || bookedVisit === true;

  await supabase.updateCall(callId, {
    contact_type: contactType || null,
    call_effect:  callEffect,
    call_reason:  callReason  || null,
    temperature:  temperature || null,
    objections:   objections  || null,
    user_id:      userId,
    patient_name: patientName || null,
    notes:        notes       || null,
    source:       source      || null,
    treatment:    treatment   || null,
    referred_by:  referredBy  || null,
    gender:       gender      || null,
    birth_date:   birthDate   || null,
    booked_visit: isBooked,
    ghl_logged:   true,
  });

  const callRows = await supabase.query(`calls?call_id=eq.${callId}`, 'GET');
  const callRow  = callRows && callRows.length > 0 ? callRows[0] : null;
  const callerPhone = callRow ? (callRow.caller_phone || '') : '';

  let resolvedContactId = ghlContactId || (callRow ? callRow.ghl_contact_id : null);

  if (!resolvedContactId) {
    try {
      const newContact = { firstName: firstName || 'Nieznany', lastName: lastName || '', locationId: GHL_LOCATION_ID };
      if (callerPhone) newContact.phone = callerPhone;
      const result  = await ghlApi.post('/contacts/', newContact);
      const created = result.data.contact || result.data;
      resolvedContactId = created.id;
      await supabase.updateCall(callId, { ghl_contact_id: resolvedContactId });
    } catch (err) {
      console.error('[GHL] Create contact error:', err.response?.data || err.message);
    }
  } else {
    if (firstName || lastName) {
      try {
        const upd = {};
        if (firstName) upd.firstName = firstName;
        if (lastName)  upd.lastName  = lastName;
        await ghlApi.put(`/contacts/${resolvedContactId}`, upd);
      } catch (err) {
        console.error('[GHL] Update contact error:', err.response?.data || err.message);
      }
    }
  }

  if (resolvedContactId) {
    const targetStage = EFFECT_TO_STAGE[callEffect] ?? null;
    const tags = [...(EFFECT_TO_TAGS[callEffect] || []), 'lead_call'];
    if (treatment) tags.push(`leczenie_${treatment}`);
    if (source)    tags.push(`zrodlo_${source}`);

    // Synchronizacja ródła kontaktu i lekarza polecającego do GHL custom fields
    const { rdoKontaktu, daneOsobyPolecajacej } = req.body;
    if (rdoKontaktu || daneOsobyPolecajacej) {
      try {
        const customFieldUpdates = {};
        if (rdoKontaktu) customFieldUpdates['rdo_kontaktu'] = rdoKontaktu;
        if (daneOsobyPolecajacej) customFieldUpdates['dane_osoby_polecajcej'] = daneOsobyPolecajacej;
        // GHL custom fields update
        const cfPayload = Object.entries(customFieldUpdates).map(([key, value]) => ({ key, field_value: value }));
        await ghlApi.put(`/contacts/${resolvedContactId}`, { customFields: cfPayload });
        console.log(`[GHL] Updated contact custom fields: rdo_kontaktu=${rdoKontaktu}, lekarz=${daneOsobyPolecajacej}`);
      } catch (err) {
        console.error('[GHL] Update custom fields error:', err.response?.data || err.message);
      }
    }

    if (targetStage) {
      const moved = await moveOpportunityToStage(resolvedContactId, targetStage);
      if (!moved) await createOpportunityForContact(resolvedContactId, targetStage, patientName, treatment, source);
    }

    for (const tag of tags) await addTagToContact(resolvedContactId, tag);

    const noteLines = [];
    if (contactType)           noteLines.push(`Typ kontaktu: ${contactType}`);
    if (callEffect)            noteLines.push(`Efekt rozmowy: ${callEffect}`);
    if (req.body.visitDate)    noteLines.push(`Data wizyty: ${req.body.visitDate}`);
    if (req.body.followupWhen) noteLines.push(`Kiedy kontakt: ${req.body.followupWhen}`);
    if (req.body.followupDate) noteLines.push(`Data kontaktu: ${req.body.followupDate}`);
    if (req.body.reasonNeg)    noteLines.push(`Powód: ${req.body.reasonNeg}`);
    if (source)                noteLines.push(`Źródło: ${source}`);
    if (referredBy)            noteLines.push(`Polecony przez: ${referredBy}`);
    if (notes)                 noteLines.push(`Notatki: ${notes}`);
    if (callerPhone)           noteLines.push(`Telefon: ${callerPhone}`);
    if (noteLines.length > 0) {
      await addNoteToContact(
        resolvedContactId,
        `[Navigator Call | ${userId} | ${new Date().toLocaleString('pl-PL')}]\n${noteLines.join('\n')}`
      );
    }
  }

  if (resolvedContactId) {
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || patientName || 'Nieznany';
    const existingIdx = ghlContactsCache.findIndex(c => c.id === resolvedContactId);
    const contactEntry = {
      id: resolvedContactId, name: fullName, firstName: firstName || '',
      lastName: lastName || '', phone: callerPhone || '', email: '',
      tags: [...(EFFECT_TO_TAGS[callEffect] || []), 'lead_call'],
    };
    if (existingIdx >= 0) ghlContactsCache[existingIdx] = { ...ghlContactsCache[existingIdx], ...contactEntry };
    else ghlContactsCache.unshift(contactEntry);
    broadcast({ type: 'CONTACT_UPSERTED', contact: contactEntry });
  }

  // pkt 1: po zapisaniu raportu — zamknij temat i przesuń do Zamkniętych
  await supabase.updateCall(callId, { topic_closed: true, closed_at: new Date().toISOString() });

  broadcast({ type: 'CALL_OUTCOME_SAVED', callId, callEffect, contactType });
  broadcast({ type: 'CALL_TOPIC_CLOSED',  callId });
  res.json({ success: true });
});

// ─── API: Nowe zgłoszenia z GHL (Etap 1) ────────────────────────────────

app.get('/api/leads/new', async (req, res) => {
  const now = Date.now();
  if (ghlLeadsCache && (now - ghlLeadsLastSync < GHL_LEADS_CACHE_TTL)) {
    return res.json({ leads: ghlLeadsCache, cached: true });
  }
  
  try {
    let leads = await getNewLeadsFromGHL();
    // Demo: jeśli GHL zwraca 0 rekordów, pokaż przykładowe zgłoszenia
    if (leads.length === 0 && process.env.DEMO_LEADS !== 'false') {
      const demoNow = new Date();
      leads = [
        { id: 'demo-1', contactId: '', name: 'Anna Kowalska', phone: '+48 600 123 456', email: 'anna@example.com',
          createdAt: new Date(demoNow - 8 * 60000).toISOString(), source: 'Smart Day',
          z_czym_sie_zglasza: 'Problemy z kręgosłupem, szukam rehabilitacji', tags: [] },
        { id: 'demo-2', contactId: '', name: 'Marek Nowak', phone: '+48 501 987 654', email: 'marek@example.com',
          createdAt: new Date(demoNow - 75 * 60000).toISOString(), source: 'Audyt 360',
          z_czym_sie_zglasza: 'Bóle stawów, zainteresowany programem leczenia', tags: [] },
        { id: 'demo-3', contactId: '', name: 'Katarzyna Wiśniewska', phone: '+48 722 345 678', email: 'kasia@example.com',
          createdAt: new Date(demoNow - 145 * 60000).toISOString(), source: 'Smart Day',
          z_czym_sie_zglasza: 'Chce się dowiedzieć więcej o programie EndoEstetica', tags: [] },
      ];
    }
    ghlLeadsCache = leads;
    ghlLeadsLastSync = now;
    res.json({ leads });
  } catch (err) {
    console.error('[API] Get leads error:', err.message);
    res.json({ leads: ghlLeadsCache || [], error: err.message });
  }
});

// ─── API: Usuń zgłoszenie (opportunity) z GHL ─────────────────────────────────
app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await ghlApi.delete(`/opportunities/${id}`);
    // Invalidate cache
    ghlLeadsCache = null;
    ghlLeadsLastSync = 0;
    console.log(`[GHL] Deleted opportunity ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[GHL] Delete opportunity error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

// ─── DIAGNOSTYKA: surowa odpowiedź z GHL ───
app.get('/api/leads/debug', async (req, res) => {
  try {
    let r1 = null, r2 = null, r3 = null, err1 = null, err2 = null, err3 = null;

    // Test 1: search z pipeline_stage_id
    try {
      r1 = await ghlRequest('get', '/opportunities/search', {
        location_id: GHL_LOCATION_ID, pipeline_id: PIPELINE_ID,
        pipeline_stage_id: STAGES.NOWE_ZGLOSZENIE, limit: 5,
      });
    } catch(e) { err1 = e.response?.data || e.message; }

    // Test 2: search bez stage (wszystkie z pipeline)
    try {
      r2 = await ghlRequest('get', '/opportunities/search', {
        location_id: GHL_LOCATION_ID, pipeline_id: PIPELINE_ID, limit: 5,
      });
    } catch(e) { err2 = e.response?.data || e.message; }

    // Test 3: lista wszystkich pipeline
    try {
      r3 = await ghlRequest('get', '/opportunities/pipelines', { locationId: GHL_LOCATION_ID });
    } catch(e) { err3 = e.response?.data || e.message; }

    res.json({
      config: { PIPELINE_ID, STAGE_ID: STAGES.NOWE_ZGLOSZENIE, GHL_LOCATION_ID: GHL_LOCATION_ID ? '✅ ustawione' : '❌ brak' },
      test1_search_with_stage: { result: r1, error: err1 },
      test2_search_all_pipeline: { result: r2, error: err2 },
      test3_pipelines: { result: r3, error: err3 },
    });
  } catch(e) { res.json({ error: e.message }); }
});

// ─── API: Kontakty GHL ────────────────────────────────────────────────────────

app.get('/api/contacts', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ contacts: ghlContactsCache.slice(0, 50) });
  const query = q.toLowerCase();
  const results = ghlContactsCache.filter(c =>
    c.name.toLowerCase().includes(query) || c.phone.includes(query) || (c.email||'').toLowerCase().includes(query)
  ).slice(0, 50);
  res.json({ contacts: results });
});

// ─── API: Dodaj kontakt do GHL ───────────────────────────────────────

app.post('/api/contacts/add', async (req, res) => {
  const { firstName, lastName, phone, email, source, treatment, notes } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Numer telefonu jest wymagany' });
  
  try {
    const contactData = { firstName: firstName || '', lastName: lastName || '', phone, locationId: GHL_LOCATION_ID };
    if (email) contactData.email = email;
    if (source) contactData.source = source;
    
    const result = await ghlApi.post('/contacts/', contactData);
    const contact = result.data.contact || result.data;
    
    const tags = ['lead_manual'];
    if (treatment) tags.push(`leczenie_${treatment}`);
    if (source) tags.push(`zrodlo_${source}`);
    try { await ghlApi.post(`/contacts/${contact.id}/tags`, { tags }); } catch (e) {}
    if (notes) { try { await ghlApi.post(`/contacts/${contact.id}/notes`, { body: notes }); } catch (e) {} }
    
    ghlContactsCache.push({ id: contact.id, name: `${firstName} ${lastName}`.trim(), phone, email: email || '' });
    res.json({ success: true, contactId: contact.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

// ─── API: Żądanie edycji kontaktu (tworzy zadanie dla Soni w GHL) ──────────

app.post('/api/contacts/edit-request', async (req, res) => {
  const { contactId, contactName, changeRequest, requestedBy } = req.body;
  if (!contactId) {
    return res.status(400).json({ success: false, error: 'Brak contactId' });
  }
  const name = contactName || 'Nieznany kontakt';
  const request = changeRequest || `Prośba o weryfikację i aktualizację danych kontaktu: ${name}`;
  const by = requestedBy || 'Recepcja';

  // 1. Utwórz zadanie w GHL przypisane do Soni
  const ghlOk = await createTaskForSonia(contactId, name, request, by);

  // 2. Zapisz zadanie również w Supabase (widoczne w module zadań aplikacji)
  try {
    const dueDate = new Date();
    dueDate.setHours(dueDate.getHours() + 24);
    await supabase.query('tasks', 'POST', {
      title: `Edycja kontaktu: ${name}`,
      body: request,
      contact_id: contactId,
      contact_name: name,
      assigned_to: 'MPfq6I0r42R3P50ZqJ3V', // Sonia
      assigned_name: 'Sonia Czajewicz',
      requested_by: by,
      due_date: dueDate.toISOString(),
      status: 'pending',
      task_type: 'edit_contact',
      created_at: new Date().toISOString(),
    });
    console.log(`[Task] Edit-contact task saved to Supabase for ${name}`);
  } catch(e) {
    console.warn('[Task] Supabase task save failed:', e.message);
  }

  res.json({ success: ghlOk, ghl: ghlOk });
});

// ─── Webhook: GHL — auto-sync kontaktów ─────────────────────────────────────
// pkt 7: gdy kontakt jest edytowany w GHL, aktualizujemy lokalny cache

app.post('/webhook/ghl/contact', async (req, res) => {
  try {
    const body = req.body;
    // GHL wysyła różne formaty — obsługujemy contact.update i contact.create
    const c = body.contact || body;
    if (!c || !c.id) { res.json({ status: 'ignored' }); return; }

    // Tylko kontakty z telefonem
    if (!c.phone) { res.json({ status: 'no_phone' }); return; }

    const contactEntry = {
      id:        c.id,
      name:      (c.contactName || `${c.firstName || ''} ${c.lastName || ''}`).trim(),
      firstName: c.firstName || '',
      lastName:  c.lastName  || '',
      phone:     c.phone     || '',
      email:     c.email     || '',
      tags:      c.tags      || [],
    };

    const idx = ghlContactsCache.findIndex(x => x.id === c.id);
    if (idx >= 0) ghlContactsCache[idx] = { ...ghlContactsCache[idx], ...contactEntry };
    else ghlContactsCache.unshift(contactEntry);

    broadcast({ type: 'CONTACT_UPSERTED', contact: contactEntry });
    console.log(`[GHL Webhook] Contact upserted: ${c.id} ${contactEntry.name}`);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('[GHL Webhook] Error:', e.message);
    res.json({ status: 'error', error: e.message });
  }
});

// ─── API: WebRTC Key ────────────────────────────────────────────────────────

app.get('/api/webrtc/key', async (req, res) => {
  try {
    const sip = req.query.sip || '225340';
    const params = { sip };
    const sign = zadarmaSign('/v1/webrtc/get_key/', params);
    const response = await axios.get('https://api.zadarma.com/v1/webrtc/get_key/', {
      params,
      headers: { 'Authorization': `${ZADARMA_KEY}:${sign}` },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.response?.data?.message || err.message });
  }
});

/// ─── API: Test autoryzacji Zadarma ─────────────────────────────────────────────────────

app.get('/api/call/test-auth', async (req, res) => {
  try {
    // Test: pobierz listę numerów wewnętrznych (nie inicjuje połączenia)
    const params = {};
    const sign = zadarmaSign('/v1/pbx/internal/', params);
    const response = await axios.get('https://api.zadarma.com/v1/pbx/internal/', {
      params,
      headers: { 'Authorization': `${ZADARMA_KEY}:${sign}` },
      timeout: 10000,
    });
    res.json({ ok: true, data: response.data, key: ZADARMA_KEY.slice(0,8) + '...', sign });
  } catch (err) {
    const errData = err.response?.data || err.message;
    res.json({
      ok: false,
      status: err.response?.status,
      error: errData,
      key: ZADARMA_KEY.slice(0,8) + '...',
      hint: err.response?.status === 401 ? 'Błąd autoryzacji — sprawdź ZADARMA_KEY i ZADARMA_SECRET w .env' : ''
    });
  }
});

// ─── API: Click-to-Call ─────────────────────────────────────────────────────

app.post('/api/call/dial', async (req, res) => {
  const { toNumber, fromExt } = req.body;
  const ext = fromExt || '225340';
  const result = await zadarmaClickToCall(ext, toNumber);
  res.json(result);
});

// ─── API: Rozłącz połączenie ─────────────────────────────────────────────────

app.post('/api/call/hangup', async (req, res) => {
  const { callId } = req.body;
  if (!callId) return res.status(400).json({ success: false, error: 'Brak callId' });
  try {
    // Zadarma nie ma dedykowanego endpointu hangup przez API callback
    // Rozłączenie następuje przez zakończenie połączenia po stronie PBX
    // Tutaj oznaczamy połączenie jako zakończone lokalnie
    await supabase.updateCall(callId, {
      status: 'ended',
      ended_at: new Date().toISOString(),
    });
    broadcast({ type: 'CALL_ENDED', callId, status: 'ended', duration: 0 });
    console.log(`[API] Hangup requested for call ${callId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Hangup error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: Potwierdź odebranie połączenia (aktualizacja statusu) ────────────────────
app.post('/api/call/answer', async (req, res) => {
  const { callId } = req.body;
  if (!callId) return res.status(400).json({ success: false, error: 'Brak callId' });
  try {
    await supabase.updateCall(callId, {
      status: 'answered',
      answered_at: new Date().toISOString(),
    });
    broadcast({ type: 'CALL_ANSWERED', callId });
    console.log(`[API] Call answered: ${callId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── API: Nagranie ──────────────────────────────────────────────────────
app.get('/api/call/recording/:callId', async (req, res) => {
  const { callId } = req.params;
  const link = await zadarmaGetRecording(callId);
  if (link) res.json({ success: true, link });
  else res.json({ success: false, link: null });
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
    // Zliczaj nowe połączenia przychodzące bez contact_type
    else if (!t && c.direction !== 'outbound' && !c.call_effect) typeCounts.nowy++;
  });

  const inbound = allCalls.filter(c => c.direction !== 'outbound');
  const answeredInbound = inbound.filter(c => c.status === 'answered');
  const pickupRate = inbound.length > 0 ? Math.round((answeredInbound.length / inbound.length) * 100) : null;

  const missedCalls = inbound.filter(c => c.status === 'no-answer');
  const missedPhones = [...new Set(missedCalls.map(c => c.caller_phone).filter(Boolean))];
  const callbackPhones = new Set(
    allCalls.filter(c => c.direction === 'outbound' && c.status === 'answered').map(c => c.caller_phone).filter(Boolean)
  );
  const answeredPhones = new Set(answeredInbound.map(c => c.caller_phone).filter(Boolean));
  const calledBackCount = missedPhones.filter(phone => callbackPhones.has(phone) || answeredPhones.has(phone)).length;
  const callbackRate = missedPhones.length > 0 ? Math.round((calledBackCount / missedPhones.length) * 100) : null;

  const KPI_PICKUP_SECONDS = 35;
  const KPI_PICKUP_TARGET  = 85;
  const callsWithTiming = answeredInbound.filter(c => c.answered_at && c.created_at);
  const fastPickup = callsWithTiming.filter(c => {
    const waitSec = (new Date(c.answered_at) - new Date(c.created_at)) / 1000;
    return waitSec <= KPI_PICKUP_SECONDS;
  });
  const fastPickupRate = callsWithTiming.length > 0 ? Math.round((fastPickup.length / callsWithTiming.length) * 100) : null;

  // pkt 10: czas odebrania per połączenie
  const pickupTimes = callsWithTiming.map(c => ({
    callId: c.call_id,
    waitSeconds: Math.round((new Date(c.answered_at) - new Date(c.created_at)) / 1000),
  }));
  const avgPickupSeconds = callsWithTiming.length > 0
    ? Math.round(callsWithTiming.reduce((sum, c) => sum + (new Date(c.answered_at) - new Date(c.created_at)) / 1000, 0) / callsWithTiming.length)
    : null;

  const totals = {
    total:    allCalls.length,
    answered: answeredInbound.length,
    missed:   missedCalls.length,
    booked:   allCalls.filter(c => c.call_effect === 'umowiony_w0').length,
    followup: allCalls.filter(c => c.call_effect === 'followup' || c.call_effect === 'brak_decyzji').length,
  };

  const kpi = {
    pickupRate:     { value: pickupRate,     label: 'Odbieralność',          unit: '%', target: 90,  higher_is_better: true },
    callbackRate:   { value: callbackRate,   label: 'Oddzwanialność',        unit: '%', target: 90,  higher_is_better: true },
    fastPickupRate: { value: fastPickupRate, label: 'Odebrane ≤35s',         unit: '%', target: KPI_PICKUP_TARGET, higher_is_better: true },
    missedUnique:   { value: missedPhones.length, label: 'Unikalne nieodebrane', unit: '', target: null },
    calledBack:     { value: calledBackCount,     label: 'Oddzwoniono',          unit: '', target: null },
    avgPickupSeconds: { value: avgPickupSeconds,  label: 'Śr. czas odebrania',   unit: 's', target: 35, higher_is_better: false },
  };

  // pkt 11: panel coachingowy — wskazówki dla recepcjonistki
  const coaching = buildCoachingTips({ totals, kpi, allCalls, answeredInbound, missedCalls, callsWithTiming, fastPickup });

  // effectCounts — globalne zliczenie efektów
  const effectCounts = {};
  allCalls.forEach(c => {
    const eff = c.call_effect;
    if (eff) effectCounts[eff] = (effectCounts[eff] || 0) + 1;
  });

  // followup per user
  Object.keys(perUser).forEach(uid => {
    perUser[uid].followup = (perUser[uid].effects['followup'] || 0) + (perUser[uid].effects['brak_decyzji'] || 0);
    perUser[uid].role = users[uid]?.role || 'reception';
  });

  res.json({ totals, perUser, typeCounts, kpi, coaching, effectCounts });
});

// pkt 11: Generuj wskazówki coachingowe
function buildCoachingTips({ totals, kpi, allCalls, answeredInbound, missedCalls, callsWithTiming, fastPickup }) {
  const tips = [];

  // Odbieralność
  if (kpi.pickupRate.value !== null && kpi.pickupRate.value < 90) {
    tips.push({
      icon: '📞',
      title: 'Odbieralność poniżej celu',
      desc: `Odbierasz ${kpi.pickupRate.value}% połączeń (cel: 90%). Staraj się odbierać każde połączenie w ciągu 35 sekund.`,
      priority: 'high',
    });
  }

  // Czas odebrania
  if (kpi.fastPickupRate.value !== null && kpi.fastPickupRate.value < 85) {
    tips.push({
      icon: '⏱️',
      title: 'Szybkość odbierania',
      desc: `Tylko ${kpi.fastPickupRate.value}% połączeń odebrano w ciągu 35s (cel: 85%). Miej telefon zawsze w zasięgu.`,
      priority: 'medium',
    });
  }

  // Oddzwanialność
  if (kpi.callbackRate.value !== null && kpi.callbackRate.value < 90) {
    const missed = kpi.missedUnique.value || 0;
    const called = kpi.calledBack.value || 0;
    tips.push({
      icon: '🔄',
      title: 'Oddzwaniaj do nieodebranych',
      desc: `Oddzwoniono do ${called} z ${missed} unikalnych numerów (${kpi.callbackRate.value}%). Każdy nieodebrany to potencjalny pacjent!`,
      priority: 'high',
    });
  }

  // Konwersja
  if (totals.answered > 0) {
    const convRate = Math.round((totals.booked / totals.answered) * 100);
    if (convRate < 30) {
      tips.push({
        icon: '🎯',
        title: 'Konwersja na wizyty',
        desc: `Konwersja wynosi ${convRate}% (${totals.booked} wizyt z ${totals.answered} rozmów). Pracuj nad technikami umawiania.`,
        priority: 'medium',
      });
    } else {
      tips.push({
        icon: '✅',
        title: 'Dobra konwersja!',
        desc: `Świetna robota! Konwersja wynosi ${convRate}% — ${totals.booked} wizyt z ${totals.answered} rozmów.`,
        priority: 'positive',
      });
    }
  }

  // Follow-up
  if (totals.followup > 0) {
    tips.push({
      icon: '🔔',
      title: 'Masz follow-upy do wykonania',
      desc: `${totals.followup} rozmów czeka na ponowny kontakt. Nie zapomnij oddzwonić!`,
      priority: 'medium',
    });
  }

  // Brak danych
  if (totals.total === 0) {
    tips.push({
      icon: '👋',
      title: 'Dzień dopiero się zaczyna',
      desc: 'Brak rozmów dziś. Gdy pojawią się połączenia, tutaj zobaczysz wskazówki jak pracować lepiej.',
      priority: 'info',
    });
  }

  return tips;
}

// ─── API: Tasks (full — lista + pula) ─────────────────────────────────────
// GHL user ID dla Soni — zadania z jej konta
const SONIA_GHL_USER_ID = 'MPfq6I0r42R3P50ZqJ3V';

app.get('/api/tasks', async (req, res) => {
  try {
    const assignedTo = req.query.assignedTo || '';
    const today = new Date();
    const startDate = new Date(today);
    startDate.setHours(0,0,0,0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30); // następne 30 dni

    // Pobierz zadania z GHL dla lokalizacji
    const ghlRes = await ghlApi.get(`/locations/${GHL_LOCATION_ID}/tasks`, {
      params: {
        limit: 100,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }
    }).catch(() => null);

    const rawTasks = ghlRes?.data?.tasks || [];

    const mapTask = (t) => ({
      id: t.id,
      title: t.title || t.body || 'Zadanie',
      body: t.body || '',
      dueDate: t.dueDate || null,
      contactId: t.contactId || '',
      contactName: t.contact?.name || t.contactName || '',
      contactPhone: t.contact?.phone || '',
      assignedToId: t.assignedTo || '',
      assignedToName: t.assignedToName || '',
      completed: t.completed || false,
      overdue: t.dueDate && new Date(t.dueDate) < new Date(),
    });

    // Pula recepcji — zadania bez assignee lub przypisane do wirtualnego konta recepcji
    const pool = rawTasks
      .filter(t => !t.assignedTo || t.assignedTo === 'pool')
      .map(mapTask);

    // Zadania przypisane
    let tasks = rawTasks
      .filter(t => t.assignedTo && t.assignedTo !== 'pool')
      .map(mapTask);

    if (assignedTo) {
      tasks = tasks.filter(t => t.assignedToName === assignedTo || t.assignedToId === assignedTo);
    }

    res.json({ tasks, pool });
  } catch(e) {
    console.error('[Tasks]', e.message);
    res.json({ tasks: [], pool: [] });
  }
});

// ─── API: Tasks today (legacy alias) ────────────────────────────────────────
app.get('/api/tasks/today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    // Pobierz zadania z GHL dla lokalizacji
    const ghlRes = await ghlApi.get(`/locations/${GHL_LOCATION_ID}/tasks`, {
      params: { limit: 50, startDate: today, endDate: tomorrow }
    }).catch(() => null);
    const tasks = ghlRes?.data?.tasks || [];
    const mapped = tasks.map(t => ({
      id: t.id,
      title: t.title || t.body || 'Zadanie',
      body: t.body || '',
      dueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString('pl-PL') : '',
      contactName: t.contact?.name || '',
      assignedTo: t.assignedTo || '',
      overdue: t.dueDate && new Date(t.dueDate) < new Date(),
    }));
    res.json({ tasks: mapped });
  } catch(e) {
    console.error('[Tasks]', e.message);
    res.json({ tasks: [] });
  }
});

// ─── API: Update contact (admin) ─────────────────────────────────────────────
app.post('/api/contacts/update', async (req, res) => {
  const { contactId, firstName, lastName, phone, email, notes } = req.body;
  if (!contactId) return res.status(400).json({ success: false, error: 'Brak contactId' });
  try {
    const body = {};
    if (firstName !== undefined) body.firstName = firstName;
    if (lastName  !== undefined) body.lastName  = lastName;
    if (phone     !== undefined) body.phone      = phone;
    if (email     !== undefined) body.email      = email;
    if (notes     !== undefined) body.customFields = [{ key: 'notes', field_value: notes }];
    await ghlApi.put(`/contacts/${contactId}`, body);
    // Update local cache
    const idx = ghlContactsCache.findIndex(x => x.id === contactId);
    if (idx >= 0) {
      const name = [firstName, lastName].filter(Boolean).join(' ') || ghlContactsCache[idx].name;
      ghlContactsCache[idx] = { ...ghlContactsCache[idx], firstName, lastName, phone, email, name };
    }
    console.log(`[Admin] Contact updated: ${contactId}`);
    res.json({ success: true });
  } catch(e) {
    console.error('[Admin] Contact update error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Tasks — create ────────────────────────────────────────────────────

app.post('/api/tasks/create', async (req, res) => {
  const { contactId, title, dueDate, taskType, assignedTo, createdBy } = req.body;
  if (!title) return res.status(400).json({ success: false, error: 'Brak tytułu zadania' });
  try {
    const taskBody = {
      title,
      body: title,
      dueDate: dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 86400000).toISOString(),
      completed: false,
    };
    // Przypisz do użytkownika jeśli podano
    if (assignedTo && assignedTo !== '') {
      // Mapowanie ID użytkownika GHL
      const userMap = {
        aneta: '',
        agata_o: '',
        sonia: 'MPfq6I0r42R3P50ZqJ3V',
      };
      const ghlUserId = userMap[assignedTo];
      if (ghlUserId) taskBody.assignedTo = ghlUserId;
    }
    let result;
    if (contactId) {
      result = await ghlApi.post(`/contacts/${contactId}/tasks`, taskBody);
    } else {
      // Zadanie bez kontaktu — przypisz do lokalizacji
      result = await ghlApi.post(`/locations/${GHL_LOCATION_ID}/tasks`, taskBody);
    }
    console.log(`[Tasks] Created task: ${title} by ${createdBy}`);
    res.json({ success: true, task: result.data });
  } catch(e) {
    console.error('[Tasks] Create error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Tasks — complete ───────────────────────────────────────────────────

app.post('/api/tasks/complete', async (req, res) => {
  const { taskId, contactId, completed, completedBy } = req.body;
  if (!taskId || !contactId) return res.status(400).json({ success: false, error: 'Brak taskId lub contactId' });
  try {
    await ghlApi.put(`/contacts/${contactId}/tasks/${taskId}/completed`, { completed: !!completed });
    // Dodaj notatkę w GHL
    if (completed) {
      const note = `Wykonane przez: ${completedBy || 'Nieznany'} — ${new Date().toLocaleString('pl-PL')}`;
      await ghlApi.post(`/contacts/${contactId}/notes`, { body: note }).catch(() => {});
    }
    res.json({ success: true });
  } catch(e) {
    console.error('[Tasks] Complete error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Tasks — claim (przejęcie z puli recepcji) ──────────────────────────

app.post('/api/tasks/claim', async (req, res) => {
  const { taskId, contactId, userId, userName } = req.body;
  if (!taskId || !contactId) return res.status(400).json({ success: false, error: 'Brak taskId lub contactId' });
  try {
    await ghlApi.put(`/contacts/${contactId}/tasks/${taskId}`, { assignedTo: userId });
    // Dodaj notatkę
    const note = `Zadanie przejęte przez: ${userName || 'Nieznany'} — ${new Date().toLocaleString('pl-PL')}`;
    await ghlApi.post(`/contacts/${contactId}/notes`, { body: note }).catch(() => {});
    res.json({ success: true });
  } catch(e) {
    console.error('[Tasks] Claim error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Tasks — update (zmiana terminu/tytułu) ─────────────────────────────

app.post('/api/tasks/update', async (req, res) => {
  const { taskId, contactId, title, dueDate, updatedBy } = req.body;
  if (!taskId || !contactId) return res.status(400).json({ success: false, error: 'Brak taskId lub contactId' });
  try {
    const body = {};
    if (title) body.title = title;
    if (dueDate) body.dueDate = new Date(dueDate).toISOString();
    await ghlApi.put(`/contacts/${contactId}/tasks/${taskId}`, body);
    res.json({ success: true });
  } catch(e) {
    console.error('[Tasks] Update error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Report — save ──────────────────────────────────────────────────────

app.post('/api/report/save', async (req, res) => {
  const {
    callId, contactId, phone,
    status, effect, visitAction, referral, referralPerson,
    program, channel, w0Date, followupDate, followupNote,
    rezygnacjaReason, niekwalReason,
    visitChangeReason, visitNewDate, visitCancelReason,
    notes, savedBy
  } = req.body;

  try {
    // 1. Zaktualizuj call w Supabase
    const callUpdates = {
      contact_type: status,
      call_effect: effect || visitAction || status,
      notes: notes || '',
      topic_closed: true,
      closed_at: new Date().toISOString(),
      user_id: savedBy,
    };
    if (w0Date) callUpdates.booked_visit = true;
    await supabase.updateCall(callId, callUpdates);

    // 2. Zaktualizuj kontakt w GHL
    if (contactId) {
      const customFields = [];
      if (channel) customFields.push({ key: 'preferowany_kana_informacyjne', field_value: channel });
      if (referral) customFields.push({ key: 'typ_polecenia', field_value: referral });
      if (referralPerson) customFields.push({ key: 'dane_osoby_polecajcej', field_value: referralPerson });
      if (program) customFields.push({ key: 'dedykowany_program_leczenia', field_value: program });
      if (niekwalReason) customFields.push({ key: 'powd_rezygnacji__niekwalifikacji', field_value: niekwalReason });
      if (rezygnacjaReason) customFields.push({ key: 'powd_rezygnacji__niekwalifikacji', field_value: rezygnacjaReason });
      if (visitChangeReason) customFields.push({ key: 'powd_zmiany__odwoania', field_value: visitChangeReason });
      if (visitNewDate) customFields.push({ key: 'nowy_termin_wizyty', field_value: visitNewDate });
      if (w0Date) customFields.push({ key: 'data_w0', field_value: w0Date });

      if (customFields.length > 0) {
        await ghlApi.put(`/contacts/${contactId}`, { customFields }).catch(e =>
          console.warn('[Report] GHL custom fields update failed:', e.message)
        );
      }

      // 3. Utwórz zadanie follow-up jeśli potrzeba
      if (effect === 'followup' && followupDate) {
        const taskTitle = followupNote || `Follow-up: ${phone}`;
        await ghlApi.post(`/contacts/${contactId}/tasks`, {
          title: taskTitle,
          body: taskTitle,
          dueDate: new Date(followupDate).toISOString(),
          completed: false,
        }).catch(e => console.warn('[Report] Follow-up task creation failed:', e.message));
      }

      // 4. Dodaj notatkę w GHL
      const noteLines = [`Raport rozmowy — ${savedBy} — ${new Date().toLocaleString('pl-PL')}`,
        `Status: ${status}`, effect ? `Efekt: ${effect}` : '', notes ? `Notatka: ${notes}` : ''
      ].filter(Boolean);
      await ghlApi.post(`/contacts/${contactId}/notes`, { body: noteLines.join('\n') }).catch(() => {});
    }

    broadcast({ type: 'CALL_ENDED', callId, status: 'closed', duration: 0 });
    res.json({ success: true });
  } catch(e) {
    console.error('[Report] Save error:', e.response?.data || e.message);
    res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
  }
});

// ─── API: Call — initiate (outbound) ─────────────────────────────────────────

app.post('/api/call/initiate', async (req, res) => {
  const { phone, ext, userId } = req.body;
  if (!phone || !ext) return res.status(400).json({ success: false, error: 'Brak numeru lub ext' });
  try {
    // Używamy zadarmaClickToCall (GET /v1/request/callback/)
    const zadarmaRes = await zadarmaClickToCall(ext, phone);
    if (!zadarmaRes || zadarmaRes.status === 'error') {
      const errMsg = zadarmaRes?.message || 'Zadarma error';
      console.error(`[Zadarma] Click-to-call failed: ${errMsg}`);
      return res.status(500).json({ success: false, error: errMsg });
    }
    console.log(`[Zadarma] Outbound call initiated: ext ${ext} -> ${phone}`, zadarmaRes);
    // Zapisz połączenie wychodzace w Supabase (jako outbound/ringing)
    const tempCallId = `out_${Date.now()}_${ext}`;
    const user = Object.values(users).find(u => u.ext === ext);
    const callData = {
      call_id: tempCallId,
      pbx_call_id: null,
      caller_phone: ext,
      called_phone: phone,
      direction: 'outbound',
      status: 'ringing',
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      ghl_logged: false,
      ghl_contact_id: null,
      patient_name: null,
      z_czym_sie_zglasza: '',
      topic_closed: false,
      contact_attempts: 0,
      initiated_by: userId || (user ? user.id : null),
    };
    // Wyszukaj kontakt GHL po numerze
    try {
      const ghlContact = await getGHLContactByPhone(phone);
      if (ghlContact) {
        callData.ghl_contact_id = ghlContact.id;
        callData.patient_name = ghlContact.name;
      }
    } catch(e) { console.warn('[GHL] Contact lookup failed:', e.message); }
    await supabase.insertCall(callData);
    broadcast({ type: 'CALL_RINGING', call: callData });
    res.json({ success: true, data: zadarmaRes, tempCallId });
  } catch(e) {
    console.error('[Zadarma] Call initiate error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
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

app.get('/webhook/zadarma', (req, res) => {
  if (req.query.zd_echo) return res.send(req.query.zd_echo);
  res.json({ status: 'ok' });
});

app.post('/webhook/zadarma', async (req, res) => {
  const { event, call_id, pbx_call_id, caller_id, called_did, seconds, sign, internal, disposition } = req.body;
  
  console.log('[Zadarma] Webhook received:', JSON.stringify(req.body));
  
  // Dla NOTIFY_START (inbound) generujemy unikalny callId oparty na timestamp
  // aby uniknąć konfliktu UNIQUE na call_id w Supabase.
  // pbx_call_id jest współdzielony między NOTIFY_START, NOTIFY_ANSWER, NOTIFY_END —
  // dlatego używamy go do UPDATE (nie INSERT).
  let callId;
  if (event === 'NOTIFY_START' || event === 'NOTIFY_OUT_START') {
    // Nowe połączenie — unikalny ID
    callId = pbx_call_id
      ? `${pbx_call_id}`  // Zadarma daje unikalny pbx_call_id per połączenie
      : `call_${caller_id || 'unk'}_${Date.now()}`;
  } else {
    // NOTIFY_ANSWER, NOTIFY_END — szukamy po pbx_call_id lub call_id
    callId = pbx_call_id || call_id || `call_${Date.now()}`;
  }
  console.log(`[Zadarma] Event: ${event}, CallID: ${callId}, From: ${caller_id}, To: ${called_did}`);
  
  // NOTIFY_OUT_START — połączenie wychodzace zainicjowane przez PBX
  if (event === 'NOTIFY_OUT_START') {
    const ghlContact = await getGHLContactByPhone(called_did);
    const callData = {
      call_id: callId,
      pbx_call_id: pbx_call_id || null,
      caller_phone: caller_id || internal,
      called_phone: called_did,
      direction: 'outbound',
      status: 'ringing',
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      ghl_logged: false,
      ghl_contact_id: ghlContact ? ghlContact.id : null,
      patient_name: ghlContact ? ghlContact.name : null,
      z_czym_sie_zglasza: '',
      topic_closed: false,
      contact_attempts: 0,
    };
    // Spróbuj zaktualizować istniejący rekord (z tempCallId) lub utwórz nowy
    const existing = await supabase.query(`calls?direction=eq.outbound&status=eq.ringing&called_phone=eq.${encodeURIComponent(called_did)}`, 'GET');
    if (existing && existing.length > 0) {
      await supabase.updateCall(existing[0].call_id, { pbx_call_id: pbx_call_id || callId, status: 'ringing' });
      broadcast({ type: 'CALL_RINGING', call: { ...existing[0], pbx_call_id, status: 'ringing', direction: 'outbound' } });
    } else {
      await supabase.insertCall(callData);
      broadcast({ type: 'CALL_RINGING', call: callData });
    }
  } else if (event === 'NOTIFY_START') {
    const ghlContact = await getGHLContactByPhone(caller_id);
    
    // Pobierz pole z_czym_si_zgasza z GHL jeśli znamy kontakt
    let zCzymSieZglasza = '';
    if (ghlContact && ghlContact.id) {
      try {
        const contactRes = await ghlApi.get(`/contacts/${ghlContact.id}`);
        const contactData = contactRes.data.contact || contactRes.data;
        const customFields = contactData.customFields || contactData.customField || [];
        const field = customFields.find(f =>
          f.key === 'z_czym_si_zgasza' ||
          f.fieldKey === 'z_czym_si_zgasza' ||
          (f.name || '').toLowerCase().includes('z czym') ||
          (f.name || '').toLowerCase().includes('zgłasza')
        );
        if (field) zCzymSieZglasza = field.value || field.fieldValue || '';
      } catch (e) {
        console.warn('[GHL] Could not fetch z_czym_si_zgasza:', e.message);
      }
    }
    
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
      z_czym_sie_zglasza: zCzymSieZglasza,
      topic_closed: false,
      contact_attempts: 0,
    };
    
    const insertResult = await supabase.insertCall(callData);
    if (!insertResult) {
      console.error(`[Zadarma] NOTIFY_START: insertCall FAILED for callId=${callId}, caller=${caller_id}`);
    } else {
      console.log(`[Zadarma] NOTIFY_START: call saved, callId=${callId}, contact=${ghlContact?.name || 'unknown'}`);
    }
    broadcast({ type: 'CALL_RINGING', call: callData });

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
    
    if (wasAnswered && pbx_call_id) {
      // Używamy systemu retry zamiast jednorazowego setTimeout
      scheduleRecordingFetch(callId, pbx_call_id, 0);
    }
    
    if (status === 'no-answer') {
      const existing = await supabase.query(`calls?call_id=eq.${callId}`, 'GET');
      if (existing && existing.length > 0) {
        const attempts = (existing[0].contact_attempts || 0) + 1;
        updates.contact_attempts = attempts;
        if (attempts >= 2 && existing[0].ghl_contact_id) {
          await addTagToContact(existing[0].ghl_contact_id, '2_nieudane_proby');
        }
      }
    }
    
    await supabase.updateCall(callId, updates);
    broadcast({ type: 'CALL_ENDED', callId, status, duration });
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
  ws.send(JSON.stringify({ type: 'INIT', calls: openCalls }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'CHAT_MESSAGE') {
        // Broadcast to all connected clients
        broadcast({ type: 'CHAT_MESSAGE', text: msg.text, from: msg.from || 'Użytkownik', userId: msg.userId || '' });
        // Send email notification to Sonia
        const nodemailer = require('nodemailer');
        const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
        const smtpPort = parseInt(process.env.SMTP_PORT || '587');
        const smtpUser = process.env.SMTP_USER || process.env.EMAIL_FROM || '';
        const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
        if (smtpUser && smtpPass) {
          try {
            const transporter = nodemailer.createTransport({
              host: smtpHost, port: smtpPort, secure: smtpPort === 465,
              auth: { user: smtpUser, pass: smtpPass }
            });
            await transporter.sendMail({
              from: smtpUser,
              to: 'endoestetica.clinic@gmail.com, sonia.czajewicz.endoestetica@gmail.com',
              subject: `[Navigator Hub] Wiadomość od ${msg.from || 'Użytkownik'}`,
              text: `Wiadomość od ${msg.from || 'Użytkownik'}:\n\n${msg.text}\n\n---\nNavigator Hub`
            });
          } catch(emailErr) { console.error('[Chat email]', emailErr.message); }
        }
      }
    } catch(e) { /* ignore parse errors */ }
  });
});

// ─── Startup ────────────────────────────────────────────────────────────────

async function startup() {
  await syncGHLContacts();
  setInterval(syncGHLContacts, GHL_SYNC_INTERVAL);
  
  server.listen(PORT, () => {
    console.log(`🚀 Navigator Call v7 running on port ${PORT}`);
    console.log(`📞 WebSocket: ws://localhost:${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log(`📋 GHL Contacts: ${ghlContactsCache.length}`);
  });
}

startup();
