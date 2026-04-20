/* ============================================================
   Navigator Call v6 — EndoEstetica
   Frontend Application Logic — Enhanced Edition
   ============================================================ */

// ==================== GLOBAL STATE ====================
let currentView = 'dashboard';
let currentTab = 'new-leads';
let currentContact = null;
let currentOpportunity = null;
let selectedStatus = null;
let selectedOutcome = null;
let callTimerInterval = null;
let callStartTime = null;
let wsConnection = null;
let allContacts = [];
let allLeads = [];
let allCalls = [];
let todayTasks = [];
let inProgressCalls = [];
let completedCalls = [];
let currentUserRole = 'reception'; // 'reception' | 'admin'
let activeCallId = null;
let pollingInterval = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 1000);
  connectWebSocket();
  loadNewLeads();
  loadTodayTasks();
  loadContacts();
  renderCharts();
  startPolling();

  // Wykryj rolę z localStorage (jeśli jest)
  const savedRole = localStorage.getItem('nav_role');
  if (savedRole) setUserRole(savedRole);
});

function updateClock() {
  const now = new Date();
  const el = document.getElementById('currentTime');
  if (el) el.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setUserRole(role) {
  currentUserRole = role;
  localStorage.setItem('nav_role', role);
  // Pokaż/ukryj elementy admin-only
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  // Etykiety przycisków edycji
  document.querySelectorAll('.edit-request-btn').forEach(btn => {
    btn.textContent = role === 'admin' ? '✏️ Edytuj' : '✏️ Prośba o edycję';
  });
}

// ==================== POLLING FALLBACK (C4) ====================
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    if (currentView === 'calls') loadCalls();
    if (currentView === 'dashboard') loadNewLeads();
  }, 30000);
}

// ==================== WEBSOCKET (C4) ====================
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      setWsStatus(true);
      showToast('Połączono z serwerem', 'success');
      // Szybszy polling gdy WS działa
      startPolling();
    };

    wsConnection.onclose = () => {
      setWsStatus(false);
      // Szybszy polling gdy WS rozłączony
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = setInterval(() => {
        if (currentView === 'calls') loadCalls();
        if (currentView === 'dashboard') loadNewLeads();
      }, 10000);
      setTimeout(connectWebSocket, 5000);
    };

    wsConnection.onerror = () => setWsStatus(false);

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (e) { console.error('WS parse error:', e); }
    };
  } catch (e) { setWsStatus(false); }
}

function setWsStatus(online) {
  const dot = document.getElementById('wsStatus');
  const text = document.getElementById('wsStatusText');
  if (dot) dot.className = `status-dot ${online ? 'online' : 'offline'}`;
  if (text) text.textContent = online ? 'Połączono' : 'Rozłączono';
}

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'CALLS_HISTORY':
      allCalls = data.calls || [];
      if (currentView === 'calls') renderCallsTable(allCalls);
      break;
    case 'CALL_RINGING':
      handleCallRinging(data);
      break;
    case 'CALL_ANSWERED':
      handleCallAnswered(data);
      break;
    case 'CALL_ENDED':
      handleCallEnded(data);
      break;
    case 'CALL_RECORDING_READY':
      handleRecordingReady(data);
      break;
    case 'task_created':
      showToast('Nowe zadanie zostało utworzone', 'success');
      loadTodayTasks();
      break;
    case 'edit_request_created':
      showToast('✅ Zadanie dla Soni utworzone w GHL', 'success');
      break;
    case 'opportunity_updated':
      showToast('Raport zapisany w GHL', 'success');
      break;
    case 'opportunity_deleted':
      // Usuń z listy zgłoszeń
      allLeads = allLeads.filter(l => l.id !== data.id);
      renderLeadsList(allLeads);
      break;
    case 'CHAT_MESSAGE':
      appendChatMessage(data.from, data.text, data.ts, false);
      break;
  }
}

// ==================== CALL EVENTS ====================
function handleCallRinging(data) {
  // Dodaj do store
  const existing = allCalls.findIndex(c => c.callId === data.callId);
  if (existing >= 0) allCalls[existing] = { ...allCalls[existing], ...data };
  else allCalls.unshift(data);

  if (currentView === 'calls') renderCallsTable(allCalls);

  // Otwórz popup dla połączeń przychodzących
  if (data.direction === 'inbound') {
    openCallPopup({
      id: data.contactId || 'unknown',
      name: data.contactName || data.from || 'Nieznany',
      phone: data.from,
      callId: data.callId,
      direction: 'inbound'
    });
  } else {
    // Wychodzące — otwórz popup bez dzwonienia
    openCallPopup({
      id: data.contactId || 'unknown',
      name: data.contactName || data.to || 'Nieznany',
      phone: data.to,
      callId: data.callId,
      direction: 'outbound'
    });
  }
  activeCallId = data.callId;
}

function handleCallAnswered(data) {
  // Aktualizuj store
  const idx = allCalls.findIndex(c => c.callId === data.callId);
  if (idx >= 0) allCalls[idx] = { ...allCalls[idx], status: 'active', tag: 'connected' };
  if (currentView === 'calls') renderCallsTable(allCalls);
  // Zaktualizuj tag w popupie
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl) { tagEl.textContent = 'POŁĄCZONO'; tagEl.className = 'call-tag tag-connected'; tagEl.style.display = 'inline-block'; }
}

function handleCallEnded(data) {
  const idx = allCalls.findIndex(c => c.callId === data.callId);
  if (idx >= 0) allCalls[idx] = { ...allCalls[idx], status: 'ended', tag: data.tag, duration: data.duration };
  if (currentView === 'calls') renderCallsTable(allCalls);

  // Jeśli popup jest otwarty dla tego połączenia
  if (activeCallId === data.callId) {
    if (data.tag === 'missed' || data.tag === 'ineffective') {
      // Nieodebrane — zamknij popup automatycznie (C6)
      closeCallPopup();
    }
    // Zaktualizuj tag
    const tagEl = document.getElementById('popupCallTag');
    if (tagEl) {
      const labels = { connected: 'POŁĄCZONO', missed: 'NIEODEBRANE', ineffective: 'NIESKUTECZNE' };
      const classes = { connected: 'tag-connected', missed: 'tag-missed', ineffective: 'tag-ineffective' };
      tagEl.textContent = labels[data.tag] || data.tag;
      tagEl.className = `call-tag ${classes[data.tag] || ''}`;
      tagEl.style.display = 'inline-block';
    }
  }
  // Odśwież KPI
  updateMissedKPI();
}

