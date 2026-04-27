/* ============================================================
   Navigator Call v7 — EndoEstetica
   ============================================================ */

// Globalne definicje statusów i kolorów
const PATIENT_STATUS_TAGS = {
  czeka_na_kontakt:       { label: 'Czeka na kontakt',        color: '#c2410c', bg: '#fff7ed', border: '#fb923c' },
  nie_odbiera_w_procesie: { label: 'Nie odbiera — w procesie', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  nie_odbiera_przegrana:  { label: 'Nie odbiera — przegrana',  color: '#475569', bg: '#f1f5f9', border: '#94a3b8' },
  prosi_o_kontakt:        { label: 'Prosi o kontakt',          color: '#6d28d9', bg: '#f5f3ff', border: '#a78bfa' },
  umowiony_na_w0:         { label: 'Umówiony na W0',           color: '#065f46', bg: '#f0fdf4', border: '#6ee7b7' },
  niekwalifikowany:       { label: 'Niekwalifikowany',          color: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
  rezygnacja:             { label: 'Rezygnacja',                color: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
};

// Globalny stan
let currentView = 'dashboard';
let currentContact = null;
let currentOpportunity = null;
let selectedStatus = null;
let currentStep = 1;
let activeCallId = null;
let allCalls = [];
let allContacts = [];
let allLeads = [];

// ==================== INICJALIZACJA ====================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  updateClock();
  setInterval(updateClock, 1000);
  loadDashboardData();
  loadCalls();
  loadContacts();
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  if (document.getElementById('clockTime')) document.getElementById('clockTime').textContent = timeStr;
  if (document.getElementById('clockDate')) document.getElementById('clockDate').textContent = dateStr;
}

// ==================== OBSŁUGA TABELI POŁĄCZEŃ ====================

async function loadCalls() {
  try {
    const resp = await fetch('/api/calls');
    allCalls = await resp.json();
    renderCallsTable(allCalls);
  } catch (e) { console.error('Error loading calls:', e); }
}

function renderCallsTable(calls) {
  const tbody = document.getElementById('callsTableBody');
  if (!tbody) return;
  tbody.innerHTML = calls.map(c => renderCallRow(c)).join('');
}

function renderCallRow(c) {
  const ts = c.timestamp ? new Date(c.timestamp) : new Date();
  const date = ts.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  const time = ts.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  
  // IKONA STATUSU (Punkt 4)
  let statusIconHtml = '';
  const hasReport = !!(c.reportSavedAt || c.contactType);
  if (!hasReport) {
    statusIconHtml = '<div class="status-icon missing" title="Brak raportu">!</div>';
  } else {
    const iconClass = {
      'NOWY_PACJENT': 'new',
      'STALY_PACJENT': 'regular',
      'WIZYTA_BIEZACA': 'visit',
      'SPAM': 'spam'
    }[c.contactType] || 'regular';
    const iconLabel = { 'NOWY_PACJENT': 'N', 'STALY_PACJENT': 'S', 'WIZYTA_BIEZACA': 'W', 'SPAM': 'X' }[c.contactType] || '?';
    statusIconHtml = `<div class="status-icon ${iconClass}">${iconLabel}</div>`;
  }

  // KLIKNIĘCIE W PACJENTA (Punkt 3)
  const patientCell = `
    <td onclick="event.stopPropagation(); openPatientCard('${c.contactId}', '${c.contactName}')">
      <div style="display:flex; align-items:center; gap:10px;">
        ${statusIconHtml}
        <div class="call-name-cell">
          <div class="patient-name-link">${escHtml(c.contactName || 'Nieznany')}</div>
          <div class="call-number" style="font-size:11px; color:#64748b;">${escHtml(c.from || c.to || '')}</div>
        </div>
      </div>
    </td>
  `;

  return `
    <tr class="call-row" onclick="openCallReport('${c.callId}')">
      ${patientCell}
      <td>${c.contactType || '—'}</td>
      <td>${c.direction === 'outbound' ? '📤' : '📞'}</td>
      <td>${c.callEffect || '—'}</td>
      <td>${hasReport ? '✅' : '❌'}</td>
      <td>${date}</td>
      <td>${time}</td>
      <td>${c.duration ? Math.floor(c.duration/60) + 'm' : '—'}</td>
      <td>${c.userId || '—'}</td>
      <td onclick="event.stopPropagation()">${c.recordingUrl ? '▶' : '—'}</td>
      <td><button onclick="event.stopPropagation(); initiateCall('${c.from || c.to}')">📞</button></td>
    </tr>
  `;
}

// ==================== LOGIKA POP-UPU 3-ETAPOWEGO ====================

async function openCallReport(callId) {
  const call = allCalls.find(c => c.callId === callId);
  if (!call) return;
  
  activeCallId = callId;
  currentContact = {
    id: call.contactId,
    name: call.contactName,
    phone: call.from || call.to,
    zglosza: c.zglosza || '—'
  };

  // Reset popupu
  currentStep = 1;
  selectedStatus = null;
  updatePopupUI();
  
  // Pobierz dane GHL (Źródło leada itp.) - Punkt 2
  fetchPopupEnrichment(call.contactId);

  document.getElementById('callPopup').classList.remove('hidden');
}

async function fetchPopupEnrichment(contactId) {
  try {
    const resp = await fetch(`/api/contact/${contactId}/popup`);
    const data = await resp.json();
    
    // Automatyczne zaciąganie źródła leada (Punkt 2)
    if (data.source || data.leadSource) {
      const sourceInput = document.getElementById('sf-zrodlo-leada');
      if (sourceInput) sourceInput.value = data.source || data.leadSource;
    }

    if (data.lastNote) document.getElementById('popupLastNoteText').textContent = data.lastNote.text;
    if (data.zglosza) document.getElementById('popupZglosza').textContent = data.zglosza;
    if (data.stageName) document.getElementById('popupStageBannerName').textContent = data.stageName;
    
    // Tagi dla karty pacjenta
    if (data.tags) currentContact.tags = data.tags;

  } catch (e) { console.error('Enrichment error:', e); }
}

function selectStatus(status) {
  selectedStatus = status;
  document.querySelectorAll('.status-tile').forEach(t => t.classList.remove('active'));
  document.getElementById(`tile-${status}`).classList.add('active');
  document.getElementById('step1-error').classList.add('hidden');
}

function goToStep(step) {
  // Walidacja kroku 1
  if (step === 2 && !selectedStatus) {
    document.getElementById('step1-error').classList.remove('hidden');
    return;
  }

  currentStep = step;
  updatePopupUI();
}

function updatePopupUI() {
  // Przełączanie widoczności kroków
  for (let i = 1; i <= 3; i++) {
    const stepEl = document.getElementById(`step-${i}`);
    if (stepEl) {
      if (i === currentStep) stepEl.classList.remove('hidden');
      else stepEl.classList.add('hidden');
    }
  }

  // Pokazywanie odpowiednich pytań w kroku 2
  document.querySelectorAll('.q-group').forEach(q => q.classList.add('hidden'));
  if (selectedStatus === 'NOWY_PACJENT') document.getElementById('q-new-patient').classList.remove('hidden');
  if (selectedStatus === 'WIZYTA_BIEZACA') document.getElementById('q-visit').classList.remove('hidden');

  // Dane w nagłówku
  document.getElementById('popupPatientName').textContent = currentContact?.name || 'Nieznany';
  document.getElementById('popupPatientPhone').textContent = currentContact?.phone || '—';
}

function closeCallPopup() {
  document.getElementById('callPopup').classList.add('hidden');
}

// ==================== AKCJE AUTOMATYCZNE ====================

function markAsUnqualified() {
  if (!confirm('Czy na pewno oznaczyć jako Niekwalifikowany?')) return;
  saveQuickAction('niekwalifikowany');
}

function markAsResigned() {
  document.getElementById('resignationModal').classList.remove('hidden');
}

function confirmResignation() {
  const reason = document.getElementById('resignationReason').value;
  if (!reason) {
    alert('Proszę podać powód rezygnacji.');
    return;
  }
  saveQuickAction('rezygnacja', reason);
  closeResignationModal();
}

async function saveQuickAction(tag, note = '') {
  try {
    await fetch('/api/report/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callId: activeCallId,
        contactId: currentContact.id,
        tag: tag,
        notes: note || `Automatyczna akcja: ${tag}`
      })
    });
    showToast(`Oznaczono jako ${tag}`, 'success');
    closeCallPopup();
    loadCalls();
  } catch (e) { console.error('Quick action error:', e); }
}

// ==================== KARTA PACJENTA ====================

function openPatientCard(id, name) {
  currentContact = { id, name };
  document.getElementById('patientCardTitle').textContent = `Karta Pacjenta: ${name}`;
  
  // Pobierz dane i tagi (Punkt 1 - tagi widoczne w karcie)
  fetch(`/api/contact/${id}/popup`).then(r => r.json()).then(data => {
    document.getElementById('patientCardFirstName').textContent = data.firstName || '—';
    document.getElementById('patientCardLastName').textContent = data.lastName || '—';
    document.getElementById('patientCardPhone').textContent = data.phone || '—';
    document.getElementById('patientCardLeadSource').textContent = data.source || data.leadSource || '—';
    
    // Renderowanie tagów
    const tagsContainer = document.getElementById('patientCardTags');
    tagsContainer.innerHTML = (data.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('');
  });

  document.getElementById('patientCardModal').classList.remove('hidden');
}

function openPatientCardFromPopup() {
  if (currentContact?.id) openPatientCard(currentContact.id, currentContact.name);
}

function closePatientCard() {
  document.getElementById('patientCardModal').classList.add('hidden');
}

// Helpery
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
