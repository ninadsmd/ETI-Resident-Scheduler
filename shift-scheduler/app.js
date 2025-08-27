// Config
const SHEETBEST_URL = 'https://api.sheetbest.com/sheets/a3e58e30-2dc3-4a51-a5b5-47fed1cb7c0d';
const ADMIN_PIN = '1234';

// State
let isAdmin = false;
let cache = {
  shifts: [],
  monthOffsets: {
    req: 0,
    pending: 0,
    approved: 0,
  },
};

// Utils
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
function formatDateKey(date) { return date.toISOString().slice(0, 10); }
function toDateOnlyString(date) { return new Date(date).toISOString().slice(0,10); }
function setStatusBar(text) { const el = $('#statusBar'); if (el) el.textContent = text; }

function getMonthBase(offset = 0) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return base;
}

function getDaysInMonth(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  return { firstDay, lastDay, days };
}

function renderCalendar(containerId, titleId, monthOffset, filterFn) {
  const container = document.getElementById(containerId);
  const titleEl = document.getElementById(titleId);
  if (!container || !titleEl) return;

  container.innerHTML = '';

  const base = getMonthBase(monthOffset);
  const { firstDay, days } = getDaysInMonth(base);
  const monthName = base.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  titleEl.textContent = monthName;

  // Weekdays header
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  weekdays.forEach(w => {
    const div = document.createElement('div');
    div.className = 'weekday';
    div.textContent = w;
    container.appendChild(div);
  });

  // Leading empty cells
  for (let i = 0; i < firstDay.getDay(); i++) {
    const div = document.createElement('div');
    div.className = 'day empty';
    container.appendChild(div);
  }

  const tmpl = document.getElementById('shiftItemTemplate');

  days.forEach(day => {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'day';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'date';
    dateSpan.textContent = day.getDate();
    dayDiv.appendChild(dateSpan);

    const dateKey = toDateOnlyString(day);
    const items = cache.shifts.filter(s => toDateOnlyString(s.date) === dateKey && (!filterFn || filterFn(s)));
    items.forEach(item => {
      const node = tmpl.content.firstElementChild.cloneNode(true);
      node.classList.add(item.status === 'approved' ? 'approved' : 'pending');
      node.innerHTML = `${item.name || 'Unknown'} • ${item.start}–${item.end}`;
      node.title = `${item.role || ''}${item.notes ? `\n${item.notes}` : ''}`;
      node.dataset.id = item.id || '';
      node.dataset.status = item.status || 'pending';
      if (containerId === 'calendar-pending' && isAdmin && item.status !== 'approved') {
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => approveShift(item));
      }
      dayDiv.appendChild(node);
    });

    container.appendChild(dayDiv);
  });
}

function renderAllCalendars() {
  renderCalendar('calendar-req', 'calendarTitle-req', cache.monthOffsets.req, () => true);
  renderCalendar('calendar-pending', 'calendarTitle-pending', cache.monthOffsets.pending, s => s.status !== 'approved');
  renderCalendar('calendar-approved', 'calendarTitle-approved', cache.monthOffsets.approved, s => s.status === 'approved');
}

// Tabs
function setupTabs() {
  $all('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.tab').forEach(b => b.classList.remove('active'));
      $all('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      document.getElementById(`tab-${id}`).classList.add('active');
      renderAllCalendars();
    });
  });
}

// Calendar navigation
function setupCalendarNav() {
  $all('[data-action][data-cal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.cal;
      const action = btn.dataset.action;
      cache.monthOffsets[key] += action === 'next' ? 1 : -1;
      renderAllCalendars();
    });
  });
}

// API Layer
async function apiGet(params = {}) {
  const url = new URL(SHEETBEST_URL);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('GET failed');
  return res.json();
}

async function apiPost(row) {
  const res = await fetch(SHEETBEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error('POST failed');
  return res.json();
}

async function apiPatchByQuery(query, updates) {
  const url = new URL(SHEETBEST_URL);
  Object.entries(query).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('PATCH failed');
  return res.json();
}

// Data load/sync
async function loadShifts() {
  setStatusBar('Loading shifts...');
  try {
    const rows = await apiGet();
    // Normalize fields
    cache.shifts = rows.map((r, idx) => ({
      id: r.id || r.ID || r.Id || `${idx+1}`,
      name: r.name || r.Name || '',
      role: r.role || r.Role || '',
      date: r.date || r.Date || r.datetime || '',
      start: r.start || r.Start || '',
      end: r.end || r.End || '',
      notes: r.notes || r.Notes || '',
      status: (r.status || r.Status || 'pending').toLowerCase(),
    })).filter(s => s.date);
    renderAllCalendars();
    setStatusBar('Loaded');
  } catch (e) {
    console.error(e);
    setStatusBar('Failed to load shifts');
  }
}

function generateClientId() {
  return 'id-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
}

// Request form
function setupRequestForm() {
  const form = document.getElementById('requestForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const row = {
      id: generateClientId(),
      name: data.name,
      role: data.role,
      date: data.date,
      start: data.start,
      end: data.end,
      notes: data.notes || '',
      status: 'pending',
    };
    $('#submitRequestBtn').disabled = true;
    setStatusBar('Submitting request...');
    try {
      await apiPost(row);
      cache.shifts.push(row);
      renderAllCalendars();
      form.reset();
      $('#requestMessage').textContent = 'Shift requested!';
      setStatusBar('Submitted');
    } catch (e) {
      console.error(e);
      $('#requestMessage').textContent = 'Submission failed.';
      setStatusBar('Submission failed');
    } finally {
      $('#submitRequestBtn').disabled = false;
    }
  });
}

// Admin login modal
function setupAdminModal() {
  const modal = document.getElementById('adminModal');
  const openBtn = document.getElementById('adminLoginBtn');
  const closeBtn = document.getElementById('closeAdminModal');
  const form = document.getElementById('adminForm');
  const pinInput = document.getElementById('adminPin');
  const msg = document.getElementById('adminMessage');

  function open() { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); pinInput.focus(); }
  function close() { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); msg.textContent=''; pinInput.value=''; }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pinInput.value === ADMIN_PIN) {
      isAdmin = true;
      msg.textContent = 'Logged in as admin';
      setTimeout(() => close(), 500);
      renderAllCalendars();
    } else {
      msg.textContent = 'Invalid PIN';
    }
  });
}

// Approve flow
async function approveShift(shift) {
  if (!isAdmin) return;
  setStatusBar('Approving shift...');
  try {
    await apiPatchByQuery({ id: shift.id }, [{ status: 'approved' }]);
    const local = cache.shifts.find(s => s.id === shift.id);
    if (local) local.status = 'approved';
    renderAllCalendars();
    setStatusBar('Approved');
  } catch (e) {
    console.error(e);
    setStatusBar('Approval failed');
  }
}

// Init
function init() {
  setupTabs();
  setupCalendarNav();
  setupRequestForm();
  setupAdminModal();
  loadShifts();
}

document.addEventListener('DOMContentLoaded', init);

