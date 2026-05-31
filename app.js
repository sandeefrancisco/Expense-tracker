'use strict';

/* ─── Supabase ──────────────────────────────────────────── */
const SUPABASE_URL      = 'https://eizhfvieozigsgolckez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpemhmdmllb3ppZ3Nnb2xja2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTEyMDUsImV4cCI6MjA5NTc2NzIwNX0.v-qAHGR-I63RL4Ue0YH5evTwot9riE-nUuw0ACffaYA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── Categories ────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'housing',       emoji: '🏠', label: 'Housing',   color: '#0ca678', bg: '#e6fcf5' },
  { id: 'food',          emoji: '🍽️', label: 'Food',      color: '#fa5252', bg: '#fff5f5' },
  { id: 'transport',     emoji: '🚗', label: 'Transport', color: '#1971c2', bg: '#e7f5ff' },
  { id: 'utilities',     emoji: '💡', label: 'Bills',     color: '#1098ad', bg: '#e3fafc' },
  { id: 'health',        emoji: '💊', label: 'Health',    color: '#2f9e44', bg: '#ebfbee' },
  { id: 'education',     emoji: '📚', label: 'Learning',  color: '#3b5bdb', bg: '#edf2ff' },
  { id: 'entertainment', emoji: '🎬', label: 'Fun',       color: '#e67700', bg: '#fff9db' },
  { id: 'shopping',      emoji: '🛍️', label: 'Shopping',  color: '#ae3ec9', bg: '#f8f0ff' },
  { id: 'travel',        emoji: '✈️', label: 'Travel',    color: '#0077b6', bg: '#e8f4fd' },
  { id: 'personal',      emoji: '💆', label: 'Personal',  color: '#d6336c', bg: '#fff0f6' },
  { id: 'savings',       emoji: '🏦', label: 'Savings',   color: '#2f9e44', bg: '#ebfbee' },
  { id: 'other',         emoji: '📦', label: 'Other',     color: '#868e96', bg: '#f8f9fa' },
];

/* ─── State ─────────────────────────────────────────────── */
let expenses      = [];
let incomeEntries = [];
let settings      = { currency: { symbol: '$', code: 'USD' } };
let currentUser   = null;
let currentYear, currentMonth;
let pendingDeleteId  = null;
let selectedCategory = CATEGORIES[0].id;
let authMode         = 'signin';

/* ─── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const now   = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();

  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) { currentUser = session.user; await loadUserData(); showApp(); }
  else               { showAuth(); }

  hideLoading();
  buildCategoryGrid();
  bindEvents();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      await loadUserData();
      showApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser   = null;
      expenses      = [];
      incomeEntries = [];
      settings      = { currency: { symbol: '$', code: 'USD' } };
      showAuth();
    }
  });
}

/* ─── Loading ───────────────────────────────────────────── */
function hideLoading() { document.getElementById('loadingScreen').classList.add('hidden'); }

/* ─── Auth UI ───────────────────────────────────────────── */
function showAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const email = currentUser.email || '';
  document.getElementById('accountEmail').textContent  = email;
  document.getElementById('accountAvatar').textContent = email.charAt(0).toUpperCase();
  renderAll();
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  document.getElementById('authTitle').textContent      = signup ? 'Create account' : 'Welcome back';
  document.getElementById('authSub').textContent        = signup ? 'Plan your budget together' : 'Sign in to continue';
  document.getElementById('authSubmitBtn').textContent  = signup ? 'Sign up' : 'Sign in';
  document.getElementById('authToggle').innerHTML       = signup
    ? 'Already have an account? <strong>Sign in</strong>'
    : "Don't have an account? <strong>Sign up</strong>";
  document.getElementById('passwordInput').autocomplete = signup ? 'new-password' : 'current-password';
  document.getElementById('authError').classList.add('hidden');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const btn      = document.getElementById('authSubmitBtn');
  const errorEl  = document.getElementById('authError');
  if (!email || !password) return;

  errorEl.classList.add('hidden');
  btn.disabled    = true;
  btn.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…';

  try {
    if (authMode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        errorEl.style.cssText = 'background:#dcfce7;color:#166534;';
        errorEl.textContent   = 'Account created! Check your email to confirm, then sign in.';
        errorEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Sign up';
        return;
      }
    }
  } catch (err) {
    errorEl.style.cssText = '';
    errorEl.textContent   = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled    = false;
    btn.textContent = authMode === 'signin' ? 'Sign in' : 'Sign up';
  }
}

