/* ============================================================
   Navigator Call v6 — EndoEstetica
   Frontend Application Logic — Enhanced Edition
   ============================================================ */

// ==================== GHL STAGES ====================
const GHL_STAGE_IDS = {
  NEW:          '4d006021-f3b2-4efc-8efc-4f049522379c',
  ATTEMPT_1:    '002dbc5a-c6a4-4931-a9a3-af4877b2c525',
  ATTEMPT_2:    'de0a619e-ee22-41c3-9a90-eccfcb1a8fb8',
  FOLLOWUP_2:   '6d0c5ca9-8b79-4bf3-a091-381e636cd21e',
  FOLLOWUP_4:   '53ad4911-a26c-41fa-9b23-bc3c88f98ea4',
  NO_CONTACT:   '6517c39e-15fe-4041-a847-89ba822b3c96',
  AFTER_CALL:   '19126f1b-5529-48fc-be95-d6b64e264e59',
  BOOKED_W0:    '73f6704f-1d6a-49dc-8591-4b129ba1b692',
  NO_SHOW:      'afc5a678-b78b-47bd-858e-78968724ac4d',
  REFUSED:      '139cde76-d37e-4a14-ad45-ae94a843d78b',
};
const GHL_STAGE_NAMES = {
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

async function moveOpportunityToStage(oppId, stageId) {
  if (!oppId) return;
  try {
    await fetch(`/api/opportunity/${oppId}/move-stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId })
    });
    console.log(`[Stage] Opportunity ${oppId} → ${GHL_STAGE_NAMES[stageId] || stageId}`);
  } catch(e) { console.error('[Stage] Error:', e); }
}

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

// ==================== SYSTEM UŻYTKOWNIKÓW ====================
let currentUser = null;

function initLoginScreen() {
  const saved = localStorage.getItem('nav_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showApp();
      return;
    } catch(e) { localStorage.removeItem('nav_user'); }
  }
  showLoginScreen();
}

async function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  const grid = document.getElementById('loginUserGrid');
  grid.innerHTML = '<p style="color:#888;">Ładowanie...</p>';

  try {
    const r = await fetch('/api/users');
    const data = await r.json();
    const users = data.users || [];
    const roleLabels = { reception: '📞 Recepcja', opiekun: '👤 Opiekun', admin: '⚙️ Administracja' };
    const grouped = {};
    users.forEach(u => {
      if (!grouped[u.role]) grouped[u.role] = [];
      grouped[u.role].push(u);
    });
    grid.innerHTML = '';
    ['reception', 'opiekun', 'admin'].forEach(role => {
      if (!grouped[role]) return;
      const section = document.createElement('div');
      section.className = 'login-role-section';
      section.innerHTML = `<div class="login-role-label">${roleLabels[role] || role}</div>`;
      grouped[role].forEach(u => {
        const btn = document.createElement('button');
        btn.className = 'login-user-btn';
        btn.textContent = u.name;
        btn.onclick = () => loginAs(u);
        section.appendChild(btn);
      });
      grid.appendChild(section);
    });
  } catch(e) {
    grid.innerHTML = '<p style="color:red;">Błąd ładowania użytkowników</p>';
  }
}

function loginAs(user) {
  currentUser = user;
  localStorage.setItem('nav_user', JSON.stringify(user));
  showApp();
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('nav_user');
  showLoginScreen();
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = '';
  const nameEl = document.getElementById('sidebarUserName');
  if (nameEl) nameEl.textContent = currentUser?.name || '—';
  // Pokaż/ukryj chat do Soni
  const chatWidget = document.getElementById('soniaChat');
  if (chatWidget) chatWidget.style.display = currentUser ? '' : 'none';
  // Admin: ukryj numer wewnętrzny w interfejsie
  if (currentUser?.role === 'admin') {
    setUserRole('admin');
  } else if (currentUser?.role === 'opiekun') {
    setUserRole('opiekun');
  } else {
    setUserRole('reception');
  }
  initApp();
}

function initApp() {
  updateClock();
  setInterval(updateClock, 1000);
  connectWebSocket();
  loadDashboardData(); // Nowa funkcja zbiorcza
  loadContacts();
  startPolling();
  initDialer();
  initSoniaChat();

  // Heartbeat: informuj serwer o aktywności użytkownika co 5 minut
  if (currentUser?.id) {
    const sendHeartbeat = () => {
      fetch(`/api/users/${currentUser.id}/heartbeat`, { method: 'POST' }).catch(() => {});
    };
    sendHeartbeat(); // Natychmiast po zalogowaniu
    setInterval(sendHeartbeat, 5 * 60 * 1000); // Co 5 minut
  }
  
  // Automatycznie pokaż chat Sonia i dialer po zalogowaniu
  setTimeout(() => {
    // Pokaż panel czatu Sonia (nie minimalizowany)
    const soniaPanel = document.getElementById('soniaChatPanel');
    if (soniaPanel) {
      soniaPanel.classList.remove('hidden');
      soniaPanel.classList.remove('minimized');
      soniaChatOpen = true;
    }
    // Pokaż dialer
    const dialerPanel = document.getElementById('dialerPanel');
    const dialerIcon = document.getElementById('dialerToggleIcon');
    if (dialerPanel) {
      dialerPanel.classList.remove('hidden');
      dialerPanel.classList.remove('minimized');
      dialerOpen = true;
      if (dialerIcon) dialerIcon.textContent = '✕';
    }
  }, 300);
}

// ==================== ZEGAR W NAGŁÓWKU ====================
function startHeaderClock() {
  function update() {
    const now = new Date();
    const timeEl = document.getElementById('clockTime');
    const dateEl = document.getElementById('clockDate');
    if (timeEl) {
      timeEl.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
    }
  }
  update();
  setInterval(update, 1000);
}

async function loadDashboardData() {
  loadDashboardPool(); // Załaduj pulę zadań na kokpicie
  try {
    // Pobierz statystyki i ostatnie połączenia
    const uid = currentUser?.id || ''; const rol = currentUser?.role || 'reception';
    const statsResp = await fetch(`/api/stats?days=1&userId=${uid}&role=${rol}`);
    if (statsResp.ok) {
      const statsData = await statsResp.json();
      updateKPIs(statsData);
    }
  } catch(e) { console.error('Stats load error:', e); }

  // Pobierz nowe zgłoszenia (aktualizuje kpi-new)
  loadNewLeads();

  // Pobierz zadania na dziś
  loadTodayTasks();

  // Pobierz połączenia (aktualizuje kpi-calls i kpi-missed)
  try {
    const uid2 = currentUser?.id || ''; const rol2 = currentUser?.role || 'reception';
    const callsResp = await fetch(`/api/calls?days=1&userId=${uid2}&role=${rol2}`);
    if (callsResp.ok) {
      const callsData = await callsResp.json();
      allCalls = callsData.calls || [];
      updateCallsKPI(allCalls);
      updateDashboardLists(allCalls);
    }
  } catch(e) { console.error('Calls load error:', e); }
}

function updateCallsKPI(calls) {
  // Aktualizuj KPI na podstawie tablicy połączeń
  const total = calls.length;
  const missed = calls.filter(c => c.tag === 'missed').length;
  const ineffective = calls.filter(c => c.tag === 'ineffective').length;
  const toCall = missed + ineffective;
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('kpi-calls', total);
  setEl('kpi-missed', missed);
  setEl('kpi-to-call', toCall);
}

function updateKPIs(data) {
  const stats = data.stats || {};
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  // kpi-calls i kpi-missed są aktualizowane przez updateCallsKPI (z /api/calls)
  // kpi-new jest aktualizowane przez loadNewLeads()
  // Tutaj aktualizujemy tylko to co pochodzi z /api/stats
  const toCallCount = (stats.missed || 0) + (data.callsByStatus?.ineffective || 0);
  setEl('kpi-to-call', toCallCount);
}

function updateDashboardLists(calls) {
  const liveFeedEl = document.getElementById('liveFeedList');
  const callbackEl = document.getElementById('callbackList');
  if (!liveFeedEl || !callbackEl) return;
  
  // ⚡ Live Feed
  const recent = calls.slice(0, 10);
  liveFeedEl.innerHTML = recent.length ? recent.map(c => `
    <div class="live-feed-item">
      <div class="feed-icon" style="background: ${c.direction === 'inbound' ? '#dbeafe' : '#f1f5f9'}; color: ${c.direction === 'inbound' ? '#3b82f6' : '#64748b'};">
        ${c.direction === 'inbound' ? '📥' : '📤'}
      </div>
      <div class="feed-content">
        <div class="feed-title">${escHtml(c.contactName || c.from)}</div>
        <div class="feed-time">${new Date(c.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} • ${c.direction === 'inbound' ? 'Przychodzące' : 'Wychodzące'}</div>
      </div>
      <div class="status-badge status-${c.tag || 'connected'}">${c.tag === 'missed' ? 'Nieodebrane' : c.tag === 'ineffective' ? 'Bez odbioru' : 'Połączono'}</div>
    </div>
  `).join('') : '<div class="empty-state">Oczekiwanie na aktywność...</div>';
  
  // 📞 Lista do oddzwonienia
  const toCall = calls.filter(c => c.tag === 'missed' || c.tag === 'ineffective').slice(0, 10);
  callbackEl.innerHTML = toCall.length ? toCall.map(c => `
    <div class="live-feed-item">
      <div class="feed-icon" style="background: ${c.tag === 'missed' ? '#fee2e2' : '#fef3c7'}; color: ${c.tag === 'missed' ? '#ef4444' : '#d97706'};">
        ${c.tag === 'missed' ? '🔴' : '🟡'}
      </div>
      <div class="feed-content">
        <div class="feed-title">${escHtml(c.contactName || c.from)}</div>
        <div class="feed-time">${c.tag === 'missed' ? 'Nieodebrane' : 'Nieskuteczne'} • ${new Date(c.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <button class="btn-primary" style="padding: 4px 12px; font-size: 11px;" onclick="initiateCall('${c.from}', '${escHtml(c.contactName || '')}', '${c.contactId || ''}')">Oddzwoń</button>
    </div>
  `).join('') : '<div class="empty-state">Brak pacjentów do kontaktu</div>';
}

let statsDonutChart = null;
function renderStatsCharts(data) {
  const stats = data.stats || {};
  
  if (document.getElementById('stat-total-calls')) document.getElementById('stat-total-calls').textContent = stats.totalCalls || 0;
  if (document.getElementById('stat-answered-count')) document.getElementById('stat-answered-count').textContent = stats.answered || 0;
  if (document.getElementById('stat-missed-count')) document.getElementById('stat-missed-count').textContent = stats.missed || 0;
  if (document.getElementById('stat-unique-patients')) document.getElementById('stat-unique-patients').textContent = stats.uniquePatients || 0;
  if (document.getElementById('stat-lost-count')) document.getElementById('stat-lost-count').textContent = stats.ineffective || 0;
  if (document.getElementById('stat-to-callback')) document.getElementById('stat-to-callback').textContent = (stats.missed || 0) + (stats.ineffective || 0);
  if (document.getElementById('stat-callback-rate-new')) document.getElementById('stat-callback-rate-new').textContent = (stats.callbackRate || 0) + '%';
  if (document.getElementById('stat-success-rate')) document.getElementById('stat-success-rate').textContent = (stats.answeredPercent || 0) + '%';
  
  const ctx = document.getElementById('statsDonutChart');
  if (!ctx) return;
  if (statsDonutChart) statsDonutChart.destroy();
  statsDonutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Odebrane', 'Nieodebrane', 'Bez odbioru'],
      datasets: [{
        data: [stats.answered || 0, stats.missed || 0, stats.ineffective || 0],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 0
      }]
    },
    options: { cutout: '75%', plugins: { legend: { display: false } }, maintainAspectRatio: false }
  });
}

// ==================== CHAT DO SONI ====================
let soniaChatOpen = false;
let currentConvKey = null;

function initSoniaChat() {
  if (!currentUser) return;
  if (currentUser.id === 'sonia') {
    // Sonia widzi listę zgłoszeń
    document.getElementById('soniaChatTitle').textContent = 'Zgłoszenia od zespołu';
    loadSoniaInbox();
  } else {
    // Zwykły użytkownik — chat z Sonią
    document.getElementById('soniaChatTitle').textContent = 'Zgłoś sprawę do Soni';
    currentConvKey = [currentUser.id, 'sonia'].sort().join(':');
    loadChatHistory(currentConvKey);
  }
}

function toggleSoniaChat() {
  const panel = document.getElementById('soniaChatPanel');
  if (!panel) return;
  
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    panel.classList.remove('minimized');
    soniaChatOpen = true;
    if (currentUser?.id === 'sonia') loadSoniaInbox();
    else if (currentConvKey) loadChatHistory(currentConvKey);
  } else if (!panel.classList.contains('minimized')) {
    panel.classList.add('minimized');
  } else {
    panel.classList.add('hidden');
    panel.classList.remove('minimized');
    soniaChatOpen = false;
  }
}

function minimizeSoniaChat(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('soniaChatPanel');
  if (panel) panel.classList.toggle('minimized');
}

async function loadChatHistory(convKey) {
  const container = document.getElementById('soniaChatMessages');
  if (!container) return;
  try {
    const r = await fetch(`/api/chat/history/${convKey}`);
    const data = await r.json();
    renderChatMessages(container, data.messages || []);
  } catch(e) {
    container.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Rozpocznij rozmowę z Sonią</p>';
  }
}

function renderChatMessages(container, messages) {
  if (messages.length === 0) {
    container.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Brak wiadomości. Opisz sprawę lub problem.</p>';
    return;
  }
  container.innerHTML = '';
  messages.forEach(m => {
    const isMine = m.from === currentUser?.id;
    const div = document.createElement('div');
    div.className = `sonia-msg ${isMine ? 'sonia-msg-mine' : 'sonia-msg-other'}`;
    const time = m.ts ? new Date(m.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
    // Pokaż imię nadawcy
    const senderName = isMine ? 'Ty' : (m.fromName || m.from || '?');
    div.innerHTML = `
      <div class="sonia-msg-sender">${escHtml(senderName)}</div>
      <div class="sonia-msg-text">${escHtml(m.text)}</div>
      <div class="sonia-msg-time">${time}</div>
    `;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendSoniaMessage() {
  const input = document.getElementById('soniaChatInput');
  const text = input?.value?.trim();
  if (!text || !currentUser) return;

  let toUserId = 'sonia';
  // Jeśli Sonia pisze — do kogo?
  if (currentUser.id === 'sonia' && currentConvKey) {
    toUserId = currentConvKey.split(':').find(id => id !== 'sonia') || 'sonia';
  }

  try {
    await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: currentUser.id, toUserId, text })
    });
    input.value = '';
    if (currentConvKey) loadChatHistory(currentConvKey);
  } catch(e) {
    showToast('Błąd wysyłania wiadomości', 'error');
  }
}

async function loadSoniaInbox() {
  const inbox = document.getElementById('soniaInbox');
  const msgs  = document.getElementById('soniaChatMessages');
  const inputRow = document.querySelector('.sonia-chat-input-row');
  if (!inbox) return;

  // Jeśli Sonia ogląda konkretną konwersację — pokaż ją z przyciskiem powrotu
  if (currentConvKey) {
    inbox.style.display = 'none';
    msgs.style.display = '';
    if (inputRow) inputRow.style.display = '';
    const titleEl = document.getElementById('soniaChatTitle');
    const otherUserId = currentConvKey.split(':').find(id => id !== 'sonia');
    if (titleEl) titleEl.innerHTML = `<span onclick="soniaGoBackToInbox()" style="cursor:pointer;opacity:0.7;margin-right:6px;">←</span> ${escHtml(otherUserId)}`;
    loadChatHistory(currentConvKey);
    // Dodaj przycisk "Problem rozwiązany" w nagłówku
    let resolveBtn = document.getElementById('soniaChatResolveBtn');
    if (!resolveBtn) {
      resolveBtn = document.createElement('button');
      resolveBtn.id = 'soniaChatResolveBtn';
      resolveBtn.className = 'btn-resolve-chat';
      resolveBtn.textContent = '✓ Problem rozwiązany';
      resolveBtn.onclick = (e) => { e.stopPropagation(); markChatResolved(); };
      const actions = document.querySelector('.sonia-chat-panel .widget-actions');
      if (actions) actions.insertBefore(resolveBtn, actions.firstChild);
    }
    resolveBtn.style.display = '';
    return;
  }

  // Inaczej — lista konwersacji
  inbox.style.display = '';
  msgs.style.display = 'none';
  if (inputRow) inputRow.style.display = 'none';
  const resolveBtn = document.getElementById('soniaChatResolveBtn');
  if (resolveBtn) resolveBtn.style.display = 'none';

  try {
    const r = await fetch('/api/chat/sonia-inbox');
    const data = await r.json();
    const convs = data.conversations || [];
    if (convs.length === 0) {
      inbox.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Brak wiadomości</p>';
      return;
    }
    inbox.innerHTML = '';
    convs.forEach(c => {
      const div = document.createElement('div');
      div.className = 'sonia-inbox-item';
      div.onclick = () => { currentConvKey = c.convKey; loadSoniaInbox(); };
      div.innerHTML = `
        <div style="font-weight:500;font-size:13px;">${escHtml(c.otherUserName)} ${c.unread > 0 ? `<span style="background:#e74c3c;color:#fff;font-size:10px;padding:1px 5px;border-radius:8px;margin-left:4px;">${c.unread}</span>` : ''}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(c.lastMessage)}</div>
      `;
      inbox.appendChild(div);
    });
  } catch(e) {
    inbox.innerHTML = '<p style="padding:12px;color:red;font-size:12px;">Błąd</p>';
  }
}

async function markChatResolved() {
  if (!currentConvKey) return;
  // Wyślij wiadomość systemową o zamknięciu
  try {
    await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromUserId: currentUser?.id || 'sonia',
        toUserId: currentConvKey.split(':').find(id => id !== (currentUser?.id || 'sonia')) || 'sonia',
        text: '✅ Problem został oznaczony jako rozwiązany.'
      })
    });
    showToast('✅ Problem oznaczony jako rozwiązany', 'success');
    // Odśwież konwersację
    loadChatHistory(currentConvKey);
    // Wróć do listy po 1.5s
    setTimeout(() => {
      soniaGoBackToInbox();
    }, 1500);
  } catch(e) {
    showToast('Błąd', 'error');
  }
}

function soniaGoBackToInbox() {
  currentConvKey = null;
  const titleEl = document.getElementById('soniaChatTitle');
  if (titleEl) titleEl.textContent = 'Zgłoszenia od zespołu';
  const resolveBtn = document.getElementById('soniaChatResolveBtn');
  if (resolveBtn) resolveBtn.style.display = 'none';
  loadSoniaInbox();
}

function switchSoniaTab(tab) {
  const chatTab = document.getElementById('soniaChatTab');
  const historyTab = document.getElementById('soniaHistoryTab');
  const chatMsgs = document.getElementById('soniaChatMessages');
  const historyMsgs = document.getElementById('soniaChatHistory');
  const inputRow = document.querySelector('.sonia-chat-input-row');
  const inbox = document.getElementById('soniaInbox');

  if (tab === 'chat') {
    if (chatTab) chatTab.classList.add('active');
    if (historyTab) historyTab.classList.remove('active');
    if (historyMsgs) historyMsgs.style.display = 'none';
    if (inputRow) inputRow.style.display = '';
    // Pokaż czat lub inbox
    if (currentUser?.id === 'sonia') {
      if (inbox) inbox.style.display = '';
      if (chatMsgs) chatMsgs.style.display = 'none';
    } else {
      if (inbox) inbox.style.display = 'none';
      if (chatMsgs) chatMsgs.style.display = '';
      if (currentConvKey) loadChatHistory(currentConvKey);
    }
  } else {
    // Historia
    if (historyTab) historyTab.classList.add('active');
    if (chatTab) chatTab.classList.remove('active');
    if (chatMsgs) chatMsgs.style.display = 'none';
    if (inbox) inbox.style.display = 'none';
    if (inputRow) inputRow.style.display = 'none';
    if (historyMsgs) historyMsgs.style.display = '';
    loadSoniaChatHistory();
  }
}

async function loadSoniaChatHistory() {
  const container = document.getElementById('soniaChatHistory');
  if (!container) return;
  container.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Wczytywanie historii...</p>';
  try {
    // Pobierz pełną historię konwersacji
    const convKey = currentConvKey || (currentUser ? [currentUser.id, 'sonia'].sort().join(':') : null);
    if (!convKey) {
      container.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Brak historii</p>';
      return;
    }
    const r = await fetch(`/api/chat/history/${convKey}?limit=100`);
    const data = await r.json();
    const messages = data.messages || [];
    if (messages.length === 0) {
      container.innerHTML = '<p style="padding:12px;color:#888;font-size:12px;">Brak historii czatu</p>';
      return;
    }
    container.innerHTML = '';
    // Grupuj po dniach
    let lastDate = '';
    messages.forEach(m => {
      const msgDate = m.ts ? new Date(m.ts).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      if (msgDate && msgDate !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'sonia-date-sep';
        sep.textContent = msgDate;
        container.appendChild(sep);
        lastDate = msgDate;
      }
      const isMine = m.from === currentUser?.id;
      const div = document.createElement('div');
      div.className = `sonia-msg ${isMine ? 'sonia-msg-mine' : 'sonia-msg-other'}`;
      const time = m.ts ? new Date(m.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
      const senderName = isMine ? 'Ty' : (m.fromName || m.from || '?');
      div.innerHTML = `
        <div class="sonia-msg-sender">${escHtml(senderName)}</div>
        <div class="sonia-msg-text">${escHtml(m.text)}</div>
        <div class="sonia-msg-time">${time}</div>
      `;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  } catch(e) {
    container.innerHTML = '<p style="padding:12px;color:red;font-size:12px;">Błąd wczytywania historii</p>';
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initLoginScreen();
});

function updateClock() {
  const now = new Date();
  // Stary zegar (jeśli istnieje)
  const el = document.getElementById('currentTime');
  if (el) el.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // Nowy zegar w nagłówku
  const timeEl = document.getElementById('clockTime');
  const dateEl = document.getElementById('clockDate');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });
  // Aktualizuj info o użytkowniku w nagłówku
  const headerName = document.getElementById('headerUserName');
  const headerRole = document.getElementById('headerUserRole');
  const headerAvatar = document.getElementById('headerUserAvatar');
  if (headerName && currentUser) headerName.textContent = currentUser.name || 'Użytkownik';
  if (headerRole && currentUser) {
    const roleLabels = { reception: 'RECEPCJA', opiekun: 'OPIEKUN PACJENTA', admin: 'ADMINISTRACJA' };
    headerRole.textContent = roleLabels[currentUser.role] || (currentUser.role || 'RECEPCJA').toUpperCase();
  }
  if (headerAvatar && currentUser) headerAvatar.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
}

function setUserRole(role) {
  currentUserRole = role;
  localStorage.setItem('nav_role', role);
  // Pokaż/ukryj elementy admin-only
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  // Pokaż/ukryj elementy reception-only
  document.querySelectorAll('.reception-only').forEach(el => {
    el.style.display = (role === 'reception' || role === 'opiekun') ? '' : 'none';
  });
  // Admin: ukryj widok połączeń w sidebarze (punkt 9)
  const callsMenuItem = document.querySelector('[data-view="calls"]');
  if (callsMenuItem) {
    callsMenuItem.style.display = role === 'admin' ? 'none' : '';
  }
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
    case 'CHAT_PRIVATE':
      // Odśwież chat jeśli dotyczy naszej konwersacji
      if (data.convKey === currentConvKey && soniaChatOpen) {
        loadChatHistory(currentConvKey);
      }
      // Badge dla Soni
      if (currentUser?.id === 'sonia' && data.msg?.to === 'sonia') {
        const badge = document.getElementById('soniaChatBadge');
        if (badge) { badge.style.display = ''; badge.textContent = '!'; }
      }
      // Badge dla zwykłego użytkownika (wiadomość od Soni)
      if (data.msg?.from === 'sonia' && data.msg?.to === currentUser?.id) {
        const badge = document.getElementById('soniaChatBadge');
        if (badge && !soniaChatOpen) { badge.style.display = ''; badge.textContent = '!'; }
        if (soniaChatOpen && currentConvKey === data.convKey) loadChatHistory(currentConvKey);
      }
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
  // Ukryj przycisk Odbierz
  const answerBtn = document.getElementById('popupAnswerBtn');
  if (answerBtn) answerBtn.style.display = 'none';
  // Odblokuj formularz raportu
  const overlay = document.getElementById('reportBlockOverlay');
  if (overlay) overlay.classList.add('hidden');
  // Uruchom timer od momentu odebrania
  if (activeCallId === data.callId) startCallTimer();
}

function handleCallEnded(data) {
  const idx = allCalls.findIndex(c => c.callId === data.callId);
  if (idx >= 0) allCalls[idx] = { ...allCalls[idx], status: 'ended', tag: data.tag, duration: data.duration };
  if (currentView === 'calls') renderCallsTable(allCalls);

  if (data.tag === 'connected') startRecordingPoller(data.callId);

  if (activeCallId === data.callId) {
    stopCallTimer(); // ← zawsze zatrzymaj timer
    if (data.tag === 'missed' || data.tag === 'ineffective') {
      closeCallPopup();
    }
    const tagEl = document.getElementById('popupCallTag');
    if (tagEl) {
      const labels = { connected: 'POŁĄCZONO', missed: 'NIEODEBRANE', ineffective: 'NIESKUTECZNE' };
      const classes = { connected: 'tag-connected', missed: 'tag-missed', ineffective: 'tag-ineffective' };
      tagEl.textContent = labels[data.tag] || data.tag;
      tagEl.className = `call-tag ${classes[data.tag] || ''}`;
      tagEl.style.display = 'inline-block';
    }
  }
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
  const ineffective = today.filter(c => c.tag === 'ineffective').length;
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('kpi-calls', today.length);
  setEl('kpi-missed', missed);
  setEl('kpi-to-call', missed + ineffective);
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
  if (view === 'calls') {
    loadCalls();
    // Pokaż/ukryj filtry admina
    const isAdm = currentUser?.role === 'admin';
    const stEl = document.getElementById('admin-filter-station');
    const agEl = document.getElementById('admin-filter-agent');
    if (stEl) stEl.style.display = isAdm ? 'flex' : 'none';
    if (agEl) agEl.style.display = isAdm ? 'flex' : 'none';
  }
  if (view === 'stats') loadAndRenderStats();
  if (view === 'tasks') loadTasks();
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
      oppId: opp.id,
      stageId: opp.pipelineStageId || '',
      stageName: GHL_STAGE_NAMES[opp.pipelineStageId] || ''
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

  const activeFilter = document.querySelector('.source-filter-btn.active')?.dataset?.source || 'all';
  const filtered = activeFilter === 'all' ? leads : leads.filter(l =>
    (l.tags || []).some(t => t.toLowerCase().includes(activeFilter.toLowerCase())) ||
    (l.source || '').toLowerCase().includes(activeFilter.toLowerCase())
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak zgłoszeń dla wybranego filtra</div>';
    return;
  }

  const allSources = [...new Set(leads.flatMap(l => [...(l.tags || []), l.source].filter(Boolean)))];
  renderSourceFilters(allSources);

  // Ustaw kontener na rzędy
  listEl.style.display = 'flex';
  listEl.style.flexDirection = 'column';
  listEl.style.gap = '12px';
  
  listEl.innerHTML = '';
  filtered.forEach(lead => {
    const card = createLeadCard(lead);
    // Dostosuj kartę do układu rzędowego
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.width = '100%';
    card.style.padding = '12px 20px';
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
  div.style.display = 'flex';
  div.style.alignItems = 'center';
  div.style.gap = '20px';
  div.style.padding = '12px 24px';

  const sourceTags = [...new Set([...(lead.tags || []), lead.source].filter(Boolean))];
  const sourceTagsHtml = sourceTags.map(t => getSourceLabel(t)).join('');
  const ageHtml = getLeadAgeLabel(lead.createdAt);
  const stageHtml = lead.stageName
    ? `<span class="lead-stage-tag" style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600;">${escHtml(lead.stageName)}</span>`
    : '';
  const phoneHtml = lead.phone
    ? `<div class="lead-phone" style="font-weight:600; color:#3b82f6;">📞 ${lead.phone}</div>`
    : `<div class="lead-phone no-phone" style="color:#94a3b8;">Brak numeru</div>`;

  div.innerHTML = `
    <div class="lead-avatar" style="width:40px; height:40px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-weight:700; color:#475569; flex-shrink:0;">
      ${(lead.name || 'P').charAt(0).toUpperCase()}
    </div>
    <div class="lead-info" style="flex:1; display:flex; align-items:center; gap:24px;">
      <div style="min-width:180px;">
        <div class="lead-name" style="font-weight:700; color:#1e293b; font-size:15px;">${escHtml(lead.name)}</div>
        <div style="display:flex; gap:6px; margin-top:4px;">${stageHtml}${ageHtml}</div>
      </div>
      <div style="min-width:140px;">${phoneHtml}</div>
      <div style="flex:1; min-width:0;">
        ${lead.zglosza
          ? `<div style="font-size:13px; color:#1e293b; font-style:italic; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:280px; padding:4px 10px; background:#f0f9ff; border-left:3px solid #3b82f6; border-radius:0 6px 6px 0;" title="${escHtml(lead.zglosza)}">"​${escHtml(lead.zglosza)}"</div>`
          : '<div style="font-size:12px;color:#cbd5e1;">Brak opisu</div>'}
      </div>
      <div style="display:flex; gap:4px;">${sourceTagsHtml}</div>
    </div>
    <div class="lead-actions" style="display:flex; gap:8px; flex-shrink:0;">
      ${lead.phone ? `<button class="btn-call" style="padding:6px 12px;" onclick="initiateCall('${escHtml(lead.phone)}', '${escHtml(lead.name)}', '${lead.contactId}', '${lead.id}')">📞</button>` : ''}
      <button class="btn-report" style="padding:6px 12px; font-size:12px;" onclick="openCallPopupForLead('${lead.contactId}', '${escHtml(lead.name)}', '${escHtml(lead.phone)}', '${escHtml(lead.zglosza)}', '${lead.id}')">📋 Raport</button>
      <button class="btn-edit edit-request-btn" style="padding:6px 12px; font-size:12px;" onclick="openEditRequest('${lead.contactId}', '${escHtml(lead.name)}')">✏️</button>
      <button class="btn-delete admin-only" style="display:${currentUserRole === 'admin' ? 'inline-flex' : 'none'}; padding:6px 12px;" onclick="deleteLead('${lead.id}', this)">✕</button>
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
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== CALLS — BLOK C ====================
async function loadCalls() {
  try {
    const uid = currentUser?.id || '';
    const rol = currentUser?.role || 'reception';
    const r = await fetch(`/api/calls?days=7&userId=${uid}&role=${rol}`);
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

  // Admin: filtr po stanowisku/osobie
  const isAdmin = currentUser?.role === 'admin';
  const activeStation = document.getElementById('filter-station')?.value || 'all';
  const activeAgent   = document.getElementById('filter-agent')?.value || 'all';
  
  let finalFiltered = filtered;
  if (isAdmin) {
    if (activeStation !== 'all') {
      const extMap = { reception: '103', agata_o: '101', aneta_o: '102' };
      const ext = extMap[activeStation];
      if (ext) finalFiltered = finalFiltered.filter(c => {
        const from = String(c.from || ''); const to = String(c.to || '');
        return from === ext || to === ext || from.endsWith(ext) || to.endsWith(ext) || c.userId === activeStation;
      });
    }
    if (activeAgent !== 'all') {
      finalFiltered = finalFiltered.filter(c => c.userId === activeAgent);
    }
  } else {
    finalFiltered = filtered;
  }

  // Admin filter bar
  const adminFilterBar = isAdmin ? `
    <div style="display:flex;gap:10px;align-items:center;padding:10px 0;flex-wrap:wrap;">
      <label style="font-size:12px;font-weight:600;color:#64748b;">Stanowisko:</label>
      <select id="filter-station" onchange="renderCallsTable(allCalls)" style="font-size:12px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;">
        <option value="all">Wszystkie</option>
        <option value="reception">📞 Recepcja (103)</option>
        <option value="agata_o">👤 Agata Opiekun (101)</option>
        <option value="aneta_o">👤 Aneta Opiekun (102)</option>
      </select>
      <label style="font-size:12px;font-weight:600;color:#64748b;">Osoba:</label>
      <select id="filter-agent" onchange="renderCallsTable(allCalls)" style="font-size:12px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;">
        <option value="all">Wszyscy</option>
        <option value="kasia">Kasia</option>
        <option value="agnieszka">Agnieszka</option>
        <option value="asia">Asia</option>
        <option value="agata_r">Agata (Rec.)</option>
        <option value="zastepstwo">Zastępstwo</option>
        <option value="agata_o">Agata Opiekun</option>
        <option value="aneta_o">Aneta Opiekun</option>
      </select>
    </div>` : '';

  container.innerHTML = adminFilterBar + `
    <table class="calls-table">
      <thead>
        <tr>
          <th>Pacjent / Numer</th>
          <th>Status pacjenta</th>
          <th>Kierunek</th>
          <th>Połączenie</th>
          <th>Wynik rozmowy</th>
          <th>Data</th>
          <th>Godzina</th>
          <th>Czas trwania</th>
          ${isAdmin ? '<th>Agent</th>' : ''}
          <th>Rozmowa</th>
          <th>Nagranie</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>
        ${finalFiltered.map(c => renderCallRow(c, isAdmin)).join('')}
      </tbody>
    </table>
  `;
}

function renderCallRow(c, isAdmin = false) {
  const ts = c.timestamp ? new Date(c.timestamp) : null;
  const date = ts ? ts.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const time = ts ? ts.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const dur = c.duration ? formatDuration(c.duration) : '—';
  const dirIcon = c.direction === 'outbound' ? '📤' : '📞';
  const dirLabel = c.direction === 'outbound' ? 'Wychodzące' : 'Przychodzące';

  // Tag (C3)
  const tagHtml = c.tag ? `<span class="call-tag tag-${c.tag}">${tagLabel(c.tag)}</span>` : '<span style="color:#94a3b8;font-size:11px;">—</span>';

  // Wynik rozmowy (z raportu)
  const outcomeHtml = c.callEffect
    ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${escHtml(c.callEffect)}</div>` : '';

  // Notatka z raportu
  const noteHtml = c.notes
    ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;font-style:italic;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(c.notes)}">${escHtml(c.notes)}</div>` : '';

  // Nagranie (D1)
  const recHtml = c.recordingUrl
    ? `<audio controls src="${c.recordingUrl}" class="call-recording-player"></audio>
       <a href="${c.recordingUrl}" download class="btn-download-rec" title="Pobierz">↓</a>`
    : c.tag === 'connected'
      ? `<span data-rec-callid="${escHtml(c.callId)}" class="btn-rec-pending" title="Nagranie pojawi się po zakończeniu przetwarzania">⏳ Oczekuje...</span>`
      : `<button class="btn-fetch-rec" onclick="fetchRecording('${c.callId}', this)" title="Sprawdź nagranie">▶ Sprawdź</button>`;

  // Kto obsługiwał
  // Agent name mapping
  const agentNames = {
    kasia: 'Kasia', agnieszka: 'Agnieszka', asia: 'Asia', agata_r: 'Agata (Rec.)',
    zastepstwo: 'Zastępstwo', agata_o: 'Agata Opiekun', aneta_o: 'Aneta Opiekun',
    bartosz: 'Bartosz', sandra: 'Sandra', aneta_a: 'Aneta (A)', patrycja: 'Patrycja', sonia: 'Sonia'
  };
  const agentName = c.userId ? (agentNames[c.userId] || c.userId) : null;
  const agentHtml = agentName
    ? `<div style="font-size:11px;color:#64748b;">👤 ${escHtml(agentName)}</div>` : '';
  // Agent role tag for admin column
  const agentRoles = { agata_o: 'opiekun', aneta_o: 'opiekun' };
  const agentRole = c.userId ? (agentRoles[c.userId] || 'reception') : null;
  const agentTagHtml = agentName
    ? `<div style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:12px;font-weight:600;color:#1e293b;">👤 ${escHtml(agentName)}</span>
        <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${agentRole === 'opiekun' ? '#dbeafe' : '#dcfce7'};color:${agentRole === 'opiekun' ? '#1d4ed8' : '#166534'};font-weight:600;">${agentRole === 'opiekun' ? 'Opiekun' : 'Recepcja'}</span>
       </div>`
    : '<span style="color:#94a3b8;font-size:11px;">—</span>';

  // Etap lejka
  const stageHtml = getStageTagHtml(c.stageId, c.stageName);

  // Status pacjenta z raportu
  const contactTypeMap = {
    'NOWY_PACJENT':    { label: 'Nowy pacjent',    cls: 'ct-new' },
    'STALY_PACJENT':   { label: 'Stały pacjent',   cls: 'ct-regular' },
    'WIZYTA_BIEZACA':  { label: 'Bieżąca wizyta',  cls: 'ct-visit' },
    'SPAM':            { label: 'Pomyłka/SPAM',    cls: 'ct-spam' }
  };
  const ctInfo = contactTypeMap[c.contactType];
  const contactTypeHtml = ctInfo
    ? `<span class="contact-type-tag ${ctInfo.cls}">${ctInfo.label}</span>`
    : '<span style="color:#94a3b8;font-size:11px;">—</span>';

  // Program z raportu
  const programHtml = c.program
    ? `<span class="program-tag">${escHtml(c.program)}</span>`
    : '<span style="color:#94a3b8;font-size:11px;">—</span>';

  // Status raportu — czerwony dla WSZYSTKICH zakończonych bez raportu
  const hasReport = !!(c.contactType || c.callEffect);
  const isEnded = c.status === 'ended' || c.tag === 'connected' || c.tag === 'missed' || c.tag === 'ineffective';
  const reportStatusHtml = hasReport
    ? `<span class="report-tag report-done">✓ Uzupełniony</span>`
    : (isEnded
      ? `<span class="report-tag report-missing" onclick="event.stopPropagation();openCallReport('${escHtml(c.callId)}')" title="Kliknij aby uzupełnić raport">⚠ Uzupełnij raport</span>`
      : '<span style="color:#94a3b8;font-size:11px;">—</span>');

  return `
    <tr class="call-row" onclick="openCallReport('${c.callId}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="call-avatar ${c.direction === 'outbound' ? 'av-out' : 'av-in'}">${(c.contactName || (c.from !== '0' ? c.from : '') || (c.to !== '0' ? c.to : '') || '?').charAt(0).toUpperCase()}</div>
          <div class="call-name-cell">
            <div class="call-name">${escHtml(c.contactName || (c.from !== '0' ? c.from : '') || (c.to !== '0' ? c.to : '') || 'Nieznany')}</div>
            <div class="call-number">${escHtml((c.from !== '0' ? c.from : '') || (c.to !== '0' ? c.to : '') || '')}</div>
            <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">${stageHtml}${outcomeHtml}</div>
          </div>
        </div>
      </td>
      <td>${contactTypeHtml}</td>
      <td><span style="font-size:13px;">${dirIcon}</span> <span style="font-size:12px;color:#64748b;">${dirLabel}</span></td>
      <td>${tagHtml}</td>
      <td>${reportStatusHtml}</td>
      <td><div style="font-size:13px;font-weight:600;color:#1e293b;">${date}</div></td>
      <td><div style="font-size:13px;font-weight:600;color:#1e293b;">${time}</div></td>
      <td><div style="font-size:13px;font-weight:600;color:#1e293b;">${dur}</div></td>
      ${isAdmin ? `<td onclick="event.stopPropagation()">${agentTagHtml}</td>` : ''}
      <td onclick="event.stopPropagation()">${recHtml}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${(c.from || c.to) ? `<button class="btn-call btn-sm" onclick="initiateCall('${c.from || c.to}', '${escHtml(c.contactName || '')}')">📞 Oddzwoń</button>` : ''}
          ${noteHtml}
        </div>
      </td>
    </tr>
  `;
}

function tagLabel(tag) {
  const labels = { connected: 'POŁĄCZONO', missed: 'NIEODEBRANE', ineffective: 'NIESKUTECZNE' };
  return labels[tag] || tag.toUpperCase();
}

// Etap lejka jako tag HTML
function getStageTagHtml(stageId, stageName) {
  if (!stageId && !stageName) return '';
  const name = stageName || GHL_STAGE_NAMES[stageId] || stageId;
  const stageClass = {
    'Nowe zgłoszenie': 'stage-new',
    '1 próba kontaktu': 'stage-attempt1',
    '2 próba kontaktu': 'stage-attempt2',
    'Follow-up dzień 2': 'stage-followup',
    'Follow-up dzień 4': 'stage-followup',
    'Brak kontaktu': 'stage-refused',
    'Po rozmowie': 'stage-after-call',
    'Umówiony W0': 'stage-booked',
    'No-show': 'stage-noshow',
    'Odmówił': 'stage-refused'
  }[name] || 'stage-new';
  return `<span class="call-stage-tag ${stageClass}">${escHtml(name)}</span>`;
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
      // Zaktualizuj tylko komórkę — bez przeładowania całej tabeli
      const cell = btn.closest('td');
      if (cell) {
        cell.innerHTML = `<audio controls src="${data.url}" class="call-recording-player"></audio>
          <a href="${data.url}" download class="btn-download-rec" title="Pobierz">↓</a>`;
      }
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

async function openCallReport(callId) {
  const call = allCalls.find(c => c.callId === callId);
  if (!call) return;

  // Ustaw kontakt i otwórz popup
  currentOpportunity = call.oppId ? { id: call.oppId } : null;
  activeCallId = callId;

  openCallPopup({
    id: call.contactId || 'unknown',
    name: call.contactName || call.from || 'Nieznany',
    phone: call.from || call.to || '',
    zglosza: '',
    callId: callId,
    direction: call.direction || 'inbound'
  });

  // Odblokuj raport (bo połączenie już zakończone)
  const overlay = document.getElementById('reportBlockOverlay');
  if (overlay) overlay.classList.add('hidden');

  // Pokaż tag zakończenia
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl && call.tag) {
    const labels = { connected: 'POŁĄCZONO', missed: 'NIEODEBRANE', ineffective: 'NIESKUTECZNE' };
    const classes = { connected: 'tag-connected', missed: 'tag-missed', ineffective: 'tag-ineffective' };
    tagEl.textContent = labels[call.tag] || call.tag;
    tagEl.className = `call-tag ${classes[call.tag] || ''}`;
    tagEl.style.display = 'inline-block';
  }

  // Ukryj timer i hangup (połączenie zakończone)
  const timerEl = document.getElementById('callTimer');
  if (timerEl) { timerEl.textContent = call.duration ? formatDuration(call.duration) : '—'; timerEl.classList.remove('hidden'); }
  const hangupBtn = document.getElementById('popupHangupBtn');
  if (hangupBtn) hangupBtn.classList.add('hidden');
  const answerBtn = document.getElementById('popupAnswerBtn');
  if (answerBtn) answerBtn.style.display = 'none';

  // Pokaż nagranie w popup (punkt 7)
  updatePopupRecording(call.recordingUrl, callId);

  // Załaduj zapisany raport z serwera (punkt 5 — edycja po zakończeniu)
  try {
    const r = await fetch(`/api/calls/${callId}/report`);
    if (r.ok) {
      const report = await r.json();
      if (report.contactType) {
        // Wypełnij formularz zapisanymi danymi
        selectStatus(report.contactType);
        if (report.program) {
          const progEl = document.getElementById('programLeczenia');
          if (progEl) progEl.value = report.program;
        }
        if (report.outcome) selectOutcome(report.outcome);
        if (report.notes) {
          // Wpisz notatki w odpowiednie pole
          const noteFields = ['stalyNotatka', 'spamNotatka', 'powodRezygnacji', 'powodOdwolania', 'powodZmiany'];
          noteFields.forEach(fid => { const el = document.getElementById(fid); if (el) el.value = report.notes; });
        }
        if (report.contactName) {
          const manualNameInput = document.getElementById('manualPatientName');
          if (manualNameInput) manualNameInput.value = report.contactName;
        }
        if (report.recordingUrl) updatePopupRecording(report.recordingUrl, callId);
      }
    }
  } catch(e) { console.error('Load report error:', e); }

  // Usuń z listy niedokończonych raportów
  removePendingReport(callId);
}

function updatePopupRecording(url, callId) {
  const recContainer = document.getElementById('popupRecordingSection');
  if (!recContainer) return;
  if (url) {
    recContainer.innerHTML = `
      <div style="margin-top:8px;padding:10px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <div style="font-size:12px;font-weight:600;color:#166534;margin-bottom:6px;">🎙️ Nagranie rozmowy</div>
        <audio controls src="${url}" style="width:100%;height:36px;"></audio>
        <a href="${url}" download style="font-size:11px;color:#3b82f6;margin-top:4px;display:inline-block;">⬇ Pobierz</a>
      </div>`;
    recContainer.style.display = '';
  } else if (callId) {
    recContainer.innerHTML = `
      <div style="margin-top:8px;padding:10px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
        <button class="btn-secondary" style="font-size:12px;" onclick="tryFetchPopupRecording('${callId}')">🎙️ Sprawdź nagranie</button>
      </div>`;
    recContainer.style.display = '';
  } else {
    recContainer.style.display = 'none';
  }
}

async function tryFetchPopupRecording(callId) {
  try {
    const r = await fetch(`/api/call/${callId}/recording`);
    const data = await r.json();
    if (data.url) {
      updatePopupRecording(data.url, callId);
      showToast('🎙️ Nagranie gotowe', 'success');
    } else {
      showToast('Nagranie jeszcze niedostępne', 'info');
    }
  } catch(e) { showToast('Błąd pobierania nagrania', 'error'); }
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
  // Przycisk Odbierz - tylko dla połączeń przychodzących
  if (answerBtn) answerBtn.style.display = contact.direction === 'inbound' ? 'inline-flex' : 'none';
  // Przycisk Rozłącz i timer - widoczne tylko gdy połączenie trwa (startCallTimer je pokaże)
  // Dla wychodzących startCallTimer() jest wywoływane niżej, więc hangup pojawi się automatycznie

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

  // Ustawienie nazwy pacjenta w polu manualnym (jeśli mamy ją z obiektu połączenia)
  const manualNameInput = document.getElementById('manualPatientName');
  if (manualNameInput) {
    manualNameInput.value = contact.name || '';
  }

  // Blokada W0: jeśli kontakt ma zaplanowane W0, pokaż ostrzeżenie i zablokuj kafelek
  const w0Notice = document.getElementById('w0BlockNotice');
  const newPatientTile = document.getElementById('tile-NOWY_PACJENT');
  if (w0Notice && newPatientTile) {
    if (contact.w0_scheduled) {
      w0Notice.classList.remove('hidden');
      newPatientTile.style.opacity = '0.4';
      newPatientTile.style.cursor = 'not-allowed';
      newPatientTile.title = 'Ten pacjent ma już zaplanowane W0';
    } else {
      w0Notice.classList.add('hidden');
      newPatientTile.style.opacity = '';
      newPatientTile.style.cursor = '';
      newPatientTile.title = '';
    }
  }

  // Czas reakcji — pokaż jeśli znamy lead_created_at
  const respIndicator = document.getElementById('responseTimeIndicator');
  const respText = document.getElementById('responseTimeText');
  if (respIndicator && respText && contact.lead_created_at) {
    const leadCreatedAt = new Date(contact.lead_created_at);
    const now = new Date();
    const diffMins = Math.round((now - leadCreatedAt) / 60000);
    let color = '#16a34a', label = 'OK';
    if (diffMins >= 120) { color = '#dc2626'; label = '🔴 PILNE'; }
    else if (diffMins >= 5) { color = '#d97706'; label = '⚠️'; }
    respText.textContent = `⏱ Czas reakcji: ${diffMins} min ${label}`;
    respText.style.color = color;
    respIndicator.classList.remove('hidden');
  } else if (respIndicator) {
    respIndicator.classList.add('hidden');
  }

  resetReportForm();
  document.getElementById('callPopup').classList.remove('hidden');

  // Pokaż nakładkę blokującą raport podczas dzwonienia
  const overlay = document.getElementById('reportBlockOverlay');
  if (overlay) {
    if (contact.direction === 'outbound') {
      // Wychodzące — raport od razu dostępny
      overlay.classList.add('hidden');
    } else {
      // Przychodzące — czekamy na odebranie
      overlay.classList.remove('hidden');
    }
  }

  // Timer startuje dopiero po odebraniu połączenia (CALL_ANSWERED)
  // Dla połączeń wychodzących: etap wywoływania NIE wlicza się do czasu rozmowy
  // Timer zostanie uruchomiony przez handleCallAnswered()
  stopCallTimer();
  const timerEl = document.getElementById('callTimer');
  if (timerEl) { timerEl.textContent = '⏳ Oczekiwanie...'; timerEl.classList.remove('hidden'); }
  // Pokaż przycisk rozłącz od razu (żeby można było rozłączyć w trakcie dzwonienia)
  const hangupBtnInit = document.getElementById('popupHangupBtn');
  if (hangupBtnInit) { hangupBtnInit.classList.remove('hidden'); hangupBtnInit.style.display = ''; }
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

async function hangupCall() {
  const tagEl = document.getElementById('popupCallTag');
  if (tagEl) { tagEl.textContent = 'ROZŁĄCZONO'; tagEl.className = 'call-tag tag-missed'; tagEl.style.display = 'inline-block'; }
  stopCallTimer();

  // Wyślij żądanie rozłączenia do serwera → Zadarma API
  if (activeCallId) {
    try {
      await fetch('/api/call/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: activeCallId })
      });
    } catch(e) { console.error('[Hangup] Error:', e); }
  }

  showToast('📵 Rozłączono', 'info');
  // Nie zamykaj popup od razu — pozwól uzupełnić raport
}

function calculateDelayInDays(targetDateStr) {
  if (!targetDateStr) return '3d';
  const target = new Date(targetDateStr);
  const now = new Date();
  const diffTime = Math.abs(target - now);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return `${diffDays}d`;
}

function closeCallPopup(force = false) {
  // Ostrzeżenie jeśli raport nieuzupełniony (punkt 6)
  if (!force && activeCallId && !selectedStatus) {
    const callInStore = allCalls.find(c => c.callId === activeCallId);
    // Tylko dla zakończonych połączeń, które trwały (nie missed/ineffective)
    if (callInStore?.tag === 'connected' || callInStore?.status === 'active') {
      if (!confirm('⚠️ Raport nieuzupełniony — czy na pewno chcesz wyjść?\n\nMożesz wrócić do raportu z widoku Połączenia.')) {
        return;
      }
      // Dodaj do listy niedokończonych raportów
      addPendingReport(activeCallId, callInStore?.contactName || callInStore?.from);
    }
  }
  document.getElementById('callPopup').classList.add('hidden');
  stopCallTimer();
  currentContact = null;
  selectedStatus = null;
  selectedOutcome = null;
  activeCallId = null;
}

// Lista niedokończonych raportów (punkt 6 — przypomnienia)
let pendingReports = [];

function addPendingReport(callId, contactName) {
  if (pendingReports.find(r => r.callId === callId)) return;
  pendingReports.push({ callId, contactName, addedAt: Date.now() });
  updatePendingReportsBadge();
}

function removePendingReport(callId) {
  pendingReports = pendingReports.filter(r => r.callId !== callId);
  updatePendingReportsBadge();
}

function updatePendingReportsBadge() {
  const indicator = document.getElementById('pendingReportsIndicator');
  if (!indicator) return;
  if (pendingReports.length > 0) {
    indicator.style.display = 'flex';
    indicator.innerHTML = pendingReports.map(r => `
      <div class="pending-report-item" onclick="openCallReport('${r.callId}')">
        ⚠️ Raport do uzupełnienia: <strong>${escHtml(r.contactName || 'Nieznany')}</strong>
      </div>
    `).join('');
  } else {
    indicator.style.display = 'none';
    indicator.innerHTML = '';
  }
}

function startCallTimer() {
  callStartTime = Date.now();
  // Pokaż timer i przycisk rozłącz
  const timerEl = document.getElementById('callTimer');
  const hangupBtn = document.getElementById('popupHangupBtn');
  if (timerEl) timerEl.classList.remove('hidden');
  if (hangupBtn) { hangupBtn.classList.remove('hidden'); hangupBtn.style.display = ''; }

  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const sec = (elapsed % 60).toString().padStart(2, '0');
    const el = document.getElementById('callTimer');
    if (el) el.textContent = `${min}:${sec}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  // Ukryj timer i przycisk rozłącz
  const timerEl = document.getElementById('callTimer');
  const hangupBtn = document.getElementById('popupHangupBtn');
  if (timerEl) { timerEl.textContent = '00:00'; timerEl.classList.add('hidden'); }
  if (hangupBtn) hangupBtn.classList.add('hidden');
}

function resetReportForm() {
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.status-tile').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.report-form').forEach(f => f.classList.add('hidden'));
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.outcome-fields').forEach(f => f.classList.add('hidden'));
  const manualNameInput = document.getElementById('manualPatientName');
  if (manualNameInput) manualNameInput.value = '';
  selectedStatus = null;
  selectedOutcome = null;
}

// ==================== STATUS SELECTION (C7 — 2x2 tiles) ====================
function selectStatus(status) {
  // Blokada: jeśli kontakt ma W0, nie można wybrać "Nowy pacjent"
  if (status === 'NOWY_PACJENT' && currentContact?.w0_scheduled) {
    const notice = document.getElementById('w0BlockNotice');
    if (notice) {
      notice.classList.remove('hidden');
      // Wstrząśnij kafelkiem
      const tile = document.getElementById('tile-NOWY_PACJENT');
      if (tile) { tile.style.animation = 'shake 0.3s'; setTimeout(() => tile.style.animation = '', 400); }
    }
    return; // Blokuj wybor
  }

  // Ukryj blokadę jeśli wybrano inny status
  const notice = document.getElementById('w0BlockNotice');
  if (notice) notice.classList.add('hidden');

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
function setContactTime(days, btn) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('contactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('.contact-time-buttons .time-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setContactTimeSt(days, btn) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('stalyContactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('#outcome-staly_kontakt .time-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function setContactTimeWizyta(days, btn) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  document.getElementById('wizytaContactDateTime').value = formatDateTimeLocal(date);
  document.querySelectorAll('#outcome-odwolanie .time-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
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

    // Zapisz raport do Supabase przez /api/calls/:callId/report
    if (activeCallId) {
      const notes = reportData.notatka || reportData.powodRezygnacji || reportData.powodOdwolania || reportData.powodZmiany || '';
      const callEffect = reportData.outcome || selectedOutcome || '';
      
      // Reception OS: Follow-up logic
      const followUpDate = document.getElementById('wizytaContactDateTime')?.value;
      const followUpDelay = followUpDate ? calculateDelayInDays(followUpDate) : null;

      try {
        const payload = {
          contactType: selectedStatus,
          callEffect,
          notes,
          program: reportData.program || '',
          outcome: selectedOutcome || '',
          userId: currentUser?.id || '',
          contactId: contactId || '',
          contactName: reportData.manualName || currentContact?.name || '',
          cancellationReason: reportData.powodOdwolania || '',
          w0Date: reportData.w0DateTime || null,
          isFollowUp: !!followUpDelay,
          followUpDelay: followUpDelay
        };

        await fetch(`/api/calls/${activeCallId}/report`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        console.log('[Reception OS] Extended report saved:', payload);
      } catch(e) { console.warn('[Report] Save error:', e.message); }
    }

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
    if (activeCallId) removePendingReport(activeCallId);
    closeCallPopup(true); // force close (raport zapisany)
    
    // Odśwież listy po zapisaniu raportu (żeby statusy się zaktualizowały)
    loadCalls();
    loadContacts();
  } catch (err) {
    showToast(`Błąd zapisu: ${err.message}`, 'error');
  }
}

function buildReportData() {
  const data = { 
    status: selectedStatus, 
    outcome: selectedOutcome,
    manualName: document.getElementById('manualPatientName')?.value || ''
  };
  if (selectedStatus === 'NOWY_PACJENT') {
    data.program = document.getElementById('programLeczenia')?.value;
    if (selectedOutcome === 'umowil_sie') {
      data.dataW0 = document.getElementById('dataW0')?.value;
      data.w0DateTime = data.dataW0;
    }
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
    if (selectedOutcome === 'staly_umowil') {
      data.dataWizyty = document.getElementById('stalyDataWizyty')?.value;
      data.w0DateTime = data.dataWizyty;
    }
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
      // → Przenieś do stage 8: Umówiony W0
      await moveOpportunityToStage(currentOpportunity.id, GHL_STAGE_IDS.BOOKED_W0);
    }
    showToast(`📅 Wizyta umówiona na ${new Date(data.dataW0).toLocaleDateString('pl-PL')}`, 'success');
  } else if (data.outcome === 'prosi_kontakt' && data.contactDateTime) {
    // → Przenieś do stage 7: Po rozmowie (rozważa)
    if (currentOpportunity?.id) {
      await moveOpportunityToStage(currentOpportunity.id, GHL_STAGE_IDS.AFTER_CALL);
    }
    if (contactId && contactId !== 'unknown') {
      const ghlAssignedTo = currentUser?.ghlUserId || null;
      await fetch(`/api/contact/${contactId}/task`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Oddzwoń do ${currentContact?.name || 'pacjenta'}`,
          body: `Pacjent prosi o kontakt. Program: ${data.program || 'nieustalony'}`,
          dueDate: new Date(data.contactDateTime).toISOString(),
          assignedTo: ghlAssignedTo
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
      // → Przenieś do stage: Odmówił
      await moveOpportunityToStage(currentOpportunity.id, GHL_STAGE_IDS.REFUSED);
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
          dueDate: data.contactDateTime ? new Date(data.contactDateTime).toISOString() : new Date(Date.now() + 86400000).toISOString(),
          assignedTo: currentUser?.ghlUserId || null
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
          dueDate: new Date(data.contactDateTime).toISOString(),
          assignedTo: currentUser?.ghlUserId || null
        })
      });
    }
    showToast('📋 Zadanie oddzwonienia utworzone', 'success');
    loadTodayTasks();
  }
}