function handleRecordingReady(data) {
  // Zaktualizuj store
  const idx = allCalls.findIndex(c => c.callId === data.callId);
  if (idx >= 0) allCalls[idx].recordingUrl = data.recordingUrl;
  // Odśwież widok połączeń (D3)
  if (currentView === 'calls') renderCallsTable(allCalls);
  showToast('🎙️ Nagranie połączenia gotowe', 'success');
}

function updateMissedKPI() {
  const today = allCalls.filter(c => {
    const d = new Date(c.timestamp);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const missed = today.filter(c => c.tag === 'missed').length;
  const kpiEl = document.getElementById('kpi-missed');
  if (kpiEl) kpiEl.textContent = missed;
}

// ==================== VIEW SWITCHING ====================
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.add('active');

  const menuEl = document.querySelector(`[data-view="${view}"]`);
  if (menuEl) menuEl.classList.add('active');

  currentView = view;

  if (view === 'contacts') loadContacts();
  if (view === 'calls') loadCalls();
  if (view === 'stats') loadAndRenderStats();
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const tabBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (tabBtn) tabBtn.classList.add('active');

  const tabContent = document.getElementById(`tab-${tab}`);
  if (tabContent) tabContent.classList.add('active');

  currentTab = tab;

  if (tab === 'in-progress') loadInProgress();
  if (tab === 'completed') loadCompletedCalls();
}

// ==================== LEADS — BLOK B ====================
async function loadNewLeads() {
  const listEl = document.getElementById('newLeadsList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Ładowanie zgłoszeń...</p></div>';

  try {
    const response = await fetch('/api/opportunities/new');
    const data = await response.json();
    const opportunities = data.opportunities || [];

    if (opportunities.length === 0) {
      showDemoLeads(listEl);
      return;
    }

    allLeads = opportunities.map(opp => ({
      id: opp.id,
      contactId: opp.contactId,
      name: `${opp.contact?.firstName || ''} ${opp.contact?.lastName || ''}`.trim() || opp.name || 'Nieznany',
      phone: opp.contact?.phone || opp.phone || '',
      email: opp.contact?.email || opp.email || '',
      tags: opp.contact?.tags || [],
      source: opp.source || opp.leadSource || '',
      zglosza: opp.contact?.z_czym_si_zgasza || opp.z_czym_si_zgasza || '',
      createdAt: opp.createdAt || new Date().toISOString(),
      oppId: opp.id
    }));

    document.getElementById('badge-new').textContent = allLeads.length;
    document.getElementById('kpi-new').textContent = allLeads.length;
    renderLeadsList(allLeads);

  } catch (err) {
    console.error('Load leads error:', err);
    showDemoLeads(listEl);
  }
}

function showDemoLeads(listEl) {
  allLeads = [
    { id: 'demo1', contactId: 'demo1', name: 'Anna Kowalska', phone: '+48 501 234 567', email: 'anna.k@example.com',
      zglosza: 'Ból zęba trzonowego, szukam implantów', tags: ['Smart Day'], source: 'Smart Day',
      createdAt: new Date(Date.now() - 8 * 60000).toISOString() },
    { id: 'demo2', contactId: 'demo2', name: 'Marek Nowak', phone: '+48 602 345 678', email: 'marek.n@example.com',
      zglosza: 'Interesuje mnie wybielanie zębów', tags: ['Audyt 360'], source: 'Audyt 360',
      createdAt: new Date(Date.now() - 95 * 60000).toISOString() },
    { id: 'demo3', contactId: 'demo3', name: 'Katarzyna Wiśniewska', phone: '+48 703 456 789', email: 'kasia.w@example.com',
      zglosza: 'Chcę zrobić licówki porcelanowe', tags: [], source: '',
      createdAt: new Date(Date.now() - 145 * 60000).toISOString() }
  ];
  document.getElementById('badge-new').textContent = allLeads.length;
  document.getElementById('kpi-new').textContent = allLeads.length;
  renderLeadsList(allLeads);
}

function renderLeadsList(leads) {
  const listEl = document.getElementById('newLeadsList');
  if (!listEl) return;

  // Filtrowanie po tagach
  const activeFilter = document.querySelector('.source-filter-btn.active')?.dataset?.source || 'all';
  const filtered = activeFilter === 'all' ? leads : leads.filter(l =>
    (l.tags || []).some(t => t.toLowerCase().includes(activeFilter.toLowerCase())) ||
    (l.source || '').toLowerCase().includes(activeFilter.toLowerCase())
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak zgłoszeń dla wybranego filtra</div>';
    return;
  }

  // Zbierz unikalne tagi/źródła do filtrów (B4)
  const allSources = [...new Set(leads.flatMap(l => [...(l.tags || []), l.source].filter(Boolean)))];
  renderSourceFilters(allSources);

  listEl.innerHTML = '';
  filtered.forEach(lead => {
    const card = createLeadCard(lead);
    listEl.appendChild(card);
  });
}

function renderSourceFilters(sources) {
  const container = document.getElementById('sourceFilters');
  if (!container) return;

  const activeFilter = document.querySelector('.source-filter-btn.active')?.dataset?.source || 'all';
  container.innerHTML = `
    <button class="source-filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-source="all" onclick="filterBySource('all')">Wszystkie</button>
    ${sources.map(s => `
      <button class="source-filter-btn ${activeFilter === s ? 'active' : ''}" data-source="${s}" onclick="filterBySource('${s}')">
        <span class="source-tag-dot ${getSourceClass(s)}"></span>${s}
      </button>
    `).join('')}
  `;
}

function filterBySource(source) {
  document.querySelectorAll('.source-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-source="${source}"]`);
  if (btn) btn.classList.add('active');
  renderLeadsList(allLeads);
}

function getSourceClass(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('smart day')) return 'source-smart-day';
  if (s.includes('audyt')) return 'source-audyt';
  return 'source-other';
}

function getSourceLabel(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('smart day')) return `<span class="lead-source-tag source-smart-day">Smart Day</span>`;
  if (s.includes('audyt')) return `<span class="lead-source-tag source-audyt">Audyt 360</span>`;
  if (source) return `<span class="lead-source-tag source-other">${source}</span>`;
  return '';
}

function getLeadAgeLabel(createdAt) {
  if (!createdAt) return '';
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageH = Math.floor(ageMin / 60);
  const ageM = ageMin % 60;

  let cls = 'age-ok';
  let label = ageMin < 60 ? `${ageMin} min` : `${ageH}h ${ageM}m`;

  if (ageMin >= 15 && ageMin < 120) cls = 'age-warn';
  if (ageMin >= 120) { cls = 'age-critical'; }

  return `<span class="lead-age ${cls}">${label}</span>`;
}

function createLeadCard(lead) {
  const div = document.createElement('div');
  div.className = 'lead-card';

  const sourceTags = [...new Set([...(lead.tags || []), lead.source].filter(Boolean))];
  const sourceTagsHtml = sourceTags.map(t => getSourceLabel(t)).join('');
  const ageHtml = getLeadAgeLabel(lead.createdAt);
  const phoneHtml = lead.phone
    ? `<div class="lead-phone">📞 ${lead.phone}</div>`
    : `<div class="lead-phone no-phone">Brak numeru telefonu</div>`;

  div.innerHTML = `
    <div class="lead-avatar">${(lead.name || 'P').charAt(0).toUpperCase()}</div>
    <div class="lead-info">
      <div class="lead-name-row">
        <span class="lead-name">${lead.name}</span>
        ${ageHtml}
        ${sourceTagsHtml}
      </div>
      ${phoneHtml}
      ${lead.zglosza ? `<div class="lead-zglosza"><em>${lead.zglosza}</em></div>` : ''}
    </div>
    <div class="lead-actions">
      ${lead.phone ? `<button class="btn-call" onclick="initiateCall('${lead.phone}', '${escHtml(lead.name)}', '${lead.contactId}', '${lead.id}')">📞 Zadzwoń</button>` : ''}
      <button class="btn-report" onclick="openCallPopupForLead('${lead.contactId}', '${escHtml(lead.name)}', '${lead.phone}', '${escHtml(lead.zglosza)}', '${lead.id}')">📋 Raport</button>
      <button class="btn-edit edit-request-btn" onclick="openEditRequest('${lead.contactId}', '${escHtml(lead.name)}')">${currentUserRole === 'admin' ? '✏️ Edytuj' : '✏️ Prośba o edycję'}</button>
      <button class="btn-delete admin-only" style="display:${currentUserRole === 'admin' ? 'inline-flex' : 'none'}" onclick="deleteLead('${lead.id}', this)">✕</button>
    </div>
  `;
  return div;
}

async function deleteLead(oppId, btn) {
  if (!confirm('Usunąć to zgłoszenie z GHL?')) return;
  btn.disabled = true;
  try {
    const r = await fetch(`/api/opportunity/${oppId}`, { method: 'DELETE' });
    if (r.ok) {
      allLeads = allLeads.filter(l => l.id !== oppId);
      renderLeadsList(allLeads);
      showToast('Zgłoszenie usunięte', 'success');
    } else {
      showToast('Błąd usuwania', 'error');
      btn.disabled = false;
    }
  } catch(e) {
    showToast('Błąd usuwania', 'error');
    btn.disabled = false;
  }
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ==================== CALLS — BLOK C ====================
async function loadCalls() {
  try {
    const r = await fetch('/api/calls?days=7');
    const data = await r.json();
    allCalls = data.calls || [];
    renderCallsTable(allCalls);
  } catch(e) {
    console.error('loadCalls error:', e);
  }
}

function renderCallsTable(calls) {
  const container = document.getElementById('callsFeed');
  if (!container) return;

  if (calls.length === 0) {
    container.innerHTML = '<div class="empty-state">Brak połączeń</div>';
    return;
  }

  // Filtr aktywny
  const activeFilter = document.querySelector('.call-filter-btn.active')?.dataset?.filter || 'all';
  const filtered = activeFilter === 'all' ? calls : calls.filter(c => {
    if (activeFilter === 'inbound')    return c.direction === 'inbound';
    if (activeFilter === 'outbound')   return c.direction === 'outbound';
    if (activeFilter === 'missed')     return c.tag === 'missed';
    if (activeFilter === 'connected')  return c.tag === 'connected';
    return true;
  });

  container.innerHTML = `
    <table class="calls-table">
      <thead>
        <tr>
          <th>Pacjent / Numer</th>
          <th>Kierunek</th>
          <th>Status</th>
          <th>Czas</th>
          <th>Czas trwania</th>
          <th>Nagranie</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(c => renderCallRow(c)).join('')}
      </tbody>
    </table>
  `;
}

function renderCallRow(c) {
  const time = c.timestamp ? new Date(c.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const dur = c.duration ? formatDuration(c.duration) : '—';
  const dirIcon = c.direction === 'outbound' ? '📤' : '📞';
  const dirLabel = c.direction === 'outbound' ? 'Wychodzące' : 'Przychodzące';

  // Tag (C3)
  const tagHtml = c.tag ? `<span class="call-tag tag-${c.tag}">${tagLabel(c.tag)}</span>` : '';

  // Nagranie (D1 — tylko gdy gotowe)
  const recHtml = c.recordingUrl
    ? `<audio controls src="${c.recordingUrl}" class="call-recording-player"></audio>
       <a href="${c.recordingUrl}" download class="btn-download-rec" title="Pobierz">↓</a>`
    : `<button class="btn-fetch-rec" onclick="fetchRecording('${c.callId}', this)" title="Sprawdź nagranie">▶ Sprawdź</button>`;

  return `
    <tr class="call-row" onclick="openCallReport('${c.callId}')">
      <td>
        <div class="call-avatar ${c.direction === 'outbound' ? 'av-out' : 'av-in'}">${(c.contactName || c.from || '?').charAt(0).toUpperCase()}</div>
        <div class="call-name-cell">
          <div class="call-name">${c.contactName || c.from || 'Nieznany'}</div>
          <div class="call-number">${c.from || c.to || ''}</div>
        </div>
      </td>
      <td>${dirIcon} ${dirLabel}</td>
      <td>${tagHtml}</td>
      <td>${time}</td>
      <td>${dur}</td>
      <td onclick="event.stopPropagation()">${recHtml}</td>
      <td onclick="event.stopPropagation()">
        ${(c.from || c.to) ? `<button class="btn-call btn-sm" onclick="initiateCall('${c.from || c.to}', '${escHtml(c.contactName || '')}')">📞</button>` : ''}
      </td>
    </tr>
  `;
}

function tagLabel(tag) {
  const labels = { connected: 'POŁĄCZONO', missed: 'NIEODEBRANE', ineffective: 'NIESKUTECZNE' };
  return labels[tag] || tag.toUpperCase();
}

function formatDuration(sec) {
  const s = parseInt(sec) || 0;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function filterCalls(filter) {
  document.querySelectorAll('.call-filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-filter="${filter}"]`);
  if (btn) btn.classList.add('active');
  renderCallsTable(allCalls);
}

async function fetchRecording(callId, btn) {
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const r = await fetch(`/api/call/${callId}/recording`);
    const data = await r.json();
    if (data.url) {
      const idx = allCalls.findIndex(c => c.callId === callId);
      if (idx >= 0) allCalls[idx].recordingUrl = data.url;
      renderCallsTable(allCalls);
      showToast('🎙️ Nagranie gotowe', 'success');
    } else {
      btn.textContent = '▶ Sprawdź';
      btn.disabled = false;
      showToast('Nagranie jeszcze niedostępne', 'info');
    }
  } catch(e) {
    btn.textContent = '▶ Sprawdź';
    btn.disabled = false;
  }
}

function openCallReport(callId) {
  const call = allCalls.find(c => c.callId === callId);
  if (!call) return;
  openCallPopupForLead(
    call.contactId || 'unknown',
    call.contactName || call.from || 'Nieznany',
    call.from || call.to || '',
    '',
    call.oppId || null
  );
}

// ==================== CLICK-TO-CALL ====================
async function initiateCall(phone, name, contactId, oppId) {
  if (!phone || phone === 'undefined') {
    showToast('Brak numeru telefonu', 'error');
    return;
  }

  showToast(`📞 Inicjowanie połączenia z ${name || phone}...`, 'info');

  try {
    const response = await fetch('/api/call/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone, agentPhone: '', contactName: name, contactId })
    });
    const data = await response.json();

    if (data.success || data.status === 'success') {
      showToast(`✅ Połączenie zainicjowane z ${phone}`, 'success');
    } else {
      showToast(`Połączenie: ${data.message || 'Zainicjowano'}`, 'info');
    }
  } catch (err) {
    showToast(`Błąd połączenia: ${err.message}`, 'error');
  }
}

// ==================== CALL POPUP (C6/C7/C8) ====================
function openCallPopup(contact) {
  currentContact = contact;

  document.getElementById('popupPatientName').textContent = contact.name || 'Nieznany';
  document.getElementById('popupPatientPhone').textContent = contact.phone || '';
  document.getElementById('popupAvatar').textContent = (contact.name || 'P').charAt(0).toUpperCase();
  document.getElementById('popupStatusText').textContent =
    contact.direction === 'outbound' ? 'Połączenie wychodzące' : 'Połączenie przychodzące';

  // Tag (C3)
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl) { tagEl.style.display = 'none'; tagEl.textContent = ''; tagEl.className = 'call-tag'; }

  // Przyciski Odbierz/Rozłącz (C6)
  const answerBtn = document.getElementById('popupAnswerBtn');
  const hangupBtn = document.getElementById('popupHangupBtn');
  if (answerBtn) answerBtn.style.display = contact.direction === 'inbound' ? 'inline-flex' : 'none';
  if (hangupBtn) hangupBtn.style.display = 'inline-flex';

  // Pole z_czym_si_zgasza
  if (contact.zglosza) {
    const zEl = document.getElementById('popupZglosza');
    if (zEl) zEl.textContent = contact.zglosza;
    const zBox = document.getElementById('popupZCzymSieZglasza');
    if (zBox) zBox.classList.remove('hidden');
  } else {
    const zBox = document.getElementById('popupZCzymSieZglasza');
    if (zBox) zBox.classList.add('hidden');
    if (contact.id && contact.id !== 'unknown') fetchContactZglosza(contact.id);
  }

  resetReportForm();
  document.getElementById('callPopup').classList.remove('hidden');
  startCallTimer();
}

function openCallPopupForLead(id, name, phone, zglosza, oppId) {
  currentOpportunity = oppId ? { id: oppId } : null;
  openCallPopup({ id, name, phone, zglosza });
}

async function fetchContactZglosza(contactId) {
  try {
    const response = await fetch(`/api/contact/${contactId}`);
    const data = await response.json();
    const contact = data.contact || data;
    const zglosza = contact.customFields?.find(f =>
      f.id === 'z_czym_si_zgasza' || f.fieldKey === 'contact.z_czym_si_zgasza'
    )?.value;
    if (zglosza) {
      const zEl = document.getElementById('popupZglosza');
      if (zEl) zEl.textContent = zglosza;
      const zBox = document.getElementById('popupZCzymSieZglasza');
      if (zBox) zBox.classList.remove('hidden');
    }
  } catch (err) { console.error('Fetch zglosza error:', err); }
}

function answerCall() {
  // Potwierdź odebranie — uruchom timer od teraz
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl) { tagEl.textContent = 'POŁĄCZONO'; tagEl.className = 'call-tag tag-connected'; tagEl.style.display = 'inline-block'; }
  const answerBtn = document.getElementById('popupAnswerBtn');
  if (answerBtn) answerBtn.style.display = 'none';
  showToast('✅ Połączenie odebrane', 'success');
}

function hangupCall() {
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl) { tagEl.textContent = 'ROZŁĄCZONO'; tagEl.className = 'call-tag tag-missed'; tagEl.style.display = 'inline-block'; }
  stopCallTimer();
  showToast('📵 Rozłączono', 'info');
}