/* ─── Data Loading ──────────────────────────────────────── */
async function loadUserData() {
  const [expRes, setRes, incRes] = await Promise.all([
    sb.from('expenses').select('*').order('created_at', { ascending: false }),
    sb.from('user_settings').select('*').eq('user_id', currentUser.id).maybeSingle(),
    sb.from('monthly_income').select('*').order('created_at', { ascending: true }),
  ]);

  if (!expRes.error && expRes.data)
    expenses = expRes.data.map(e => ({ ...e, amount: parseFloat(e.amount) }));

  if (!setRes.error && setRes.data)
    settings = { currency: { code: setRes.data.currency_code, symbol: setRes.data.currency_symbol } };

  if (!incRes.error && incRes.data)
    incomeEntries = incRes.data.map(r => ({ ...r, amount: parseFloat(r.amount) }));
}

/* ─── Helpers ───────────────────────────────────────────── */
function getCat(id)  { return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]; }
function fmt(n)      { return `${settings.currency.symbol}${parseFloat(n).toFixed(2)}`; }
function escHtml(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function monthStartISO() {
  const m = String(currentMonth + 1).padStart(2, '0');
  return `${currentYear}-${m}-01`;
}

function getMonthExpenses() {
  return expenses.filter(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });
}

function getMonthIncome() {
  return incomeEntries.filter(r => r.year === currentYear && r.month === currentMonth);
}

function getMonthLabel(y, m) {
  return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden'); t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200); }, 2200);
}

/* ─── DB: Allocations ───────────────────────────────────── */
async function dbAdd(data) {
  const { data: row, error } = await sb.from('expenses')
    .insert({ user_id: currentUser.id, ...data }).select().single();
  if (error) throw error;
  expenses.unshift({ ...row, amount: parseFloat(row.amount) });
}

async function dbUpdate(id, data) {
  const { error } = await sb.from('expenses').update(data).eq('id', id);
  if (error) throw error;
  const i = expenses.findIndex(e => e.id === id);
  if (i !== -1) expenses[i] = { ...expenses[i], ...data, amount: parseFloat(data.amount) };
}

async function dbDelete(id) {
  const { error } = await sb.from('expenses').delete().eq('id', id);
  if (error) throw error;
  expenses = expenses.filter(e => e.id !== id);
}

/* ─── DB: Income ────────────────────────────────────────── */
async function dbAddIncome(year, month, amount, source, note) {
  const { data: row, error } = await sb.from('monthly_income')
    .insert({ user_id: currentUser.id, year, month, amount, source: source || 'Salary', note: note || null })
    .select().single();
  if (error) throw error;
  incomeEntries.push({ ...row, amount: parseFloat(row.amount) });
}

async function dbDeleteIncome(id) {
  const { error } = await sb.from('monthly_income').delete().eq('id', id);
  if (error) throw error;
  incomeEntries = incomeEntries.filter(r => r.id !== id);
}

/* ─── DB: Settings ──────────────────────────────────────── */
async function dbSaveSettings() {
  await sb.from('user_settings').upsert({
    user_id: currentUser.id,
    currency_code: settings.currency.code,
    currency_symbol: settings.currency.symbol,
    updated_at: new Date().toISOString(),
  });
}

/* ─── Render ────────────────────────────────────────────── */
function renderAll() {
  renderHeader();
  renderSummary();
  renderListView();
  syncSettingsUI();
}

function renderHeader() {
  document.getElementById('monthLabel').textContent = getMonthLabel(currentYear, currentMonth);
  const now = new Date();
  const cur = currentYear === now.getFullYear() && currentMonth === now.getMonth();
  const btn = document.getElementById('nextMonth');
  btn.style.opacity = cur ? '0.3' : '1'; btn.disabled = cur;
}