// ==================== TASKS (F1/F2) ====================
let completedTaskIds = new Set(JSON.parse(localStorage.getItem('completedTaskIds') || '[]'));

async function loadTodayTasks() {
  const listEl = document.getElementById('tasksTodayList');
  if (!listEl) return;
  try {
    const userId = currentUser?.id;
    const r = await fetch(`/api/tasks?userId=${userId}&filter=mine`);
    const data = await r.json();
    const today = new Date().toDateString();
    const todayTasks = (data.tasks || []).filter(t => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate).toDateString() === today;
    });
    renderTodayTasks(listEl, todayTasks);
    const badge = document.getElementById('badge-tasks-nav');
    if (badge) badge.textContent = todayTasks.length || '';
  } catch(e) {
    console.error('loadTodayTasks error:', e);
    listEl.innerHTML = '<div class="empty-state">Brak zadań na dziś</div>';
  }
}

// Cache wszystkich moich zadań (do kalendarza)
let allMyTasksCache = [];

async function loadTasks() {
  const myTasksEl = document.getElementById('tasksMyList');
  const allTasksEl = document.getElementById('tasksAllList');
  const poolTasksEl = document.getElementById('tasksPoolList');

  // Ustaw dziś w nagłówku
  const todayLabel = document.getElementById('tasksTodayDateLabel');
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  try {
    const userId = currentUser?.id;
    const [myResp, allResp, poolResp] = await Promise.all([
      fetch(`/api/tasks?userId=${userId}&filter=mine`),
      fetch(`/api/tasks?filter=all`),
      fetch(`/api/tasks?filter=unassigned`)
    ]);

    const myTasks = (await myResp.json()).tasks || [];
    const allTasks = (await allResp.json()).tasks || [];
    const poolTasks = (await poolResp.json()).tasks || [];

    allMyTasksCache = myTasks;

    // Filtruj zadania na dziś do listy dziennej
    const today = new Date().toDateString();
    const todayTasks = myTasks.filter(t => t.dueDate && new Date(t.dueDate).toDateString() === today);
    const futureTasks = myTasks.filter(t => t.dueDate && new Date(t.dueDate).toDateString() !== today);

    if (myTasksEl) renderTodayTasks(myTasksEl, todayTasks.length > 0 ? todayTasks : myTasks.slice(0, 5));
    if (allTasksEl) renderTasksList(allTasksEl, allTasks, false);
    if (poolTasksEl) renderTasksList(poolTasksEl, poolTasks, false, true);

    if (document.getElementById('badge-tasks-my')) document.getElementById('badge-tasks-my').textContent = myTasks.length;
    if (document.getElementById('badge-tasks-all')) document.getElementById('badge-tasks-all').textContent = allTasks.length;
    if (document.getElementById('badge-tasks-pool')) document.getElementById('badge-tasks-pool').textContent = poolTasks.length;

    // Renderuj kalendarz miesięczny
    renderCalendar(myTasks);

  } catch(e) { console.error('Load tasks error:', e); }
}