function closeCallPopup() {
  document.getElementById('callPopup').classList.add('hidden');
  stopCallTimer();
  currentContact = null;
  selectedStatus = null;
  selectedOutcome = null;
  activeCallId = null;
}

function startCallTimer() {
  callStartTime = Date.now();
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const sec = (elapsed % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('callTimer');
    if (timerEl) timerEl.textContent = `${min}:${sec}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  const timerEl = document.getElementById('callTimer');
  if (timerEl) timerEl.textContent = '00:00';
}

function resetReportForm() {
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.status-tile').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.report-form').forEach(f => f.classList.add('hidden'));
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.outcome-fields').forEach(f => f.classList.add('hidden'));
  selectedStatus = null;
  selectedOutcome = null;
}

// ==================== STATUS SELECTION (C7 — 2x2 tiles) ====================
function selectStatus(status) {
  selectedStatus = status;
  document.querySelectorAll('.status-btn, .status-tile').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-status="${status}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.report-form').forEach(f => f.classList.add('hidden'));
  const form = document.getElementById(`form-${status}`);
  if (form) form.classList.remove('hidden');
  selectedOutcome = null;
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.outcome-fields').forEach(f => f.classList.add('hidden'));
}

function selectOutcome(outcome) {
  selectedOutcome = outcome;
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-outcome="${outcome}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.outcome-fields').forEach(f => f.classList.add('hidden'));
  const fields = document.getElementById(`outcome-${outcome}`);
  if (fields) fields.classList.remove('hidden');
}

// ==================== TIME SETTERS ====================
function setContactTime(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('contactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('.contact-time-buttons .time-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

function setContactTimeSt(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('stalyContactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('#outcome-staly_kontakt .time-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

function setContactTimeWizyta(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('wizytaContactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('#outcome-odwolanie .time-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

function formatDateTimeLocal(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ==================== SAVE REPORT ====================
async function saveReport() {
  if (!selectedStatus) { showToast('Wybierz status pacjenta', 'error'); return; }

  const contactId = currentContact?.id;
  const reportData = buildReportData();

  try {
    if (selectedStatus === 'NOWY_PACJENT')    await handleNewPatientReport(contactId, reportData);
    else if (selectedStatus === 'WIZYTA_BIEZACA') await handleVisitReport(contactId, reportData);
    else if (selectedStatus === 'STALY_PACJENT')  await handleRegularPatientReport(contactId, reportData);
    else if (selectedStatus === 'SPAM')           showToast('Kontakt oznaczony jako SPAM', 'info');

    if (currentContact) {
      inProgressCalls.push({
        id: currentContact.id, name: currentContact.name, phone: currentContact.phone,
        zglosza: currentContact.zglosza, status: 'in-progress',
        time: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
        reportStatus: selectedStatus
      });
      document.getElementById('badge-progress').textContent = inProgressCalls.length;
    }

    showToast('✅ Raport zapisany pomyślnie', 'success');
    closeCallPopup();
  } catch (err) {
    showToast(`Błąd zapisu: ${err.message}`, 'error');
  }
}

function buildReportData() {
  const data = { status: selectedStatus, outcome: selectedOutcome };
  if (selectedStatus === 'NOWY_PACJENT') {
    data.program = document.getElementById('programLeczenia')?.value;
    if (selectedOutcome === 'umowil_sie')    data.dataW0 = document.getElementById('dataW0')?.value;
    if (selectedOutcome === 'prosi_kontakt') data.contactDateTime = document.getElementById('contactDateTime')?.value;
    if (selectedOutcome === 'rezygnacja')    data.powodRezygnacji = document.getElementById('powodRezygnacji')?.value;
  } else if (selectedStatus === 'WIZYTA_BIEZACA') {
    if (selectedOutcome === 'zmiana_terminu') {
      data.powodZmiany = document.getElementById('powodZmiany')?.value;
      data.nowyTermin  = document.getElementById('nowyTermin')?.value;
    } else if (selectedOutcome === 'odwolanie') {
      data.powodOdwolania  = document.getElementById('powodOdwolania')?.value;
      data.contactDateTime = document.getElementById('wizytaContactDateTime')?.value;
    }
  } else if (selectedStatus === 'STALY_PACJENT') {
    data.notatka = document.getElementById('stalyNotatka')?.value;
    if (selectedOutcome === 'staly_umowil')  data.dataWizyty = document.getElementById('stalyDataWizyty')?.value;
    if (selectedOutcome === 'staly_kontakt') data.contactDateTime = document.getElementById('stalyContactDateTime')?.value;
  } else if (selectedStatus === 'SPAM') {
    data.notatka = document.getElementById('spamNotatka')?.value;
  }
  return data;
}

async function handleNewPatientReport(contactId, data) {
  if (data.outcome === 'umowil_sie' && data.dataW0) {
    if (currentOpportunity?.id) {
      await fetch(`/api/opportunity/${currentOpportunity.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: [
          { id: 'data_w0', value: data.dataW0 },
          { id: 'dedykowany_program_leczenia', value: data.program }
        ]})
      });
    }
    showToast(`📅 Wizyta umówiona na ${new Date(data.dataW0).toLocaleDateString('pl-PL')}`, 'success');
  } else if (data.outcome === 'prosi_kontakt' && data.contactDateTime) {
    if (contactId && contactId !== 'unknown') {
      await fetch(`/api/contact/${contactId}/task`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Oddzwoń do ${currentContact?.name || 'pacjenta'}`,
          body: `Pacjent prosi o kontakt. Program: ${data.program || 'nieustalony'}`,
          dueDate: new Date(data.contactDateTime).toISOString()
        })
      });
    }
    showToast('📋 Zadanie oddzwonienia utworzone', 'success');
    loadTodayTasks();
  } else if (data.outcome === 'rezygnacja' && data.powodRezygnacji) {
    if (currentOpportunity?.id) {
      await fetch(`/api/opportunity/${currentOpportunity.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: [{ id: 'powd_rezygnacji__niekwalifikacji', value: data.powodRezygnacji }]})
      });
    }
    showToast('❌ Rezygnacja zapisana', 'info');
  }
}