function renderSummary() {
  const list    = getMonthExpenses();
  const income  = getMonthIncome();
  const allocated = list.reduce((s, e) => s + e.amount, 0);
  const earned    = income.reduce((s, r) => s + r.amount, 0);
  const saved     = earned - allocated;
  const hasIncome = earned > 0;

  const heroEl  = document.getElementById('summaryHero');
  const labelEl = document.getElementById('summaryLabel');

  if (hasIncome) {
    labelEl.textContent = saved >= 0 ? 'Saved this month' : 'Over income';
    heroEl.textContent  = fmt(Math.abs(saved));
    heroEl.style.color  = saved >= 0 ? '#86efac' : '#fca5a5';
  } else {
    labelEl.textContent = 'Total allocated';
    heroEl.textContent  = fmt(allocated);
    heroEl.style.color  = '';
  }

  const incomeRow = document.getElementById('incomeRow');
  const metaRow   = document.getElementById('summaryMeta');
  if (hasIncome) {
    document.getElementById('earnedVal').textContent = fmt(earned);
    document.getElementById('spentVal').textContent  = fmt(allocated);
    incomeRow.classList.remove('hidden');
    metaRow.classList.add('hidden');
  } else {
    incomeRow.classList.add('hidden');
    metaRow.classList.remove('hidden');
    const n = list.length;
    document.getElementById('itemCount').textContent =
      n === 0 ? '0 items' : n === 1 ? '1 item' : `${n} items`;
  }

  renderCategoryBars(list, allocated);
}

function renderCategoryBars(list, total) {
  const el = document.getElementById('categoryBars');
  el.innerHTML = '';
  if (total === 0) {
    const s = document.createElement('div');
    s.className = 'category-bar-segment';
    s.style.cssText = 'width:100%;background:rgba(255,255,255,0.15);';
    el.appendChild(s); return;
  }
  const grouped = list.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount; return acc;
  }, {});
  Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .forEach(([catId, amount]) => {
      const cat = getCat(catId);
      const seg = document.createElement('div');
      seg.className = 'category-bar-segment';
      seg.title = cat.label;
      seg.style.cssText = `width:${(amount / total) * 100}%;background:${cat.color};opacity:0.7;`;
      el.appendChild(seg);
    });
}

function renderListView() {
  const container = document.getElementById('expenseList');
  const list = getMonthExpenses();

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No allocations yet</p>
        <span>Tap + to add your first budget item</span>
      </div>`;
    return;
  }

  // Group by category
  const grouped = {};
  list.forEach(e => {
    if (!grouped[e.category]) grouped[e.category] = { items: [], total: 0 };
    grouped[e.category].items.push(e);
    grouped[e.category].total += e.amount;
  });

  // Sort categories by total descending
  const sorted = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);

  container.innerHTML = '';
  sorted.forEach(([catId, { items, total }]) => {
    const cat = getCat(catId);

    // Category group header
    const header = document.createElement('div');
    header.className = 'cat-group-header';
    header.innerHTML = `
      <div class="cat-group-icon" style="background:${cat.bg}">${cat.emoji}</div>
      <div class="cat-group-name">${cat.label}</div>
      <div class="cat-group-total">${fmt(total)}</div>`;
    container.appendChild(header);

    // Items within group
    items.sort((a, b) => b.amount - a.amount).forEach(e => {
      container.appendChild(buildItem(e));
    });
  });
}

function buildItem(e) {
  const el = document.createElement('div');
  el.className = 'expense-item'; el.dataset.id = e.id;
  el.innerHTML = `
    <div class="expense-info">
      <div class="expense-desc">${escHtml(e.description)}</div>
    </div>
    <div class="expense-amount">${fmt(e.amount)}</div>
    <div class="expense-actions">
      <button class="item-action-btn edit-action"   data-id="${e.id}" aria-label="Edit">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="item-action-btn delete-action" data-id="${e.id}" aria-label="Delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    </div>`;
  el.addEventListener('click', ev => {
    if (ev.target.closest('.item-action-btn')) return;
    document.querySelectorAll('.expense-item').forEach(i => { if (i !== el) i.classList.remove('show-actions'); });
    el.classList.toggle('show-actions');
  });
  el.querySelector('.edit-action').addEventListener('click', ev => { ev.stopPropagation(); openEditModal(e.id); });
  el.querySelector('.delete-action').addEventListener('click', ev => { ev.stopPropagation(); openDeleteConfirm(e.id); });
  return el;
}