// ==================== KALENDARZ MIESIĘCZNY ====================
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

function calendarPrev() {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  renderCalendar(allMyTasksCache);
}

function calendarNext() {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  renderCalendar(allMyTasksCache);
}

function renderCalendar(tasks) {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calendarMonthLabel');
  if (!grid) return;

  const monthNames = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
    'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  if (label) label.textContent = `${monthNames[calendarMonth]} ${calendarYear}`;

  const dayNames = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];
  const today = new Date();
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const lastDay = new Date(calendarYear, calendarMonth + 1, 0);

  // Mapuj zadania na daty
  const tasksByDate = {};
  (tasks || []).forEach(t => {
    if (!t.dueDate) return;
    const d = new Date(t.dueDate);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!tasksByDate[key]) tasksByDate[key] = [];
    tasksByDate[key].push(t);
  });

  // Nagłówki dni
  let html = dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

  // Puste komórki przed pierwszym dniem (Pn=0, Wt=1...)
  let startDow = firstDay.getDay(); // 0=Nd
  startDow = startDow === 0 ? 6 : startDow - 1; // Konwertuj na Pn=0
  for (let i = 0; i < startDow; i++) html += '<div class="calendar-day other-month"></div>';

  // Dni miesiąca
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const isToday = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth && today.getDate() === day;
    const key = `${calendarYear}-${calendarMonth}-${day}`;
    const dayTasks = tasksByDate[key] || [];
    const tasksHtml = dayTasks.slice(0, 2).map(t => {
      const isOverdue = new Date(t.dueDate) < today && !isToday;
      return `<div class="day-task-dot${isOverdue ? ' overdue' : ''}" title="${escHtml(t.title)}">${escHtml(t.title.substring(0, 12))}${t.title.length > 12 ? '...' : ''}</div>`;
    }).join('');
    const moreHtml = dayTasks.length > 2 ? `<div class="day-more">+${dayTasks.length - 2} więcej</div>` : '';

    html += `
      <div class="calendar-day${isToday ? ' today' : ''}" onclick="calendarDayClick(${day})">
        <div class="day-num">${day}</div>
        <div class="day-tasks">${tasksHtml}${moreHtml}</div>
      </div>
    `;
  }

  grid.innerHTML = html;
}