async function handleVisitReport(contactId, data) {
  if (data.outcome === 'zmiana_terminu') {
    if (currentOpportunity?.id) {
      await fetch(`/api/opportunity/${currentOpportunity.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: [
          { id: 'powd_zmiany__odwoania', value: data.powodZmiany },
          { id: 'nowy_termin_wizyty', value: data.nowyTermin }
        ]})
      });
    }
    showToast(`🔄 Termin zmieniony na ${new Date(data.nowyTermin).toLocaleDateString('pl-PL')}`, 'success');
  } else if (data.outcome === 'odwolanie') {
    if (contactId && contactId !== 'unknown') {
      await fetch(`/api/contact/${contactId}/task`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Oddzwoń - odwołana wizyta: ${currentContact?.name || 'pacjent'}`,
          body: `Powód odwołania: ${data.powodOdwolania || 'nieustalony'}`,
          dueDate: data.contactDateTime ? new Date(data.contactDateTime).toISOString() : new Date(Date.now() + 86400000).toISOString()
        })
      });
    }
    showToast('📋 Zadanie ponownego kontaktu utworzone', 'success');
    loadTodayTasks();
  }
}

async function handleRegularPatientReport(contactId, data) {
  if (data.outcome === 'staly_kontakt' && data.contactDateTime) {
    if (contactId && contactId !== 'unknown') {
      await fetch(`/api/contact/${contactId}/task`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Oddzwoń do ${currentContact?.name || 'pacjenta'}`,
          body: data.notatka || 'Stały pacjent prosi o kontakt',
          dueDate: new Date(data.contactDateTime).toISOString()
        })
      });
    }
    showToast('📋 Zadanie oddzwonienia utworzone', 'success');
    loadTodayTasks();
  }
}

// ==================== TASKS (F1) ====================
async function loadTodayTasks() {
  const listEl = document.getElementById('tasksTodayList');
  if (!listEl) return;

  try {
    const r = await fetch('/api/tasks');
    const data = await r.json();
    const tasks = data.tasks || data.data || [];

    const today = new Date().toDateString();
    todayTasks = tasks.filter(t => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate).toDateString() === today;
    });

    renderTasks(listEl, todayTasks);
    const badge = document.getElementById('kpi-tasks');
    if (badge) badge.textContent = todayTasks.length;
  } catch (err) {
    // Demo tasks
    todayTasks = [
      { id: 't1', title: 'Oddzwoń do Anny Kowalskiej', dueDate: new Date().toISOString(), completed: false },
      { id: 't2', title: 'Prośba o edycję: Marek Nowak', dueDate: new Date().toISOString(), completed: false }
    ];
    renderTasks(listEl, todayTasks);
  }
}

function renderTasks(listEl, tasks) {
  if (tasks.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak zadań na dziś</div>';
    return;
  }
  listEl.innerHTML = '';
  tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = `task-item ${task.completed ? 'completed' : ''}`;
    item.innerHTML = `
      <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}
             onchange="toggleTask('${task.id}', this.checked)">
      <span class="task-title">${task.title || task.body || 'Zadanie'}</span>
      <span class="task-due">${formatTaskDue(task.dueDate)}</span>
    `;
    listEl.appendChild(item);
  });
}

function formatTaskDue(dueDate) {
  if (!dueDate) return '';
  return new Date(dueDate).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

async function toggleTask(taskId, completed) {
  showToast(completed ? 'Zadanie oznaczone jako wykonane' : 'Zadanie przywrócone', 'info');
}

// ==================== CONTACTS — BLOK E ====================
async function loadContacts() {
  const listEl = document.getElementById('contactsList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Ładowanie kontaktów...</p></div>';

  try {
    const response = await fetch('/api/contacts/new');
    const data = await response.json();
    const contacts = data.contacts || [];

    if (contacts.length === 0) { showDemoContacts(listEl); return; }

    allContacts = contacts;
    renderContactsGrid(listEl, contacts);
  } catch (err) {
    showDemoContacts(listEl);
  }
}

function showDemoContacts(listEl) {
  allContacts = [
    { id: 'c1', firstName: 'Anna', lastName: 'Kowalska', phone: '+48 501 234 567', email: 'anna.k@example.com', tags: ['Smart Day'] },
    { id: 'c2', firstName: 'Marek', lastName: 'Nowak', phone: '+48 602 345 678', email: 'marek.n@example.com', tags: ['Audyt 360'] },
    { id: 'c3', firstName: 'Katarzyna', lastName: 'Wiśniewska', phone: '+48 703 456 789', email: 'kasia.w@example.com', tags: [] },
    { id: 'c4', firstName: 'Piotr', lastName: 'Zając', phone: '+48 504 567 890', email: 'piotr.z@example.com', tags: ['Smart Day'] },
    { id: 'c5', firstName: 'Maria', lastName: 'Lewandowska', phone: '+48 605 678 901', email: 'maria.l@example.com', tags: [] },
    { id: 'c6', firstName: 'Tomasz', lastName: 'Wójcik', phone: '+48 706 789 012', email: 'tomasz.w@example.com', tags: ['Audyt 360'] }
  ];
  renderContactsGrid(listEl, allContacts);
}

function renderContactsGrid(listEl, contacts) {
  listEl.innerHTML = `
    <div class="contacts-grid">
      <div class="contacts-grid-header">
        <div>Pacjent</div>
        <div>Telefon</div>
        <div>Email</div>
        <div>Tagi</div>
        <div>Akcje</div>
      </div>
      ${contacts.map(c => renderContactRow(c)).join('')}
    </div>
  `;
}

function renderContactRow(c) {
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Nieznany';
  const tagsHtml = (c.tags || []).map(t => `<span class="contact-tag">${t}</span>`).join('');
  const editBtnLabel = currentUserRole === 'admin' ? '✏️ Edytuj' : '✏️ Prośba o edycję';

  return `
    <div class="contacts-grid-row">
      <div class="contact-name-cell">
        <div class="contact-avatar-sm">${name.charAt(0)}</div>
        <span class="contact-name">${name}</span>
      </div>
      <div class="contact-phone-cell" onclick="editContactField('${c.id}', 'phone', '${c.phone || ''}', this)" title="Kliknij aby edytować">
        ${c.phone || '<span class="no-data">Brak</span>'}
      </div>
      <div class="contact-email-cell" onclick="editContactField('${c.id}', 'email', '${c.email || ''}', this)" title="Kliknij aby edytować">
        ${c.email || '<span class="no-data">Brak</span>'}
      </div>
      <div class="contact-tags-cell">${tagsHtml}</div>
      <div class="contact-actions-cell">
        ${c.phone ? `<button class="btn-call btn-sm" onclick="initiateCall('${c.phone}', '${escHtml(name)}', '${c.id}')">📞</button>` : ''}
        <button class="btn-edit btn-sm edit-request-btn" onclick="openEditRequest('${c.id}', '${escHtml(name)}')">${editBtnLabel}</button>
      </div>
    </div>
  `;
}

// Edycja inline pola kontaktu (E3)
function editContactField(contactId, field, currentValue, cell) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.className = 'contact-field-input';
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  const save = async () => {
    const newValue = input.value.trim();
    if (newValue === currentValue) { cell.textContent = currentValue || '—'; return; }
    try {
      await fetch(`/api/contact/${contactId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue })
      });
      cell.textContent = newValue || '—';
      showToast('✅ Zapisano', 'success');
      // Zaktualizuj allContacts
      const idx = allContacts.findIndex(c => c.id === contactId);
      if (idx >= 0) allContacts[idx][field] = newValue;
    } catch(e) {
      cell.textContent = currentValue || '—';
      showToast('Błąd zapisu', 'error');
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { cell.textContent = currentValue || '—'; } });
}