/* ─── Category Grid ─────────────────────────────────────── */
function buildCategoryGrid() {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'category-chip'; chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="chip-emoji">${cat.emoji}</span><span class="chip-label">${cat.label}</span>`;
    chip.addEventListener('click', () => selectCategory(cat.id));
    grid.appendChild(chip);
  });
}

function selectCategory(id) {
  selectedCategory = id;
  document.querySelectorAll('.category-chip').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
}

/* ─── Add / Edit Modal ──────────────────────────────────── */
function clearFormError() { document.getElementById('formError').classList.add('hidden'); }
function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg; el.classList.remove('hidden');
}

function openAddModal() {
  selectedCategory = CATEGORIES[0].id; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'New Allocation';
  document.getElementById('submitBtn').textContent  = 'Add Allocation';
  document.getElementById('amountInput').value = '';
  document.getElementById('descInput').value   = '';
  document.getElementById('editId').value      = '';
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  clearFormError();
  openModal('expenseModal');
  setTimeout(() => document.getElementById('amountInput').focus(), 300);
}

function openEditModal(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  selectedCategory = e.category; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'Edit Allocation';
  document.getElementById('submitBtn').textContent  = 'Save Changes';
  document.getElementById('amountInput').value = parseFloat(e.amount).toFixed(2);
  document.getElementById('descInput').value   = e.description;
  document.getElementById('editId').value      = e.id;
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  clearFormError();
  openModal('expenseModal');
}

async function handleFormSubmit(ev) {
  ev.preventDefault();
  clearFormError();
  const amount = parseFloat(document.getElementById('amountInput').value);
  const desc   = document.getElementById('descInput').value.trim();
  const editId = document.getElementById('editId').value;
  if (!amount || amount <= 0) { document.getElementById('amountInput').focus(); return; }
  if (!desc)                   { document.getElementById('descInput').focus();   return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = editId ? 'Saving…' : 'Adding…';
  try {
    const date = monthStartISO();
    if (editId) {
      await dbUpdate(editId, { amount, description: desc, category: selectedCategory, date });
      showToast('Updated');
    } else {
      await dbAdd({ amount, description: desc, category: selectedCategory, date, note: null });
      showToast('Added');
    }
    closeModal('expenseModal'); renderAll();
  } catch (err) {
    showFormError(err.message);
  }
  finally { btn.disabled = false; btn.textContent = editId ? 'Save Changes' : 'Add Allocation'; }
}

/* ─── Income Modal ──────────────────────────────────────── */
function openIncomeModal() {
  document.getElementById('incomeModalTitle').textContent     = `Income · ${getMonthLabel(currentYear, currentMonth)}`;
  document.getElementById('incomeCurrencySymbol').textContent = settings.currency.symbol;
  document.getElementById('incomeAmountInput').value = '';
  document.getElementById('incomeSourceInput').value = '';
  document.getElementById('incomeNoteInput').value   = '';
  renderIncomeList();
  openModal('incomeModal');
}

function renderIncomeList() {
  const container = document.getElementById('incomeList');
  const items = getMonthIncome();
  if (items.length === 0) {
    container.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:4px 0 8px;">No income logged for this month yet.</div>`;
    return;
  }
  container.innerHTML = '';
  items.forEach(r => {
    const el = document.createElement('div');
    el.className = 'income-item';
    el.innerHTML = `
      <div class="income-item-icon">💰</div>
      <div class="income-item-info">
        <div class="income-item-source">${escHtml(r.source)}</div>
        ${r.note ? `<div class="income-item-note">${escHtml(r.note)}</div>` : ''}
      </div>
      <div class="income-item-amount">${fmt(r.amount)}</div>
      <button class="income-item-del" data-id="${r.id}" aria-label="Remove">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>`;
    el.querySelector('.income-item-del').addEventListener('click', async () => {
      try {
        await dbDeleteIncome(r.id);
        renderIncomeList(); renderSummary();
        showToast('Income removed');
      } catch (err) { showToast('Error: ' + err.message); }
    });
    container.appendChild(el);
  });
}