function calendarDayClick(day) {
  const date = new Date(calendarYear, calendarMonth, day);
  const dateStr = date.toDateString();
  const dayTasks = allMyTasksCache.filter(t => t.dueDate && new Date(t.dueDate).toDateString() === dateStr);
  const myListEl = document.getElementById('tasksMyList');
  if (myListEl && dayTasks.length > 0) {
    const label = document.getElementById('tasksTodayDateLabel');
    if (label) label.textContent = date.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    renderTodayTasks(myListEl, dayTasks);
  }
}

function renderTasksList(el, tasks, isMyTasks = false, isPool = false) {
  if (tasks.length === 0) {
    el.innerHTML = `<div class="empty-state">${isPool ? 'Brak zadań w puli' : 'Brak zadań'}</div>`;
    return;
  }

  // Kolory przypisania
  const assignColors = {
    kasia: '#3b82f6', agnieszka: '#8b5cf6', asia: '#ec4899', agata_r: '#f59e0b',
    aneta_o: '#10b981', agata_o: '#14b8a6', zastepstwo: '#6b7280',
    bartosz: '#ef4444', sandra: '#f97316', aneta_a: '#a855f7', patrycja: '#06b6d4', sonia: '#84cc16'
  };

  el.innerHTML = tasks.map(t => {
    const assignedColor = assignColors[t.assignedTo] || '#94a3b8';
    const assignedLabel = t.assignedToName || t.assignedTo || 'Nieprzypisane';
    const isCompleted = t.status === 'completed';
    const dueDateStr = t.dueDate ? new Date(t.dueDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Bez terminu';

    return `
    <div class="task-item ${isCompleted ? 'task-completed' : ''}" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #f1f5f9; ${isCompleted ? 'opacity:0.5;' : ''}">
      <div style="flex:1;">
        <div style="font-weight:600; color:#1e293b; ${isCompleted ? 'text-decoration:line-through;' : ''}">${escHtml(t.title)}</div>
        <div style="font-size:12px; color:#64748b; margin-top:2px;">
          ${t.contactName ? escHtml(t.contactName) + ' • ' : ''}${dueDateStr}
        </div>
        <div style="margin-top:4px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span style="font-size:11px; padding:2px 8px; border-radius:10px; background:${assignedColor}15; color:${assignedColor}; border:1px solid ${assignedColor}40; font-weight:600;">
            👤 ${escHtml(assignedLabel)}
          </span>
          ${t.createdBy ? `<span style="font-size:10px; color:#94a3b8;">utworzył: ${escHtml(t.createdBy)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        ${isPool ? `<button class="btn-primary" style="padding:6px 14px; font-size:12px; border-radius:8px;" onclick="claimTask('${t.id}')">✅ Biorę to</button>` : ''}
        ${!isPool && !isCompleted ? `<button class="btn-done-task" onclick="completeTask('${t.id}', this)" style="padding:6px 14px; font-size:12px; background:#10b981; color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600;">✓ Zrobione</button>` : ''}
        ${isCompleted ? '<span style="font-size:11px; color:#10b981; font-weight:600;">✓ Wykonane</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

async function claimTask(taskId) {
  try {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedTo: currentUser?.id })
    });
    showToast('Zadanie przypisane do Ciebie', 'success');
    loadTasks();
  } catch(e) { showToast('Błąd przypisywania zadania', 'error'); }
}

// completeTask jest zdefiniowana niżej (wersja z animacją i Supabase)

function renderTodayTasks(listEl, tasks) {
  const active = tasks.filter(t => !completedTaskIds.has(t.id) && t.status !== 'completed');
  if (active.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Brak zadań na dziś ✓</div>';
    return;
  }
  listEl.innerHTML = '';
  active.forEach(task => {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.dataset.taskId = task.id;
    const phone = task.phone || task.contactPhone || '';
    const note  = task.body || task.note || task.description || '';
    const assignedLabel = task.assignedToName || task.assignedTo || '';
    const isUrgent = task.is_urgent || task.title?.toLowerCase().includes('pilne');
    const taskTypeIcon = task.task_type === 'follow_up_call' ? '📞' : '📅';
    if (isUrgent) item.classList.add('urgent-task');

    item.innerHTML = `
      <div class="task-main">
        <div class="task-title">
          ${isUrgent ? '<span style="color:#ef4444; font-weight:700;">[PILNE]</span> ' : ''}
          ${taskTypeIcon} ${escHtml(task.title || 'Zadanie')}
        </div>
        ${note  ? `<div class="task-note">${escHtml(note)}</div>` : ''}
        ${phone ? `<div class="task-phone">📞 ${escHtml(phone)}</div>` : ''}
        ${task.contactName ? `<div style="font-size:11px;color:#3b82f6;font-weight:600;margin-top:2px;">👤 Pacjent: ${escHtml(task.contactName)}</div>` : ''}
        ${assignedLabel ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">🏢 Przypisano: ${escHtml(assignedLabel)}</div>` : ''}
      </div>
      <div class="task-meta">
        <span class="task-due">${formatTaskDue(task.dueDate)}</span>
        ${task.follow_up_delay ? `<span class="report-tag st-new">${task.follow_up_delay}</span>` : ''}
        ${phone ? `<button class="btn-call btn-sm" onclick="event.stopPropagation();initiateCall('${escHtml(phone)}','${escHtml(task.title||'')}')">📞</button>` : ''}
        <button class="btn-done-task" onclick="completeTask('${task.id}', this)" style="padding:5px 12px; font-size:12px; background:#10b981; color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600;">✓ Zrobione</button>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function renderTasks(listEl, tasks) {
  renderTodayTasks(listEl, tasks);
}

function formatTaskDue(dueDate) {
  if (!dueDate) return '';
  const d = new Date(dueDate);
  const today = new Date().toDateString();
  if (d.toDateString() === today) {
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

async function completeTask(taskId, btn) {
  completedTaskIds.add(taskId);
  localStorage.setItem('completedTaskIds', JSON.stringify([...completedTaskIds]));

  // Usuń wizualnie z listy na kokpicie
  const item = btn.closest('.task-item');
  if (item) {
    item.style.opacity = '0';
    item.style.transform = 'translateX(30px)';
    item.style.transition = 'all 0.25s ease';
    setTimeout(() => {
      item.remove();
      const listEl = document.getElementById('tasksTodayList');
      if (listEl && !listEl.querySelector('.task-item')) {
        listEl.innerHTML = '<div class="empty-state">Brak zadań na dziś ✓</div>';
      }
    }, 260);
  }

  // Aktualizuj liczniki
  todayTasks = todayTasks.filter(t => t.id !== taskId);
  const badge = document.getElementById('kpi-tasks');
  if (badge) badge.textContent = todayTasks.length;
  const navBadge = document.getElementById('badge-tasks-nav');
  if (navBadge) navBadge.textContent = todayTasks.length || '';

  // Zapisz w Supabase (i opcjonalnie GHL)
  try {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' })
    });
  } catch(e) { /* cicho */ }

  // Odśwież widok Zadania jeśli otwarty
  if (currentView === 'tasks') loadTasks();
}

async function toggleTask(taskId, completed) {
  if (completed) {
    completeTask(taskId, document.querySelector(`[data-task-id="${taskId}"] .btn-task-done`) || document.createElement('button'));
  }
}

// ── Pełny widok zadań ──────────────────────────────────────────────────────
let allTasksCache = [];

async function loadAllTasks() {
  const todoEl = document.getElementById('tasksTodoList');
  const doneEl = document.getElementById('tasksDoneList');
  if (!todoEl) return;
  todoEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Ładowanie...</p></div>';

  try {
    const r = await fetch('/api/tasks');
    const data = await r.json();
    allTasksCache = data.tasks || data.data || [];
  } catch(e) {
    allTasksCache = [
      { id: 't1', title: 'Oddzwoń do Anny Kowalskiej', body: 'Pacjentka prosi o kontakt', phone: '+48 501 234 567', dueDate: new Date().toISOString() },
      { id: 't2', title: 'Prośba o edycję: Marek Nowak', body: 'Recepcja prosi o edycję danych', phone: '+48 602 345 678', dueDate: new Date(Date.now() + 86400000).toISOString() }
    ];
  }

  const todo = allTasksCache.filter(t => !completedTaskIds.has(t.id));
  const done = allTasksCache.filter(t => completedTaskIds.has(t.id));

  renderAllTasksTodo(todoEl, todo);
  renderAllTasksDone(doneEl, done);

  const todoBadge = document.getElementById('badge-tasks-todo');
  if (todoBadge) todoBadge.textContent = todo.length;
  const doneBadge = document.getElementById('badge-tasks-done');
  if (doneBadge) doneBadge.textContent = done.length;
  const navBadge = document.getElementById('badge-tasks-nav');
  if (navBadge) navBadge.textContent = todo.length || '';
}

function renderAllTasksTodo(el, tasks) {
  if (tasks.length === 0) { el.innerHTML = '<div class="empty-state">Brak zadań do zrobienia ✓</div>'; return; }

  // Grupuj wg daty
  const groups = {};
  tasks.forEach(t => {
    const d = t.dueDate ? new Date(t.dueDate).toDateString() : 'Bez terminu';
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  });

  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();

  el.innerHTML = '';
  Object.entries(groups).forEach(([dateStr, groupTasks]) => {
    let label = dateStr;
    if (dateStr === today)    label = '📅 Dziś';
    else if (dateStr === tomorrow) label = '📅 Jutro';
    else if (dateStr !== 'Bez terminu') {
      label = '📅 ' + new Date(dateStr).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    const group = document.createElement('div');
    group.className = 'task-group';
    group.innerHTML = `<div class="task-group-label">${label}</div>`;
    groupTasks.forEach(task => {
      const phone = task.phone || task.contactPhone || '';
      const note  = task.body || task.note || '';
      const item = document.createElement('div');
      item.className = 'task-item';
      item.dataset.taskId = task.id;
      item.innerHTML = `
        <div class="task-main">
          <div class="task-title">${escHtml(task.title || 'Zadanie')}</div>
          ${note  ? `<div class="task-note">${escHtml(note)}</div>` : ''}
          ${phone ? `<div class="task-phone">📞 ${escHtml(phone)}</div>` : ''}
        </div>
        <div class="task-meta">
          <span class="task-due">${formatTaskDue(task.dueDate)}</span>
          ${phone ? `<button class="btn-call btn-sm" onclick="event.stopPropagation();initiateCall('${escHtml(phone)}','${escHtml(task.title||'')}')">📞</button>` : ''}
          <button class="btn-task-done" onclick="completeTask('${task.id}', this)">✓ Odznacz</button>
        </div>
      `;
      group.appendChild(item);
    });
    el.appendChild(group);
  });
}

function renderAllTasksDone(el, tasks) {
  if (!el) return;
  if (tasks.length === 0) { el.innerHTML = '<div class="empty-state">Brak wykonanych zadań</div>'; return; }
  el.innerHTML = '';
  tasks.forEach(task => {
    const phone = task.phone || task.contactPhone || '';
    const item = document.createElement('div');
    item.className = 'task-item completed';
    item.innerHTML = `
      <div class="task-main">
        <div class="task-title" style="text-decoration:line-through;opacity:.6">${escHtml(task.title || 'Zadanie')}</div>
        ${phone ? `<div class="task-phone" style="opacity:.5">📞 ${escHtml(phone)}</div>` : ''}
      </div>
      <div class="task-meta">
        <span class="task-due" style="opacity:.5">${formatTaskDue(task.dueDate)}</span>
        <button class="btn-secondary btn-sm" onclick="restoreTask('${task.id}')" title="Przywróć">↩ Przywróć</button>
      </div>
    `;
    el.appendChild(item);
  });
}

function restoreTask(taskId) {
  completedTaskIds.delete(taskId);
  localStorage.setItem('completedTaskIds', JSON.stringify([...completedTaskIds]));
  loadAllTasks();
  loadTodayTasks();
}

let activeTasksTab = 'todo';
function switchTasksTab(tab) {
  activeTasksTab = tab;
  document.querySelectorAll('#view-tasks .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#view-tasks .tab-content').forEach(c => c.classList.remove('active'));
  const btn = document.querySelector(`#view-tasks [data-tab="tasks-${tab}"]`);
  if (btn) btn.classList.add('active');
  const content = document.getElementById(`tab-tasks-${tab}`);
  if (content) content.classList.add('active');
}


// ==================== PULA ZADAŃ NA KOKPICIE ====================
async function loadDashboardPool() {
  const listEl = document.getElementById('dashboardPoolList');
  const badge = document.getElementById('dashboardPoolBadge');
  if (!listEl) return;

  try {
    const r = await fetch('/api/tasks?filter=unassigned');
    const data = await r.json();
    const poolTasks = (data.tasks || []).filter(t => t.status !== 'completed');

    if (badge) badge.textContent = poolTasks.length;

    if (poolTasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:16px;">Brak zadań w puli</div>';
      return;
    }

    listEl.innerHTML = poolTasks.map(t => {
      const isUrgent = t.is_urgent || t.title.toLowerCase().includes('pilne');
      const taskTypeIcon = t.task_type === 'follow_up_call' ? '📞' : '📅';
      const urgentClass = isUrgent ? 'style="border-left: 4px solid #ef4444; background: #fff1f2;"' : '';
      return `
        <div class="pool-item" ${urgentClass}>
          <div class="pool-item-info">
            <div class="pool-item-title">${isUrgent ? '<span style="color:#ef4444; font-weight:700;">[PILNE]</span> ' : ''}${taskTypeIcon} ${escHtml(t.title)}</div>
            <div class="pool-item-meta">
              ${t.contactName ? '<strong>' + escHtml(t.contactName) + '</strong> • ' : ''}
              ${t.follow_up_delay ? '<span class="report-tag st-new">' + t.follow_up_delay + '</span> • ' : ''}
              ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Bez terminu'}
            </div>
          </div>
          <button class="btn-claim" onclick="claimPoolTask('${t.id}', this)">✅ Biorę to</button>
        </div>
      `;
    }).join('');
  } catch(e) {
    listEl.innerHTML = '<div class="empty-state" style="padding:16px;">Błąd ładowania</div>';
  }
}

async function claimPoolTask(taskId, btn) {
  if (!currentUser?.id) { showToast('Zaloguj się aby przyjąć zadanie', 'error'); return; }
  btn.disabled = true;
  btn.textContent = '...';
  try {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedTo: currentUser.id })
    });
    showToast('✅ Zadanie przypisane do Ciebie', 'success');
    loadDashboardPool();
    loadTodayTasks();
  } catch(e) {
    showToast('Błąd przypisywania', 'error');
    btn.disabled = false;
    btn.textContent = '✅ Biorę to';
  }
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
  const stageHtml = (c.stageId || c.stageName) ? getStageTagHtml(c.stageId, c.stageName) : '';
  
  // Ostatni status z raportu
  let latestStatusHtml = '<span class="no-data">—</span>';
  if (c.latestStatus) {
    const statusLabels = {
      NOWY_PACJENT: 'Nowy pacjent',
      STALY_PACJENT: 'Stały pacjent',
      WIZYTA_BIEZACA: 'Wizyta bieżąca',
      SPAM: 'SPAM'
    };
    const statusClasses = {
      NOWY_PACJENT: 'st-new',
      STALY_PACJENT: 'st-regular',
      WIZYTA_BIEZACA: 'st-visit',
      SPAM: 'st-spam'
    };
    latestStatusHtml = `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <span class="report-tag ${statusClasses[c.latestStatus] || ''}">${statusLabels[c.latestStatus] || c.latestStatus}</span>
        ${c.latestOutcome ? `<span style="font-size:10px; color:#64748b; font-weight:600;">${c.latestOutcome}</span>` : ''}
      </div>
    `;
  }

  return `
    <div class="contacts-grid-row">
      <div class="contact-name-cell">
        <div class="contact-avatar-sm">${name.charAt(0)}</div>
        <span class="contact-name" style="cursor:pointer; color:#3b82f6; text-decoration:underline;" onclick="openPatientCard('${c.id}', '${escHtml(name)}')" title="Kliknij aby otworzyć kartę pacjenta">${name}</span>
      </div>
      <div class="contact-phone-cell" onclick="editContactField('${c.id}', 'phone', '${c.phone || ''}', this)" title="Kliknij aby edytować">
        ${c.phone || '<span class="no-data">Brak</span>'}
      </div>
      <div class="contact-email-cell" onclick="editContactField('${c.id}', 'email', '${c.email || ''}', this)" title="Kliknij aby edytować">
        ${c.email || '<span class="no-data">Brak</span>'}
      </div>
      <div class="contact-status-cell">${latestStatusHtml}</div>
      <div class="contact-tags-cell">${stageHtml}${tagsHtml}</div>
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
  const fieldName = document.getElementById('editRequestField')?.value || 'general';
  const oldValue = document.getElementById('editRequestOldValue')?.value || '';
  const newValue = document.getElementById('editRequestNewValue')?.value || '';

  if (!editRequestContactId || editRequestContactId === 'undefined') {
    showToast('Brak ID kontaktu', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/contact/${editRequestContactId}/request-edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: editRequestContactName,
        notes: notes || 'Recepcja prosi o edycję danych kontaktu',
        fieldName,
        oldValue,
        newValue,
        requestedBy: currentUser?.id || 'unknown'
      })
    });
    const data = await response.json();
    if (data.success || data.task) {
      showToast('✅ Prośba o edycję zapisana i wysłana do Soni', 'success');
    } else {
      showToast('Prośba wysłana', 'info');
    }
    // Wyczyść pola
    const clearEl = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
    clearEl('editRequestNotes'); clearEl('editRequestOldValue'); clearEl('editRequestNewValue');
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
  try {
    const range = document.getElementById('statsRange')?.value || 'today';
    const days = range === 'today' ? 1 : range === 'week' ? 7 : 30;
    const uid3 = currentUser?.id || ''; const rol3 = currentUser?.role || 'reception';
    const r = await fetch(`/api/stats?days=${days}&userId=${uid3}&role=${rol3}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    updateStatCards(data);
    renderDonutChart(data);
    renderHourlyChart(data.callsByHour || []);
    renderLeadSourcesChart(data.leadSources || {});

    // Admin: załaduj statystyki raportów (punkt 9)
    if (currentUser?.role === 'admin') {
      try {
        const rr = await fetch(`/api/reports/stats?days=${days}`);
        if (rr.ok) {
          const reportStats = await rr.json();
          renderReportStats(reportStats);
        }
      } catch(e) { console.error('Report stats error:', e); }
    }
  } catch(e) {
    console.error('Stats error:', e);
  }
}