function searchContacts(query) {
  const listEl = document.getElementById('contactsList');
  if (!listEl || !allContacts.length) return;

  const q = query.toLowerCase();
  const filtered = allContacts.filter(c => {
    const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const phone = (c.phone || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const tags = (c.tags || []).join(' ').toLowerCase();
    return name.includes(q) || phone.includes(q) || email.includes(q) || tags.includes(q);
  });

  renderContactsGrid(listEl, filtered);
}

// ==================== EDIT REQUEST — SONIA (E4/E5) ====================
let editRequestContactId = null;
let editRequestContactName = null;

function openEditRequest(contactId, contactName) {
  editRequestContactId = contactId;
  editRequestContactName = contactName;
  const notesEl = document.getElementById('editRequestNotes');
  if (notesEl) notesEl.value = '';
  const popup = document.getElementById('editRequestPopup');
  if (popup) popup.classList.remove('hidden');
}

function requestEditForCurrentContact() {
  if (currentContact) openEditRequest(currentContact.id, currentContact.name);
}

function closeEditRequest() {
  const popup = document.getElementById('editRequestPopup');
  if (popup) popup.classList.add('hidden');
  editRequestContactId = null;
  editRequestContactName = null;
}

async function submitEditRequest() {
  const notes = document.getElementById('editRequestNotes')?.value;

  if (!editRequestContactId || editRequestContactId === 'undefined') {
    showToast('Brak ID kontaktu', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/contact/${editRequestContactId}/request-edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: editRequestContactName,
        notes: notes || 'Recepcja prosi o edycję danych kontaktu'
      })
    });
    const data = await response.json();
    if (data.success || data.task) {
      showToast('✅ Zadanie dla Soni utworzone w GHL', 'success');
    } else {
      showToast('Prośba wysłana', 'info');
    }
    closeEditRequest();
  } catch (err) {
    showToast('Prośba wysłana (tryb demo)', 'info');
    closeEditRequest();
  }
}