async function handleIncomeSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('incomeAmountInput').value);
  const source = document.getElementById('incomeSourceInput').value.trim() || 'Salary';
  const note   = document.getElementById('incomeNoteInput').value.trim();
  if (!amount || amount <= 0) { document.getElementById('incomeAmountInput').focus(); return; }

  const btn = document.getElementById('addIncomeBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    await dbAddIncome(currentYear, currentMonth, amount, source, note);
    document.getElementById('incomeAmountInput').value = '';
    document.getElementById('incomeSourceInput').value = '';
    document.getElementById('incomeNoteInput').value   = '';
    renderIncomeList(); renderSummary();
    showToast('Income added');
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Add Income'; }
}

/* ─── Delete ────────────────────────────────────────────── */
function openDeleteConfirm(id) { pendingDeleteId = id; openModal('deleteModal'); }

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('confirmDelete');
  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    await dbDelete(pendingDeleteId);
    closeModal('deleteModal'); pendingDeleteId = null; renderAll();
    showToast('Removed');
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Remove'; }
}

/* ─── Settings ──────────────────────────────────────────── */
function syncSettingsUI() {
  document.querySelectorAll('.currency-btn').forEach(b => b.classList.toggle('active', b.dataset.code === settings.currency.code));
}

async function handleCurrencySelect(code, symbol) {
  settings.currency = { code, symbol };
  syncSettingsUI(); renderAll();
  try { await dbSaveSettings(); } catch {}
}

/* ─── Modal Helpers ─────────────────────────────────────── */
const MODALS = ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal'];

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (MODALS.every(m => document.getElementById(m).classList.contains('hidden'))) {
    document.body.classList.remove('modal-open');
  }
}

function closeAllModals() {
  MODALS.forEach(m => document.getElementById(m).classList.add('hidden'));
  document.body.classList.remove('modal-open');
}

/* ─── Event Binding ─────────────────────────────────────── */
function bindEvents() {
  // Auth
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  document.getElementById('authToggle').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

  // Month nav
  document.getElementById('prevMonth').addEventListener('click', () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderAll();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    const now = new Date();
    if (currentYear === now.getFullYear() && currentMonth === now.getMonth()) return;
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderAll();
  });

  // Allocation form
  document.getElementById('openAdd').addEventListener('click', openAddModal);
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('closeModal').addEventListener('click', () => closeModal('expenseModal'));

  // Income
  document.getElementById('logIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('editIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('incomeForm').addEventListener('submit', handleIncomeSubmit);
  document.getElementById('closeIncomeModal').addEventListener('click', () => closeModal('incomeModal'));

  // Delete
  document.getElementById('cancelDelete').addEventListener('click',  () => closeModal('deleteModal'));
  document.getElementById('confirmDelete').addEventListener('click', handleConfirmDelete);

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => openModal('settingsModal'));
  document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));

  document.getElementById('currencyOptions').addEventListener('click', e => {
    const btn = e.target.closest('.currency-btn');
    if (btn) handleCurrencySelect(btn.dataset.code, btn.dataset.symbol);
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await sb.auth.signOut(); closeModal('settingsModal');
  });

  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (!confirm('Delete all your data for every month? This cannot be undone.')) return;
    try {
      await Promise.all([
        sb.from('expenses').delete().eq('user_id', currentUser.id),
        sb.from('monthly_income').delete().eq('user_id', currentUser.id),
      ]);
      expenses = []; incomeEntries = [];
      closeModal('settingsModal'); renderAll(); showToast('All data cleared');
    } catch (err) { showToast('Error: ' + err.message); }
  });

  // Backdrop clicks
  ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