function renderReportStats(stats) {
  // Dodaj sekcję statystyk raportów (tylko admin)
  let container = document.getElementById('adminReportStatsSection');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminReportStatsSection';
    container.className = 'stats-detail-card';
    container.style.marginTop = '24px';
    const statsView = document.getElementById('view-stats');
    if (statsView) statsView.appendChild(container);
  }

  const contactTypeLabels = {
    NOWY_PACJENT: 'Nowy pacjent', STALY_PACJENT: 'Stały pacjent',
    WIZYTA_BIEZACA: 'Wizyta bieżąca', SPAM: 'Spam/Pomyłka'
  };
  const effectLabels = {
    umowil_sie: 'Umówił wizytę', prosi_kontakt: 'Prosi o kontakt',
    rezygnacja: 'Rezygnacja', zmiana_terminu: 'Zmiana terminu',
    odwolanie: 'Odwołanie', staly_umowil: 'Stały - umówił', staly_kontakt: 'Stały - kontakt'
  };

  const renderCountTable = (title, counts, labels) => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (entries.length === 0) return '';
    return `
      <div style="margin-bottom:16px;">
        <h4 style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;">${title}</h4>
        <table class="stats-table" style="font-size:12px;">
          <thead><tr><th>Wartość</th><th>Ilość</th><th>%</th></tr></thead>
          <tbody>
            ${entries.map(([k, v]) => `<tr>
              <td>${labels?.[k] || k}</td>
              <td style="font-weight:600;">${v}</td>
              <td>${total > 0 ? (v / total * 100).toFixed(1) : 0}%</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  };

  container.innerHTML = `
    <h3>📊 Statystyki Raportów (Admin)</h3>
    <div style="padding:12px;background:#f0fdf4;border-radius:8px;margin-bottom:16px;font-weight:600;color:#166534;">
      Łącznie raportów: ${stats.totalReports || 0}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      ${renderCountTable('Typ pacjenta', stats.contactTypeCounts || {}, contactTypeLabels)}
      ${renderCountTable('Wynik rozmowy', stats.callEffectCounts || {}, effectLabels)}
      ${renderCountTable('Program leczenia', stats.programCounts || {}, {})}
      ${renderCountTable('Raporty wg użytkownika', stats.userCounts || {}, {})}
    </div>
  `;
}