// ==================== IN-PROGRESS / COMPLETED ====================
function loadInProgress() {
  const listEl = document.getElementById('inProgressList');
  if (!listEl) return;
  if (inProgressCalls.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak aktywnych połączeń w obsłudze</div>';
    document.getElementById('badge-progress').textContent = '0';
  } else {
    document.getElementById('badge-progress').textContent = inProgressCalls.length;
    listEl.innerHTML = '';
    inProgressCalls.forEach(call => {
      const card = createLeadCard(call);
      listEl.appendChild(card);
    });
  }
}

function loadCompletedCalls() {
  const listEl = document.getElementById('completedList');
  if (!listEl) return;
  if (completedCalls.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak zakończonych połączeń</div>';
    document.getElementById('badge-completed').textContent = '0';
  } else {
    document.getElementById('badge-completed').textContent = completedCalls.length;
    listEl.innerHTML = '';
    completedCalls.forEach(call => {
      const card = createLeadCard(call);
      listEl.appendChild(card);
    });
  }
}

// ==================== STATS — BLOK G ====================
async function loadAndRenderStats() {
  const container = document.getElementById('statsContent');
  if (!container) return;

  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Ładowanie statystyk...</p></div>';

  try {
    const r = await fetch('/api/stats');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    renderAdminStats(container, data);
  } catch(e) {
    container.innerHTML = `<div class="stats-error"><p>Błąd ładowania statystyk: ${e.message}</p><button class="btn-secondary" onclick="loadAndRenderStats()">Odśwież</button></div>`;
  }
}

