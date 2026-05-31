'use strict';

/* ─── Supabase ──────────────────────────────────────────── */
const SUPABASE_URL      = 'https://eizhfvieozigsgolckez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpemhmdmllb3ppZ3Nnb2xja2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTEyMDUsImV4cCI6MjA5NTc2NzIwNX0.v-qAHGR-I63RL4Ue0YH5evTwot9riE-nUuw0ACffaYA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── Categories ────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'food',          emoji: '🍽️', label: 'Food',      color: '#fa5252', bg: '#fff5f5' },
  { id: 'shopping',      emoji: '🛍️', label: 'Shopping',  color: '#ae3ec9', bg: '#f8f0ff' },
  { id: 'transport',     emoji: '🚗', label: 'Transport', color: '#1971c2', bg: '#e7f5ff' },
  { id: 'housing',       emoji: '🏠', label: 'Housing',   color: '#0ca678', bg: '#e6fcf5' },
  { id: 'entertainment', emoji: '🎬', label: 'Fun',       color: '#e67700', bg: '#fff9db' },
  { id: 'health',        emoji: '💊', label: 'Health',    color: '#2f9e44', bg: '#ebfbee' },
  { id: 'utilities',     emoji: '💡', label: 'Bills',     color: '#1098ad', bg: '#e3fafc' },
  { id: 'education',     emoji: '📚', label: 'Learning',  color: '#3b5bdb', bg: '#edf2ff' },
  { id: 'travel',        emoji: '✈️', label: 'Travel',    color: '#0077b6', bg: '#e8f4fd' },
  { id: 'personal',      emoji: '💆', label: 'Personal',  color: '#d6336c', bg: '#fff0f6' },
  { id: 'gifts',         emoji: '🎁', label: 'Gifts',     color: '#f76707', bg: '#fff4e6' },
  { id: 'other',         emoji: '📦', label: 'Other',     color: '#868e96', bg: '#f8f9fa' },
];

/* ─── State ─────────────────────────────────────────────── */
let expenses       = [];
let incomeEntries  = []; // all income rows across all months
let monthlyBudgets = {}; // "year-month" -> amount
let settings       = { currency: { symbol: '$', code: 'USD' } };
let currentUser    = null;
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
      currentUser    = null;
      expenses       = [];
      incomeEntries  = [];
      monthlyBudgets = {};
      settings       = { currency: { symbol: '$', code: 'USD' } };
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
  document.getElementById('authSub').textContent        = signup ? 'Track expenses with your family' : 'Sign in to continue';
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
  const [expRes, setRes, budRes, incRes] = await Promise.all([
    sb.from('expenses').select('*').order('date', { ascending: false }),
    sb.from('user_settings').select('*').eq('user_id', currentUser.id).maybeSingle(),
    sb.from('monthly_budgets').select('*').eq('user_id', currentUser.id),
    sb.from('monthly_income').select('*').order('created_at', { ascending: true }),
  ]);

  if (!expRes.error && expRes.data)
    expenses = expRes.data.map(e => ({ ...e, amount: parseFloat(e.amount) }));

  if (!setRes.error && setRes.data)
    settings = { currency: { code: setRes.data.currency_code, symbol: setRes.data.currency_symbol } };

  if (!budRes.error && budRes.data) {
    monthlyBudgets = {};
    budRes.data.forEach(r => { monthlyBudgets[bk(r.year, r.month)] = parseFloat(r.amount); });
  }

  if (!incRes.error && incRes.data)
    incomeEntries = incRes.data.map(r => ({ ...r, amount: parseFloat(r.amount) }));
}

/* ─── Key helpers ───────────────────────────────────────── */
function bk(y, m) { return `${y}-${m}`; }
function getCat(id)  { return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]; }
function fmt(n)      { return `${settings.currency.symbol}${parseFloat(n).toFixed(2)}`; }
function todayISO()  { return new Date().toISOString().split('T')[0]; }
function escHtml(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function getMonthExpenses() {
  return expenses.filter(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });
}

function getMonthIncome() {
  return incomeEntries.filter(r => r.year === currentYear && r.month === currentMonth);
}

function getCurrentBudget() { return monthlyBudgets[bk(currentYear, currentMonth)] || 0; }

function formatDate(s) {
  const d    = new Date(s + 'T00:00:00');
  const now  = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())  return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getMonthLabel(y, m) {
  return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function groupByCategory(list) {
  return list.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = { total: 0, count: 0 };
    acc[e.category].total += e.amount; acc[e.category].count++;
    return acc;
  }, {});
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden'); t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200); }, 2200);
}