function renderAdminStats(container, data) {
  // Nie nadpisujemy kontenera - dane trafiają do elementów HTML zdefiniowanych w index.html
  updateStatCards(data);
  renderDonutChart(data);
  // Ukryj spinner w kontenerze
  if (container) container.innerHTML = '';
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

// ==================== CHARTS — REALNE DANE ====================
function renderCharts(statsData) {
  // Jeśli brak danych, pobierz najpierw
  if (!statsData) {
    { const uid4 = currentUser?.id || ''; const rol4 = currentUser?.role || 'reception'; fetch(`/api/stats?userId=${uid4}&role=${rol4}`).then(r => r.json()).then(d => renderCharts(d)).catch(() => renderCharts({})); }
    return;
  }
  renderDonutChart(statsData);
  renderGaugeChart(statsData);
  renderBarChart(statsData);
  updateStatCards(statsData);
}

function updateStatCards(data) {
  const s = data.stats || {};
  const total = s.totalCalls || 0;
  const answered = s.answered || 0;
  const missed = s.missed || 0;
  const answeredPct = s.answeredPercent || 0;
  const callbackRate = s.callbackRate || 0;
  const unique = data.totalContacts || 0;
  const connected = (data.callsByStatus || {}).connected || 0;
  const ineffective = (data.callsByStatus || {}).ineffective || 0;
  const pct = v => total > 0 ? (v/total*100).toFixed(1)+'%' : '0%';
  const avgDuration = s.avgDuration || 0;
  const mins = Math.floor(avgDuration / 60);
  const secs = avgDuration % 60;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Nowe KPI cards (stats-kpi-card)
  setEl('stat-total', total);
  setEl('stat-total-sub', `Dziś: ${answeredPct}% odebranych`);
  setEl('stat-unique', unique);
  setEl('stat-answered', answeredPct + '%');
  setEl('stat-answered-sub', `${answered} połączeń`);
  setEl('stat-callback', callbackRate + '%');
  setEl('stat-callback-sub', `${answered} z ${total}`);

  // Reception OS KPI
  const newPatients = s.newPatients || 0;
  const firstCalls = s.firstCalls || 0;
  const fu = s.followUp || {};
  const avgResp = s.avgResponseTimeMins;

  setEl('stat-new-patients', newPatients);
  setEl('stat-first-calls-sub', `Pierwszych rozmów: ${firstCalls}`);

  // Czas reakcji z kolorowaniem
  const respEl = document.getElementById('stat-response-time');
  if (respEl) {
    if (avgResp === null || avgResp === undefined) {
      respEl.textContent = '—';
      respEl.style.color = '';
    } else if (avgResp < 5) {
      respEl.textContent = `${avgResp} min`;
      respEl.style.color = '#16a34a';
    } else if (avgResp <= 120) {
      respEl.textContent = `${avgResp} min`;
      respEl.style.color = '#d97706';
    } else {
      respEl.textContent = `${avgResp} min`;
      respEl.style.color = '#dc2626';
    }
  }

  setEl('stat-followup-done', `${fu.done || 0}/${fu.total || 0}`);
  setEl('stat-followup-overdue-sub', `Przeterminowane: ${fu.overdue || 0}`);

  // Odwołania = suma z cancellationStats
  const cancellations = data.cancellationStats || {};
  const totalCancellations = Object.values(cancellations).reduce((a, b) => a + b, 0);
  setEl('stat-cancellations', totalCancellations);

  // Tabela szczegółowa
  const tbody = document.getElementById('statsTableBody');
  if (tbody) {
    const respStr = avgResp !== null && avgResp !== undefined ? `${avgResp} min` : '—';
    tbody.innerHTML = `
      <tr><td>Odebrane</td><td>${connected}</td><td>${pct(connected)}</td></tr>
      <tr><td>Nieodebrane</td><td>${missed}</td><td>${pct(missed)}</td></tr>
      <tr><td>Umówione wizyty</td><td>${s.scheduled || 0}</td><td>${pct(s.scheduled || 0)}</td></tr>
      <tr><td>Follow-up</td><td>${fu.done || 0}/${fu.total || 0}</td><td>${fu.total > 0 ? Math.round((fu.done||0)/fu.total*100) : 0}%</td></tr>
      <tr><td>Zadania dziś</td><td>${s.tasks || 0}</td><td>—</td></tr>
      <tr><td>Nowi pacjenci</td><td>${newPatients}</td><td>—</td></tr>
      <tr><td>Śr. czas reakcji</td><td>${respStr}</td><td>—</td></tr>
    `;
  }

  // Czas trwania
  setEl('stat-avg-duration', `${mins}:${String(secs).padStart(2,'0')}`);

  // Podział per stanowisko (tylko admin)
  if (currentUser?.role === 'admin' && data.agentBreakdown) {
    const breakdownEl = document.getElementById('agentBreakdownSection');
    if (breakdownEl) {
      breakdownEl.innerHTML = `
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 12px 0;">📊 Podział połączeń per stanowisko</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px;">
          ${data.agentBreakdown.map(st => `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
              <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:8px;">${st.label} <span style="font-size:11px;color:#94a3b8;">(${st.ext})</span></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <span style="font-size:12px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:6px;font-weight:600;">✅ ${st.connected} odebranych</span>
                <span style="font-size:12px;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:6px;font-weight:600;">❌ ${st.missed} nieodebranych</span>
                <span style="font-size:12px;background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:6px;font-weight:600;">⚡ ${st.ineffective} nieskutecznych</span>
              </div>
              ${st.agents.length > 0 ? `
                <div style="font-size:11px;color:#64748b;margin-top:6px;font-weight:600;">Osoby:</div>
                ${st.agents.map(a => `
                  <div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
                    <span>👤 ${a.name}</span>
                    <span style="color:#64748b;">${a.calls} poł. (${a.connected} ✅ / ${a.missed} ❌)</span>
                  </div>`).join('')}
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
      breakdownEl.style.display = '';
    }
  } else {
    const breakdownEl = document.getElementById('agentBreakdownSection');
    if (breakdownEl) breakdownEl.style.display = 'none';
  }

  // Powody odwołań
  const cancList = document.getElementById('cancellationReasonsList');
  if (cancList) {
    const entries = Object.entries(cancellations).sort((a, b) => b[1] - a[1]);
    if (entries.length > 0) {
      cancList.innerHTML = entries.map(([reason, count]) => `
        <div class="cancellation-item">
          <span class="cancellation-reason">${reason}</span>
          <span class="cancellation-count">${count}</span>
        </div>`).join('');
    } else {
      cancList.innerHTML = '<p class="empty-state">Brak danych o odwołaniach</p>';
    }
  }
}

function renderDonutChart(data) {
  const canvas = document.getElementById('callsDonutChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) / 2 - 20;
  const inner = r * 0.6;

  const s = (data && data.stats) || {};
  const total = s.totalCalls || 0;
  const connected = (data && data.callsByStatus && data.callsByStatus.connected) || 0;
  const missed = (data && data.callsByStatus && data.callsByStatus.missed) || 0;
  const ineffective = (data && data.callsByStatus && data.callsByStatus.ineffective) || 0;
  const other = Math.max(0, total - connected - missed - ineffective);

  const segments = total > 0
    ? [
        { value: connected,   color: '#27ae60', label: `Odebrane (${total>0?Math.round(connected/total*100):0}%)` },
        { value: missed,      color: '#e74c3c', label: `Nieodebrane (${total>0?Math.round(missed/total*100):0}%)` },
        { value: ineffective, color: '#f39c12', label: `Nieskuteczne (${total>0?Math.round(ineffective/total*100):0}%)` },
        { value: other,       color: '#95a5a6', label: `Inne (${total>0?Math.round(other/total*100):0}%)` }
      ].filter(s => s.value > 0)
    : [{ value: 1, color: '#e9ecef', label: 'Brak danych' }];

  const segTotal = segments.reduce((s, d) => s + d.value, 0);
  let angle = -Math.PI / 2;
  ctx.clearRect(0, 0, width, height);
  segments.forEach(seg => {
    const slice = (seg.value / segTotal) * 2 * Math.PI;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath(); ctx.fillStyle = seg.color; ctx.fill();
    angle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#001f3f'; ctx.font = 'bold 28px Inter';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(total || '—', cx, cy - 10);
  ctx.font = '12px Inter'; ctx.fillStyle = '#6c757d';
  ctx.fillText('połączeń', cx, cy + 14);

  const legendEl = document.getElementById('donutLegend');
  if (legendEl) legendEl.innerHTML = segments.map(d => `<div class="legend-item"><div class="legend-dot" style="background:${d.color}"></div><span>${d.label}</span></div>`).join('');
}

function renderHourlyChart(callsByHour) {
  const canvas = document.getElementById('callsByHourChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const pad = { top: 20, right: 20, bottom: 40, left: 40 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const data = callsByHour.length === 24 ? callsByHour : Array(24).fill(0);
  const maxVal = Math.max(...data, 1);
  const barW = chartW / 24;

  ctx.clearRect(0, 0, width, height);

  // Rysuj słupki
  data.forEach((val, i) => {
    const barH = (val / maxVal) * chartH;
    const x = pad.left + i * barW;
    const y = pad.top + chartH - barH;
    const isWorkHour = i >= 8 && i <= 18;
    ctx.fillStyle = isWorkHour ? '#3b82f6' : '#94a3b8';
    ctx.fillRect(x + 2, y, barW - 4, barH);

    // Etykiety godzin co 2
    if (i % 2 === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(`${i}:00`, x + barW / 2, height - 8);
    }
  });

  // Legenda
  ctx.fillStyle = '#1e293b';
  ctx.font = '11px Inter';
  ctx.textAlign = 'left';
  ctx.fillText('Godziny pracy (8-18)', pad.left, 14);
}

function renderLeadSourcesChart(leadSources) {
  const canvas = document.getElementById('leadSourcesChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) / 2 - 20;
  const inner = r * 0.55;

  const entries = Object.entries(leadSources).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

  if (entries.length === 0 || total === 0) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Brak danych', cx, cy);
    return;
  }

  ctx.clearRect(0, 0, width, height);
  let angle = -Math.PI / 2;
  entries.forEach(([, val], i) => {
    const slice = (val / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    angle += slice;
  });

  // Wewnętrzny krąg
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 16px Inter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy - 8);
  ctx.font = '11px Inter';
  ctx.fillStyle = '#64748b';
  ctx.fillText('leadów', cx, cy + 10);

  // Legenda pod wykresem (w kontenerze)
  const legendEl = document.getElementById('leadSourcesLegend');
  if (legendEl) {
    legendEl.innerHTML = entries.slice(0, 5).map(([src, cnt], i) =>
      `<div class="legend-item"><div class="legend-dot" style="background:${colors[i % colors.length]}"></div><span>${src}: ${cnt}</span></div>`
    ).join('');
  }
}

function renderGaugeChart(data) {
  const canvas = document.getElementById('callbackGaugeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cx = width / 2, cy = height * 0.75;
  const r = Math.min(width, height) * 0.65;

  const pct = ((data && data.stats && data.stats.callbackRate) || 0) / 100;
  const displayVal = data && data.stats ? (data.stats.callbackRate || 0) + '%' : '—';
  const fillColor = pct >= 0.9 ? '#27ae60' : pct >= 0.7 ? '#f39c12' : '#e74c3c';

  ctx.clearRect(0, 0, width, height);
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineWidth = 20; ctx.strokeStyle = '#e9ecef'; ctx.stroke();
  if (pct > 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + pct * Math.PI);
    ctx.lineWidth = 20; ctx.strokeStyle = fillColor; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.fillStyle = '#001f3f'; ctx.font = 'bold 24px Inter';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(displayVal, cx, cy - 10);

  const gaugeEl = document.getElementById('gaugeValue');
  if (gaugeEl) gaugeEl.textContent = displayVal;
}

function renderBarChart(data) {
  const canvas = document.getElementById('callsBarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };

  // Grupuj połączenia po godzinie
  const hours = ['8','9','10','11','12','13','14','15','16','17','18'];
  const counts = Array(hours.length).fill(0);
  const calls = (data && data.recentCalls) || [];
  calls.forEach(c => {
    if (!c.timestamp) return;
    const h = new Date(c.timestamp).getHours();
    const idx = h - 8;
    if (idx >= 0 && idx < counts.length) counts[idx]++;
  });

  // Jeśli wszystko 0, nie rysuj
  const hasData = counts.some(v => v > 0);
  ctx.clearRect(0, 0, width, height);

  if (!hasData) {
    ctx.fillStyle = '#6c757d'; ctx.font = '13px Inter'; ctx.textAlign = 'center';
    ctx.fillText('Brak danych dla wybranego zakresu', width / 2, height / 2);
    return;
  }

  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;
  const max = Math.max(...counts, 1);
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
    const bh = (counts[i] / max) * ch;
    const y = pad.top + ch - bh;
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, '#001f3f'); g.addColorStop(1, '#003d7a');
    ctx.fillStyle = g;
    if (bh > 0) { ctx.beginPath(); ctx.roundRect(x, y, bw, bh, [4, 4, 0, 0]); ctx.fill(); }
    ctx.fillStyle = '#6c757d'; ctx.font = '11px Inter'; ctx.textAlign = 'center';
    ctx.fillText(`${h}:00`, x + bw / 2, height - pad.bottom + 16);
  });
}


// ==================== DIALER WIDGET ====================
let dialerOpen = false;
let dialerNumber = '';

function initDialer() {
  const widget = document.getElementById('dialerWidget');
  if (!widget) return;
  widget.innerHTML = `
    <div id="dialerPanel" class="dialer-panel hidden">
      <div class="widget-header" onclick="minimizeDialer()">
        <span class="widget-title">📞 Klawiatura</span>
        <div class="widget-actions">
          <button class="widget-btn" onclick="minimizeDialer(event)" title="Minimalizuj">_</button>
          <button class="widget-btn" onclick="event.stopPropagation(); toggleDialer()">✕</button>
        </div>
      </div>
      <div class="dialer-body">
        <input id="dialerInput" class="dialer-input" type="tel" value="+48" placeholder="+48 000 000 000"
               oninput="dialerNumber=this.value" onkeydown="if(event.key==='Enter')dialerCall()"/>
        <div class="dialer-grid">
          ${['1','2','3','4','5','6','7','8','9','*','0','#'].map(k => `
            <button class="dialer-key" onclick="dialerPress('${k}')">${k}</button>
          `).join('')}
        </div>
        <div class="dialer-actions">
          <button class="dialer-del" onclick="dialerDelete()" title="Usuń">⌫</button>
          <button class="dialer-call-btn" onclick="dialerCall()">Zadzwoń</button>
        </div>
      </div>
    </div>
    <button id="dialerToggleBtn" onclick="toggleDialer()" title="Klawiatura">
      <span id="dialerToggleIcon">📞</span>
    </button>
  `;
}

function toggleDialer() {
  const panel = document.getElementById('dialerPanel');
  const icon  = document.getElementById('dialerToggleIcon');
  if (!panel) return;
  
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    panel.classList.remove('minimized');
    dialerOpen = true;
    if (icon) icon.textContent = '✕';
    setTimeout(() => document.getElementById('dialerInput')?.focus(), 50);
  } else if (!panel.classList.contains('minimized')) {
    panel.classList.add('minimized');
    if (icon) icon.textContent = '📞';
  } else {
    panel.classList.add('hidden');
    panel.classList.remove('minimized');
    dialerOpen = false;
    if (icon) icon.textContent = '📞';
  }
}

function minimizeDialer(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('dialerPanel');
  if (panel) panel.classList.toggle('minimized');
}

function dialerPress(key) {
  const input = document.getElementById('dialerInput');
  if (!input) return;
  input.value += key;
  dialerNumber = input.value;
}

function dialerDelete() {
  const input = document.getElementById('dialerInput');
  if (!input || input.value.length <= 3) return; // nie usuwaj +48
  input.value = input.value.slice(0, -1);
  dialerNumber = input.value;
}

function dialerCall() {
  const num = (document.getElementById('dialerInput')?.value || '').trim();
  if (!num || num === '+48') { showToast('Wpisz numer telefonu', 'error'); return; }
  initiateCall(num, num, null, null);
  document.getElementById('dialerInput').value = '+48';
  dialerNumber = '+48';
  toggleDialer();
}

// ==================== NAGRANIA — automatyczne odświeżanie ====================
// Dla udanych połączeń: jeśli brak nagrania, sprawdzaj co 30s przez 20 minut
const recordingPollers = new Map(); // callId → intervalId

function startRecordingPoller(callId) {
  if (recordingPollers.has(callId)) return;
  let attempts = 0;
  const maxAttempts = 40; // 40 × 30s = 20 minut
  const id = setInterval(async () => {
    attempts++;
    const call = allCalls.find(c => c.callId === callId);
    if (call?.recordingUrl || attempts >= maxAttempts) {
      clearInterval(id);
      recordingPollers.delete(callId);
      return;
    }
    try {
      const r = await fetch(`/api/call/${callId}/recording`);
      const data = await r.json();
      if (data.url) {
        const idx = allCalls.findIndex(c => c.callId === callId);
        if (idx >= 0) allCalls[idx].recordingUrl = data.url;
        clearInterval(id);
        recordingPollers.delete(callId);
        if (currentView === 'calls') renderCallsTable(allCalls);
        // Odśwież przycisk nagrania inline (bez przeładowania całej tabeli)
        const btn = document.querySelector(`[data-rec-callid="${CSS.escape(callId)}"]`);
        if (btn) {
          btn.outerHTML = `<audio controls src="${data.url}" class="call-recording-player"></audio>
            <a href="${data.url}" download class="btn-download-rec" title="Pobierz">↓</a>`;
        }
        showToast('🎙️ Nagranie gotowe', 'success');
      }
    } catch(e) { /* cicho — spróbujemy ponownie */ }
  }, 30000);
  recordingPollers.set(callId, id);
}


async function openDiagnose() {
  const modal = document.getElementById('diagnoseModal');
  const content = document.getElementById('diagnoseContent');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  content.innerHTML = '<p style="color:#888;">⏳ Odpytuję Zadarma API...</p>';

  try {
    const r = await fetch('/api/call/diagnose');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    renderDiagnose(d, content);
  } catch(e) {
    content.innerHTML = `<p style="color:red;">Błąd: ${e.message}</p>`;
  }
}

function closeDiagnose() {
  const modal = document.getElementById('diagnoseModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function renderDiagnose(d, el) {
  let html = '';

  // Auth
  if (d.auth?.ok) {
    const bal = d.auth.balance?.balance ?? '?';
    const currency = d.auth.balance?.currency ?? '';
    html += `<div style="padding:10px 12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;margin-bottom:10px;">
      ✅ <strong>Autoryzacja API OK</strong> — saldo: ${bal} ${currency}
    </div>`;
  } else {
    html += `<div style="padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;margin-bottom:10px;">
      ❌ <strong>Błąd autoryzacji</strong> — ${JSON.stringify(d.auth?.error)}
      <br><small>Sprawdź ZADARMA_API_KEY i ZADARMA_API_SECRET w pliku .env</small>
    </div>`;
  }

  // Skonfigurowany numer wewnętrzny
  html += `<div style="padding:10px 12px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe;margin-bottom:10px;">
    📞 <strong>Parametr "from" wysyłany do Zadarma:</strong> <code style="font-family:monospace;font-weight:600;font-size:13px">${d.configuredFrom || d.configuredExt}</code>
    <br><small>Musi być w formacie <code style="font-family:monospace">CENTRALA_ID-NUMER_EXT</code>, np. <code style="font-family:monospace">507897-103</code></small>
    <br><small>Ustaw w .env: <code style="font-family:monospace">ZADARMA_PBX_ID=507897</code> i <code style="font-family:monospace">ZADARMA_DEFAULT_EXT=103</code></small>
  </div>`;

  // Numery wewnętrzne PBX
  if (d.extensions?.ok) {
    const exts = d.extensions.data?.numbers || d.extensions.data?.extensions || [];
    if (exts.length > 0) {
      html += `<div style="margin-bottom:10px;"><strong>📋 Numery wewnętrzne PBX:</strong>`;
      html += `<table style="width:100%;margin-top:6px;border-collapse:collapse;font-size:12px;">
        <tr style="background:#f9fafb;"><th style="padding:5px 8px;text-align:left;border:1px solid #e5e7eb;">Nr wewn.</th>
        <th style="padding:5px 8px;text-align:left;border:1px solid #e5e7eb;">Nazwa</th>
        <th style="padding:5px 8px;text-align:left;border:1px solid #e5e7eb;">Status</th></tr>`;
      exts.forEach(e => {
        const num = e.internal_number || e.number || e.id || '?';
        const name = e.name || e.description || '—';
        const online = e.online !== undefined ? e.online : (e.status === 'online' || e.status === 1);
        const statusColor = online ? '#16a34a' : '#dc2626';
        const statusTxt = online ? '🟢 Online' : '🔴 Offline';
        const isTarget = String(num) === String(d.configuredExt).replace(' (domyślny)', '');
        const bg = isTarget ? '#fefce8' : '';
        html += `<tr style="background:${bg}">
          <td style="padding:5px 8px;border:1px solid #e5e7eb;font-weight:${isTarget?'600':'400'}">${num}${isTarget?' ← skonfigurowany':''}</td>
          <td style="padding:5px 8px;border:1px solid #e5e7eb;">${name}</td>
          <td style="padding:5px 8px;border:1px solid #e5e7eb;color:${statusColor}">${statusTxt}</td>
        </tr>`;
      });
      html += `</table></div>`;

      // Sprawdź czy skonfigurowany ext jest online
      const configExt = String(d.configuredExt).replace(' (domyślny)', '');
      const targetExt = exts.find(e => String(e.internal_number || e.number || e.id) === configExt);
      if (targetExt) {
        const isOnline = targetExt.online !== undefined ? targetExt.online : (targetExt.status === 'online' || targetExt.status === 1);
        if (!isOnline) {
          html += `<div style="padding:10px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;margin-bottom:10px;">
            ⚠️ <strong>Numer wewnętrzny ${configExt} jest OFFLINE!</strong>
            <br>Telefon/softphone dla tego stanowiska nie jest zalogowany w Zadarma PBX.
            <br>Click-to-call nie zadziała dopóki numer nie będzie online.
          </div>`;
        } else {
          html += `<div style="padding:10px 12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;margin-bottom:10px;">
            ✅ <strong>Numer wewnętrzny ${configExt} jest ONLINE</strong> — click-to-call powinien działać.
          </div>`;
        }
      } else {
        html += `<div style="padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;margin-bottom:10px;">
          ❌ <strong>Numer wewnętrzny "${configExt}" nie istnieje w PBX!</strong>
          <br>Dostępne numery: ${exts.map(e => e.internal_number || e.number || e.id).join(', ')}
          <br>Popraw <code style="font-family:monospace">ZADARMA_DEFAULT_EXT</code> w .env.
        </div>`;
      }
    } else {
      html += `<div style="padding:8px 12px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb;margin-bottom:10px;">
        ℹ️ Brak numerów wewnętrznych lub nieobsługiwana struktura odpowiedzi.
        <br><small>Raw: ${JSON.stringify(d.extensions.data).slice(0, 200)}</small>
      </div>`;
    }
  } else {
    html += `<div style="padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;margin-bottom:10px;">
      ❌ Błąd pobierania numerów wewnętrznych: ${JSON.stringify(d.extensions?.error)}
    </div>`;
  }

  // Instrukcja
  html += `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12px;color:#6b7280;">💡 Co zrobić jeśli click-to-call nie działa?</summary>
    <ol style="font-size:12px;line-height:1.8;margin-top:8px;padding-left:18px;color:#374151;">
      <li>Sprawdź czy softphone/aparat jest zalogowany w Zadarma (numer musi być <strong>Online</strong> powyżej)</li>
      <li>Upewnij się że <code style="font-family:monospace">ZADARMA_DEFAULT_EXT</code> w .env odpowiada Twojemu numerowi wewnętrznemu</li>
      <li>Zadarma <strong>najpierw dzwoni na Twój numer (from)</strong>, dopiero po odebraniu łączy z pacjentem</li>
      <li>Sprawdź logi serwera — po kliknięciu "Zadzwoń" powinna pojawić się linia <code style="font-family:monospace">[Click-to-Call] Odpowiedź Zadarma:</code></li>
      <li>Jeśli odpowiedź Zadarma zawiera <code style="font-family:monospace">"status":"success"</code> ale telefon nie dzwoni — problem jest po stronie PBX/softphone</li>
    </ol>
  </details>`;

  el.innerHTML = html;
}


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
  // KPI są aktualizowane przez loadNewLeads(), loadCalls() i updateMissedKPI()
  // Ta funkcja jest pozostawiona jako placeholder dla przyszłych rozszerzeń
}


// ==================== PATIENT CARD ====================
async function openPatientCard(contactId, contactName) {
  const modal = document.getElementById('patientCardModal');
  if (!modal) return;
  
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  
  // Ustaw tytuł
  document.getElementById('patientCardTitle').textContent = `Karta Pacjenta: ${contactName || 'Ładowanie...'}`;
  
  // Wyczyść timeline
  document.getElementById('patientCardTimeline').innerHTML = '<div style="padding: 12px; background: #f8fafc; border-radius: 8px; color: #64748b; text-align: center;">Ładowanie...</div>';
  
  try {
    const response = await fetch(`/api/contact/${contactId}/card`);
    if (!response.ok) throw new Error('Błąd pobierania karty pacjenta');
    const data = await response.json();
    
    // Wypełnij dane kontaktu
    const contact = data.contact || {};
    document.getElementById('patientCardName').textContent = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || '—';
    document.getElementById('patientCardPhone').textContent = contact.phone || '—';
    document.getElementById('patientCardEmail').textContent = contact.email || '—';
    document.getElementById('patientCardSource').textContent = contact.source || '—';
    
    // Zakładki karty pacjenta
    window.switchPatientCardTab = function(tab) {
      document.getElementById('patientCardTimelineSection').classList.toggle('hidden', tab !== 'timeline');
      document.getElementById('patientCardCallsSection').classList.toggle('hidden', tab !== 'calls');
      document.getElementById('tabPatientTimeline').classList.toggle('active', tab === 'timeline');
      document.getElementById('tabPatientCalls').classList.toggle('active', tab === 'calls');
    };
    
    // Wypełnij zmapowane custom fields
    const mainProblemEl = document.getElementById('patientCardMainProblem');
    if (mainProblemEl) {
      if (contact.mainProblem) {
        mainProblemEl.textContent = contact.mainProblem;
        mainProblemEl.closest('.patient-card-field')?.classList.remove('hidden');
      } else {
        mainProblemEl.closest('.patient-card-field')?.classList.add('hidden');
      }
    }
    
    // W0
    const w0SectionEl = document.getElementById('patientCardW0Section');
    if (w0SectionEl) {
      if (contact.w0_scheduled || contact.w0_date) {
        w0SectionEl.classList.remove('hidden');
        const w0DateEl = document.getElementById('patientCardW0Date');
        if (w0DateEl && contact.w0_date) {
          w0DateEl.textContent = new Date(contact.w0_date).toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
        }
        const w0DoctorEl = document.getElementById('patientCardW0Doctor');
        if (w0DoctorEl) w0DoctorEl.textContent = contact.w0_doctor || '—';
        const w0NotesEl = document.getElementById('patientCardW0Notes');
        if (w0NotesEl) w0NotesEl.textContent = contact.w0_notes || '';
      } else {
        w0SectionEl.classList.add('hidden');
      }
    }
    
    // Zgoda marketingowa
    const marketingEl = document.getElementById('patientCardMarketing');
    if (marketingEl) {
      marketingEl.textContent = contact.marketingConsent ? '✅ Tak' : '❌ Nie';
      marketingEl.style.color = contact.marketingConsent ? '#10b981' : '#ef4444';
    }
    
    // Wypełnij timeline GHL (zakładka 1)
    const timeline = data.timeline || [];
    const callHistory = data.callHistory || [];
    const timelineEl = document.getElementById('patientCardTimeline');
    
    if (timeline.length === 0) {
      timelineEl.innerHTML = '<div style="padding: 12px; background: #f8fafc; border-radius: 8px; color: #64748b; text-align: center;">Brak aktywności GHL</div>';
    } else {
      timelineEl.innerHTML = timeline.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(activity => `
        <div style="padding: 12px; border-left: 3px solid #3b82f6; background: #f8fafc; border-radius: 6px; margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size: 12px; color: #64748b; font-weight: 600;">${new Date(activity.createdAt).toLocaleString('pl-PL')}</div>
            <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #dbeafe; color: #1e40af; font-weight: 700; text-transform: uppercase;">GHL</span>
          </div>
          <div style="font-size: 13px; color: #1e293b; margin-top: 4px;">${activity.description || activity.type || '—'}</div>
          ${activity.userName ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Przez: ${activity.userName}</div>` : ''}
        </div>
      `).join('');
    }
    
    // Wypełnij historię połączeń z aplikacji (zakładka 2)
    const callHistoryEl = document.getElementById('patientCardCallHistory');
    if (callHistoryEl) {
      if (callHistory.length === 0) {
        callHistoryEl.innerHTML = '<div style="padding: 12px; background: #f8fafc; border-radius: 8px; color: #64748b; text-align: center;">Brak połączeń w historii</div>';
      } else {
        const statusColors = { nowy_pacjent: '#3b82f6', staly_pacjent: '#10b981', biezaca_wizyta: '#f59e0b', pomylka: '#94a3b8' };
        const statusLabels = { nowy_pacjent: 'Nowy pacjent', staly_pacjent: 'Stały pacjent', biezaca_wizyta: 'Bieżąca wizyta', pomylka: 'Pomyłka' };
        callHistoryEl.innerHTML = callHistory.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(c => {
          const statusColor = statusColors[c.contactType] || '#94a3b8';
          const statusLabel = statusLabels[c.contactType] || c.contactType || '—';
          const tagColor = c.tag === 'connected' ? '#10b981' : c.tag === 'missed' ? '#ef4444' : '#94a3b8';
          const tagLabel = c.tag === 'connected' ? 'Połączono' : c.tag === 'missed' ? 'Nieodebrane' : c.tag || '—';
          return `
          <div style="padding: 12px; border-left: 3px solid ${statusColor}; background: #f8fafc; border-radius: 6px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
              <div style="font-size: 12px; color: #64748b;">${new Date(c.createdAt || c.timestamp).toLocaleString('pl-PL')}</div>
              <div style="display:flex; gap: 4px;">
                <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${tagColor}20; color: ${tagColor}; font-weight: 700;">${tagLabel}</span>
                ${c.contactType ? `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${statusColor}20; color: ${statusColor}; font-weight: 700;">${statusLabel}</span>` : ''}
              </div>
            </div>
            ${c.callEffect ? `<div style="font-size: 13px; color: #1e293b; font-weight: 600;">Wynik: ${c.callEffect}</div>` : ''}
            ${c.program ? `<div style="font-size: 12px; color: #7c3aed; margin-top: 2px;">Program: ${c.program}</div>` : ''}
            ${c.notes ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px; font-style: italic;">„${c.notes}”</div>` : ''}
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">${c.direction === 'outbound' ? '↗️ Wychodzące' : '↘️ Przychodzące'} • ${c.duration ? `${c.duration}s` : 'brak czasu'}</div>
          </div>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('[Patient Card] Error:', err);
    document.getElementById('patientCardTimeline').innerHTML = `<div style="padding: 12px; background: #fef2f2; border-radius: 8px; color: #ef4444; text-align: center;">Błąd: ${err.message}</div>`;
  }
}

function closePatientCard() {
  const modal = document.getElementById('patientCardModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}


// ==================== CALLS — ULEPSZONY WIDOK ====================
function groupCallsByDay(calls) {
  const grouped = {};
  calls.forEach(c => {
    const date = new Date(c.timestamp).toLocaleDateString('pl-PL');
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(c);
  });
  return grouped;
}

function groupRepeatedMissedCalls(calls) {
  const groups = [];
  const processed = new Set();
  
  calls.forEach((c, idx) => {
    if (processed.has(idx)) return;
    if (c.tag !== 'missed' && c.tag !== 'ineffective') {
      groups.push({ type: 'single', call: c });
      processed.add(idx);
      return;
    }
    
    const sameNumber = calls.slice(idx + 1).filter(x => x.from === c.from && (x.tag === 'missed' || x.tag === 'ineffective'));
    if (sameNumber.length >= 2) {
      groups.push({ type: 'group', calls: [c, ...sameNumber.slice(0, 2)], count: sameNumber.length + 1 });
      sameNumber.slice(0, 2).forEach(x => processed.add(calls.indexOf(x)));
    } else {
      groups.push({ type: 'single', call: c });
    }
    processed.add(idx);
  });
  
  return groups;
}

function renderCallsTableGrouped(feedEl, groupedByDay) {
  feedEl.innerHTML = '';
  
  Object.entries(groupedByDay).forEach(([date, daysCalls]) => {
    const daySection = document.createElement('div');
    daySection.style.marginBottom = '24px';
    
    const dayHeader = document.createElement('div');
    dayHeader.style.cssText = 'font-weight:700; color:#1e293b; padding:12px 0; border-bottom:2px solid #e2e8f0; margin-bottom:12px;';
    dayHeader.textContent = date;
    daySection.appendChild(dayHeader);
    
    const grouped = groupRepeatedMissedCalls(daysCalls);
    grouped.forEach(item => {
      if (item.type === 'single') {
        daySection.appendChild(createCallRow(item.call));
      } else {
        daySection.appendChild(createGroupedCallRow(item.calls, item.count));
      }
    });
    
    feedEl.appendChild(daySection);
  });
}

function createCallRow(call) {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex; align-items:center; padding:12px; border-bottom:1px solid #f1f5f9; gap:16px;';
  
  const statusColor = call.tag === 'missed' ? '#ef4444' : call.tag === 'ineffective' ? '#f59e0b' : '#10b981';
  const statusBg = call.tag === 'missed' ? '#fee2e2' : call.tag === 'ineffective' ? '#fef3c7' : '#dcfce7';
  const statusLabel = call.tag === 'missed' ? 'Nieodebrane' : call.tag === 'ineffective' ? 'Bez odbioru' : 'Połączono';
  
  div.innerHTML = `
    <div style="width:36px; height:36px; border-radius:50%; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
      ${call.direction === 'inbound' ? '📥' : '📤'}
    </div>
    <div style="flex:1;">
      <div style="font-weight:600; color:#1e293b;">${escHtml(call.contactName || call.from)}</div>
      <div style="font-size:12px; color:#64748b;">${new Date(call.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} • ${call.duration || 0}s</div>
    </div>
    <div style="background:${statusBg}; color:${statusColor}; padding:4px 12px; border-radius:6px; font-size:11px; font-weight:700;">${statusLabel}</div>
    ${call.recordingUrl ? `<button class="btn-secondary" style="padding:6px 12px; font-size:11px;" onclick="playRecording('${call.recordingUrl}')">🎙️ Odtwórz</button>` : ''}
  `;
  return div;
}

function createGroupedCallRow(calls, totalCount) {
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-bottom:8px;';
  
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; padding:12px; background:#f8fafc; cursor:pointer; gap:12px;';
  header.onclick = () => {
    const body = div.querySelector('.group-body');
    if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
    header.querySelector('.expand-icon').textContent = header.querySelector('.expand-icon').textContent === '▶' ? '▼' : '▶';
  };
  
  const from = calls[0].from;
  header.innerHTML = `
    <span class="expand-icon" style="font-size:12px; color:#64748b;">▶</span>
    <div style="flex:1;">
      <div style="font-weight:600; color:#1e293b;">${escHtml(calls[0].contactName || from)}</div>
      <div style="font-size:12px; color:#64748b;">${totalCount} nieodebranych połączeń</div>
    </div>
    <div style="background:#fee2e2; color:#ef4444; padding:4px 12px; border-radius:6px; font-size:11px; font-weight:700;">🔴 ${totalCount}x</div>
  `;
  div.appendChild(header);
  
  const body = document.createElement('div');
  body.className = 'group-body';
  body.style.display = 'none';
  body.style.borderTop = '1px solid #e2e8f0';
  calls.forEach(c => {
    const row = createCallRow(c);
    row.style.paddingLeft = '40px';
    body.appendChild(row);
  });
  div.appendChild(body);
  
  return div;
}

function playRecording(url) {
  const audio = new Audio(url);
  audio.play();
  showToast('🎧 Odtwarzanie nagrania...', 'info');
}

// Aktualizacja loadCalls — używa /api/calls/history (z Supabase, z raportami i nagraniami)
async function loadCalls() {
  const feedEl = document.getElementById('callsFeed');
  if (!feedEl) return;

  feedEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Ładowanie połączeń...</p></div>';

  try {
    const uid = currentUser?.id || '';
    const rol = currentUser?.role || 'reception';
    const dateFrom = document.getElementById('filter-date-from')?.value || '';
    const dateTo   = document.getElementById('filter-date-to')?.value || '';
    const search   = document.getElementById('filter-search-name')?.value || '';
    const rangeVal = document.getElementById('filter-range')?.value || '30';
    const station  = document.getElementById('filter-station')?.value || 'all';
    const agentId  = document.getElementById('filter-agent')?.value || 'all';
    const params = new URLSearchParams({ days: rangeVal, userId: uid, role: rol });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);
    if (search)   params.set('search', search);
    if (station !== 'all') params.set('station', station);
    if (agentId !== 'all') params.set('agentId', agentId);
    const response = await fetch(`/api/calls/history?${params}`);
    const data = await response.json();
    allCalls = data.calls || [];
    renderCallsTable(allCalls);
  } catch (err) {
    console.error('Load calls error:', err);
    feedEl.innerHTML = '<div class="error-state">Błąd ładowania połączeń</div>';
  }
}


// ==================== TWORZENIE ZADANIA MODAL ====================
function openCreateTaskModal() {
  document.getElementById('createTaskModal').classList.remove('hidden');
  document.getElementById('taskInputDueDate').value = new Date().toISOString().slice(0, 16);
  document.getElementById('taskInputTitle').value = '';
  document.getElementById('taskInputBody').value = '';
}

function openCreateTaskModalFromCall() {
  openCreateTaskModal();
  if (currentContact) {
    document.getElementById('taskInputTitle').value = `Zadanie: ${currentContact.name}`;
    document.getElementById('taskInputBody').value = `Zadanie utworzone w trakcie rozmowy z ${currentContact.name} (${currentContact.phone})`;
  }
}

function closeCreateTaskModal() {
  document.getElementById('createTaskModal').classList.add('hidden');
}

async function submitCreateTask() {
  const title = document.getElementById('taskInputTitle').value;
  const body = document.getElementById('taskInputBody').value;
  const dueDate = document.getElementById('taskInputDueDate').value;
  const assignee = document.getElementById('taskInputAssignee').value;
  
  if (!title) { showToast('Podaj tytuł zadania', 'error'); return; }
  
  const taskData = {
    title,
    description: body,
    dueDate: new Date(dueDate).toISOString(),
    assignedTo: assignee === 'pool' ? null : (assignee === 'me' ? currentUser?.id : assignee),
    contactId: currentContact?.id || null,
    contactName: currentContact?.name || null
  };
  
  try {
    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    });
    if (r.ok) {
      showToast('✅ Zadanie utworzone', 'success');
      closeCreateTaskModal();
      loadTasks();
    } else {
      showToast('Błąd tworzenia zadania', 'error');
    }
  } catch(e) { showToast('Błąd tworzenia zadania', 'error'); }
}