function renderAdminStats(container, data) {
  const s = data.stats || {};
  const total = s.totalCalls || 0;
  const answered = s.answered || 0;
  const missed = s.missed || 0;
  const outbound = s.outbound || 0;
  const answeredPct = s.answeredPercent || 0;
  const newLeads = s.newLeads || 0;

  if (total === 0) {
    container.innerHTML = `
      <div class="stats-empty">
        <div class="stats-empty-icon">📊</div>
        <h3>Brak połączeń z dziś</h3>
        <p>Statystyki zostaną uzupełnione po pierwszych rozmowach.</p>
      </div>
    `;
    return;
  }

  const kpiColor = (val, good, warn) => val >= good ? 'kpi-green' : val >= warn ? 'kpi-yellow' : 'kpi-red';

  container.innerHTML = `
    <div class="stats-kpi-grid">
      <div class="stats-kpi-card ${kpiColor(answeredPct, 80, 60)}">
        <div class="stats-kpi-value">${answeredPct}%</div>
        <div class="stats-kpi-label">Odbieralność</div>
        <div class="stats-kpi-sub">Cel: 80%</div>
      </div>
      <div class="stats-kpi-card">
        <div class="stats-kpi-value">${total}</div>
        <div class="stats-kpi-label">Połączeń dziś</div>
        <div class="stats-kpi-sub">${outbound} wychodzących</div>
      </div>
      <div class="stats-kpi-card ${kpiColor(answered, total * 0.8, total * 0.6)}">
        <div class="stats-kpi-value">${answered}</div>
        <div class="stats-kpi-label">Odebranych</div>
        <div class="stats-kpi-sub">${missed} nieodebranych</div>
      </div>
      <div class="stats-kpi-card ${kpiColor(newLeads, 5, 2)}">
        <div class="stats-kpi-value">${newLeads}</div>
        <div class="stats-kpi-label">Nowych zgłoszeń</div>
        <div class="stats-kpi-sub">W pipeline</div>
      </div>
    </div>

    <div class="stats-section">
      <h3>Rozkład połączeń</h3>
      <div class="stats-bar-row">
        <span class="stats-bar-label">Odebrane</span>
        <div class="stats-bar-track"><div class="stats-bar-fill bar-green" style="width:${total > 0 ? Math.round(answered/total*100) : 0}%"></div></div>
        <span class="stats-bar-val">${answered}</span>
      </div>
      <div class="stats-bar-row">
        <span class="stats-bar-label">Nieodebrane</span>
        <div class="stats-bar-track"><div class="stats-bar-fill bar-red" style="width:${total > 0 ? Math.round(missed/total*100) : 0}%"></div></div>
        <span class="stats-bar-val">${missed}</span>
      </div>
      <div class="stats-bar-row">
        <span class="stats-bar-label">Wychodzące</span>
        <div class="stats-bar-track"><div class="stats-bar-fill bar-blue" style="width:${total > 0 ? Math.round(outbound/total*100) : 0}%"></div></div>
        <span class="stats-bar-val">${outbound}</span>
      </div>
    </div>

    <div class="stats-section">
      <h3>Ostatnie połączenia</h3>
      <table class="stats-calls-table">
        <thead><tr><th>Pacjent</th><th>Kierunek</th><th>Status</th><th>Czas</th><th>Czas trwania</th></tr></thead>
        <tbody>
          ${(data.recentCalls || []).slice(0, 20).map(c => `
            <tr>
              <td>${c.contactName || c.from || '—'}</td>
              <td>${c.direction === 'outbound' ? '📤 Wychodzące' : '📞 Przychodzące'}</td>
              <td><span class="call-tag tag-${c.tag || 'unknown'}">${tagLabel(c.tag || 'unknown')}</span></td>
              <td>${c.timestamp ? new Date(c.timestamp).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'}) : '—'}</td>
              <td>${c.duration ? formatDuration(c.duration) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ==================== CHAT DO SONI (H1/H3) ====================
let chatOpen = false;

function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chatPanel');
  const toggle = document.getElementById('chatToggle');
  if (panel) panel.classList.toggle('hidden', !chatOpen);
  if (toggle) toggle.classList.toggle('active', chatOpen);
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input?.value?.trim();
  if (!text) return;

  const userName = document.getElementById('userNameDisplay')?.textContent || 'Recepcja';
  appendChatMessage(userName, text, new Date().toISOString(), true);
  input.value = '';

  // Wyślij przez WebSocket
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.send(JSON.stringify({ type: 'CHAT_MESSAGE', from: userName, text }));
  }
}

function appendChatMessage(from, text, ts, isMine) {
  const list = document.getElementById('chatMessages');
  if (!list) return;
  const time = ts ? new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const div = document.createElement('div');
  div.className = `chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}`;
  div.innerHTML = `<div class="chat-msg-from">${from}</div><div class="chat-msg-text">${text}</div><div class="chat-msg-time">${time}</div>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

// ==================== CHARTS (zachowane z v6) ====================
function renderCharts() {
  renderDonutChart();
  renderGaugeChart();
  renderBarChart();
}

function renderDonutChart() {
  const canvas = document.getElementById('callsDonutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) / 2 - 20;
  const inner = r * 0.6;
  const data = [
    { value: 776, color: '#27ae60', label: 'Odebrane (74%)' },
    { value: 118, color: '#e74c3c', label: 'Nieodebrane (11%)' },
    { value: 129, color: '#f39c12', label: 'Rozłączenia (12%)' },
    { value: 23,  color: '#95a5a6', label: 'Poza godz. (2%)' }
  ];
  const total = data.reduce((s, d) => s + d.value, 0);
  let angle = -Math.PI / 2;
  ctx.clearRect(0, 0, width, height);
  data.forEach(seg => {
    const slice = (seg.value / total) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill();
    angle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#001f3f'; ctx.font = 'bold 28px Inter';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('1046', cx, cy - 10);
  ctx.font = '12px Inter'; ctx.fillStyle = '#6c757d';
  ctx.fillText('połączeń', cx, cy + 14);
  const legendEl = document.getElementById('donutLegend');
  if (legendEl) legendEl.innerHTML = data.map(d => `<div class="legend-item"><div class="legend-dot" style="background:${d.color}"></div><span>${d.label}</span></div>`).join('');
}

function renderGaugeChart() {
  const canvas = document.getElementById('callbackGaugeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width / 2, cy = height * 0.75;
  const r = Math.min(width, height) * 0.65;
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineWidth = 20; ctx.strokeStyle = '#e9ecef'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + 0.9 * Math.PI);
  ctx.lineWidth = 20; ctx.strokeStyle = '#27ae60'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.fillStyle = '#001f3f'; ctx.font = 'bold 24px Inter';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('90%', cx, cy - 10);
}

function renderBarChart() {
  const canvas = document.getElementById('callsBarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const hours = ['8','9','10','11','12','13','14','15','16','17','18'];
  const values = [12, 28, 45, 52, 38, 41, 55, 48, 35, 22, 8];
  ctx.clearRect(0, 0, width, height);
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const max = Math.max(...values);
  const bw = (cw / hours.length) * 0.7;
  const bs = cw / hours.length;
  ctx.strokeStyle = '#e9ecef'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#6c757d'; ctx.font = '11px Inter'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - (max / 5) * i), pad.left - 5, y + 4);
  }
  hours.forEach((h, i) => {
    const x = pad.left + i * bs + (bs - bw) / 2;
    const bh = (values[i] / max) * ch;
    const y = pad.top + ch - bh;
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, '#001f3f'); g.addColorStop(1, '#003d7a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, y, bw, bh, [4, 4, 0, 0]); ctx.fill();
    ctx.fillStyle = '#6c757d'; ctx.font = '11px Inter'; ctx.textAlign = 'center';
    ctx.fillText(`${h}:00`, x + bw / 2, height - pad.bottom + 16);
  });
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== KPI UPDATES ====================
function updateKPIs() {
  document.getElementById('kpi-calls').textContent = '0';
  document.getElementById('kpi-missed').textContent = '0';
}
updateKPIs();