/* ─── DB: Expenses ──────────────────────────────────────── */
async function dbAddExpense(data) {
  const { data: row, error } = await sb.from('expenses')
    .insert({ user_id: currentUser.id, ...data }).select().single();
  if (error) throw error;
  expenses.unshift({ ...row, amount: parseFloat(row.amount) });
}

async function dbUpdateExpense(id, data) {
  const { error } = await sb.from('expenses').update(data).eq('id', id);
  if (error) throw error;
  const i = expenses.findIndex(e => e.id === id);
  if (i !== -1) expenses[i] = { ...expenses[i], ...data, amount: parseFloat(data.amount) };
}

async function dbDeleteExpense(id) {
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

/* ─── DB: Budget ────────────────────────────────────────── */
async function dbSetBudget(year, month, amount) {
  const { error } = await sb.from('monthly_budgets')
    .upsert({ user_id: currentUser.id, year, month, amount }, { onConflict: 'user_id,year,month' });
  if (error) throw error;
  monthlyBudgets[bk(year, month)] = amount;
}

async function dbClearBudget(year, month) {
  const { error } = await sb.from('monthly_budgets').delete()
    .eq('user_id', currentUser.id).eq('year', year).eq('month', month);
  if (error) throw error;
  delete monthlyBudgets[bk(year, month)];
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
  renderBreakdownView();
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
  const list   = getMonthExpenses();
  const income = getMonthIncome();
  const spent  = list.reduce((s, e) => s + e.amount, 0);
  const earned = income.reduce((s, r) => s + r.amount, 0);
  const saved  = earned - spent;
  const budget = getCurrentBudget();
  const hasIncome = earned > 0;

  // Hero
  const heroEl   = document.getElementById('summaryHero');
  const labelEl  = document.getElementById('summaryLabel');
  if (hasIncome) {
    labelEl.textContent = saved >= 0 ? 'Saved this month' : 'Over income';
    heroEl.textContent  = fmt(Math.abs(saved));
    heroEl.style.color  = saved >= 0 ? '#86efac' : '#fca5a5';
  } else {
    labelEl.textContent = 'Total spent';
    heroEl.textContent  = fmt(spent);
    heroEl.style.color  = '';
  }

  // Income row
  const incomeRow = document.getElementById('incomeRow');
  const metaRow   = document.getElementById('summaryMeta');
  if (hasIncome) {
    document.getElementById('earnedVal').textContent = fmt(earned);
    document.getElementById('spentVal').textContent  = fmt(spent);
    incomeRow.classList.remove('hidden');
    metaRow.classList.add('hidden');
  } else {
    incomeRow.classList.add('hidden');
    metaRow.classList.remove('hidden');
    const n = list.length;
    document.getElementById('expenseCount').textContent =
      n === 0 ? '0 expenses' : n === 1 ? '1 expense' : `${n} expenses`;
  }

  // Budget pill
  const pill     = document.getElementById('budgetPill');
  const pillText = document.getElementById('budgetPillText');
  if (budget > 0) {
    const rem  = budget - spent;
    const over = rem < 0;
    const pct  = Math.min(Math.round((spent / budget) * 100), 100);
    pill.classList.toggle('budget-over', over);
    pill.classList.remove('budget-unset');
    pillText.textContent = over
      ? `${fmt(Math.abs(rem))} over budget · ${pct}%`
      : `${fmt(rem)} left · ${pct}% of ${fmt(budget)}`;
  } else {
    pill.classList.add('budget-unset');
    pill.classList.remove('budget-over');
    pillText.textContent = '+ Set budget for this month';
  }

  renderCategoryBars(list, spent);
}

function renderCategoryBars(list, total) {
  const el = document.getElementById('categoryBars');
  el.innerHTML = '';
  if (total === 0) {
    const s = document.createElement('div');
    s.className = 'category-bar-segment';
    s.style.cssText = 'width:100%;background:rgba(255,255,255,0.2);';
    el.appendChild(s); return;
  }
  Object.entries(groupByCategory(list))
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([, d]) => {
      const seg = document.createElement('div');
      seg.className = 'category-bar-segment';
      seg.style.cssText = `width:${(d.total / total) * 100}%;background:rgba(255,255,255,0.65);`;
      el.appendChild(seg);
    });
}

function renderListView() {
  const container = document.getElementById('expenseList');
  const list = getMonthExpenses();
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💸</div><p>No expenses yet</p><span>Tap + to add your first one</span></div>`;
    return;
  }
  const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  const groups = sorted.reduce((acc, e) => { (acc[e.date] = acc[e.date] || []).push(e); return acc; }, {});
  container.innerHTML = '';
  Object.entries(groups).sort(([a], [b]) => new Date(b) - new Date(a)).forEach(([date, items]) => {
    const lbl = document.createElement('div');
    lbl.className = 'date-group-label'; lbl.textContent = formatDate(date);
    container.appendChild(lbl);
    items.forEach(e => container.appendChild(buildItem(e)));
  });
}

function buildItem(e) {
  const cat = getCat(e.category);
  const el  = document.createElement('div');
  el.className = 'expense-item'; el.dataset.id = e.id;
  el.innerHTML = `
    <div class="expense-icon" style="background:${cat.bg};">${cat.emoji}</div>
    <div class="expense-info">
      <div class="expense-desc">${escHtml(e.description)}</div>
      <div class="expense-meta"><span>${cat.label}</span>${e.note ? `<span>·</span><span>${escHtml(e.note)}</span>` : ''}</div>
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

function renderBreakdownView() {
  const container = document.getElementById('breakdownList');
  const list  = getMonthExpenses();
  const total = list.reduce((s, e) => s + e.amount, 0);
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>No data yet</p><span>Add some expenses to see breakdown</span></div>`;
    return;
  }
  const grouped = groupByCategory(list);
  const sorted  = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);
  const max     = sorted[0][1].total;
  container.innerHTML = '';
  sorted.forEach(([catId, d]) => {
    const cat = getCat(catId);
    const pct = total > 0 ? (d.total / total) * 100 : 0;
    const bar = total > 0 ? (d.total / max)   * 100 : 0;
    const el  = document.createElement('div');
    el.className = 'breakdown-item';
    el.innerHTML = `
      <div class="breakdown-header">
        <div class="breakdown-icon" style="background:${cat.bg};">${cat.emoji}</div>
        <div class="breakdown-info">
          <div class="breakdown-name">${cat.label}</div>
          <div class="breakdown-count">${d.count} ${d.count === 1 ? 'expense' : 'expenses'} · ${pct.toFixed(1)}%</div>
        </div>
        <div class="breakdown-amount">${fmt(d.total)}</div>
      </div>
      <div class="breakdown-bar-track">
        <div class="breakdown-bar-fill" style="width:0;background:${cat.color};" data-w="${bar}"></div>
      </div>`;
    container.appendChild(el);
  });
  requestAnimationFrame(() => {
    container.querySelectorAll('.breakdown-bar-fill').forEach(el => { el.style.width = el.dataset.w + '%'; });
  });
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

/* ─── Add / Edit Expense Modal ──────────────────────────── */
function openAddModal() {
  selectedCategory = CATEGORIES[0].id; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'New Expense';
  document.getElementById('submitBtn').textContent  = 'Add Expense';
  document.getElementById('amountInput').value  = '';
  document.getElementById('descInput').value    = '';
  document.getElementById('noteInput').value    = '';
  document.getElementById('editId').value       = '';
  document.getElementById('dateInput').value    = todayISO();
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  openModal('expenseModal');
  setTimeout(() => document.getElementById('amountInput').focus(), 300);
}

function openEditModal(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  selectedCategory = e.category; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'Edit Expense';
  document.getElementById('submitBtn').textContent  = 'Save Changes';
  document.getElementById('amountInput').value  = parseFloat(e.amount).toFixed(2);
  document.getElementById('descInput').value    = e.description;
  document.getElementById('noteInput').value    = e.note || '';
  document.getElementById('editId').value       = e.id;
  document.getElementById('dateInput').value    = e.date;
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  openModal('expenseModal');
}

async function handleFormSubmit(ev) {
  ev.preventDefault();
  const amount = parseFloat(document.getElementById('amountInput').value);
  const desc   = document.getElementById('descInput').value.trim();
  const date   = document.getElementById('dateInput').value;
  const note   = document.getElementById('noteInput').value.trim();
  const editId = document.getElementById('editId').value;
  if (!amount || amount <= 0) { document.getElementById('amountInput').focus(); return; }
  if (!desc)                   { document.getElementById('descInput').focus();   return; }
  if (!date) return;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = editId ? 'Saving…' : 'Adding…';
  try {
    if (editId) {
      await dbUpdateExpense(editId, { amount, description: desc, category: selectedCategory, date, note: note || null });
      showToast('Expense updated');
    } else {
      await dbAddExpense({ amount, description: desc, category: selectedCategory, date, note: note || null });
      showToast('Expense added');
    }
    closeModal('expenseModal'); renderAll();
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = editId ? 'Save Changes' : 'Add Expense'; }
}

/* ─── Income Modal ──────────────────────────────────────── */
function openIncomeModal() {
  document.getElementById('incomeModalTitle').textContent   = `Income · ${getMonthLabel(currentYear, currentMonth)}`;
  document.getElementById('incomeCurrencySymbol').textContent = settings.currency.symbol;
  document.getElementById('incomeAmountInput').value  = '';
  document.getElementById('incomeSourceInput').value  = '';
  document.getElementById('incomeNoteInput').value    = '';
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
        renderIncomeList();
        renderSummary();
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
    renderIncomeList();
    renderSummary();
    showToast('Income added');
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Add Income'; }
}

/* ─── Budget Modal ──────────────────────────────────────── */
function openBudgetModal() {
  const budget = getCurrentBudget();
  document.getElementById('budgetModalTitle').textContent  = `${getMonthLabel(currentYear, currentMonth)} Budget`;
  document.getElementById('budgetModalSymbol').textContent = settings.currency.symbol;
  document.getElementById('budgetAmountInput').value       = budget > 0 ? budget.toFixed(2) : '';
  document.getElementById('clearBudgetBtn').classList.toggle('hidden', budget === 0);
  openModal('budgetModal');
  setTimeout(() => document.getElementById('budgetAmountInput').focus(), 300);
}

async function handleBudgetSave(ev) {
  ev.preventDefault();
  const val = parseFloat(document.getElementById('budgetAmountInput').value);
  if (!val || val <= 0) { document.getElementById('budgetAmountInput').focus(); return; }
  const btn = document.getElementById('saveBudgetBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await dbSetBudget(currentYear, currentMonth, val);
    closeModal('budgetModal'); renderSummary(); showToast('Budget saved');
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Save Budget'; }
}

async function handleBudgetClear() {
  try {
    await dbClearBudget(currentYear, currentMonth);
    closeModal('budgetModal'); renderSummary(); showToast('Budget removed');
  } catch (err) { showToast('Error: ' + err.message); }
}

/* ─── Delete Expense ────────────────────────────────────── */
function openDeleteConfirm(id) { pendingDeleteId = id; openModal('deleteModal'); }

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('confirmDelete');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await dbDeleteExpense(pendingDeleteId);
    closeModal('deleteModal'); pendingDeleteId = null; renderAll(); showToast('Expense deleted');
  } catch (err) { showToast('Error: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Delete'; }
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
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.add('hidden');    document.body.style.overflow = ''; }
function closeAllModals() {
  ['expenseModal', 'incomeModal', 'budgetModal', 'settingsModal', 'deleteModal'].forEach(closeModal);
}

/* ─── View Switching ────────────────────────────────────── */
function switchView(view) {
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('listView').classList.toggle('hidden', view !== 'list');
  document.getElementById('breakdownView').classList.toggle('hidden', view !== 'breakdown');
  if (view === 'breakdown') renderBreakdownView();
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

  // Expense
  document.getElementById('openAdd').addEventListener('click', openAddModal);
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('closeModal').addEventListener('click', () => closeModal('expenseModal'));

  // Income
  document.getElementById('logIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('editIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('incomeForm').addEventListener('submit', handleIncomeSubmit);
  document.getElementById('closeIncomeModal').addEventListener('click', () => closeModal('incomeModal'));

  // Budget
  document.getElementById('budgetPill').addEventListener('click', openBudgetModal);
  document.getElementById('budgetAmountForm').addEventListener('submit', handleBudgetSave);
  document.getElementById('clearBudgetBtn').addEventListener('click', handleBudgetClear);
  document.getElementById('closeBudgetModal').addEventListener('click', () => closeModal('budgetModal'));

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
    if (!confirm('Delete ALL your expenses? This cannot be undone.')) return;
    try {
      await sb.from('expenses').delete().eq('user_id', currentUser.id);
      expenses = []; closeModal('settingsModal'); renderAll(); showToast('All expenses cleared');
    } catch (err) { showToast('Error: ' + err.message); }
  });

  // Backdrop clicks
  ['expenseModal', 'incomeModal', 'budgetModal', 'settingsModal', 'deleteModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  // View toggle
  document.querySelectorAll('.toggle-btn, .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
