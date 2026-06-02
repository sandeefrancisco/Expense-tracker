'use strict';

/* ─── Supabase ──────────────────────────────────────────── */
const SUPABASE_URL      = 'https://eizhfvieozigsgolckez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpemhmdmllb3ppZ3Nnb2xja2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTEyMDUsImV4cCI6MjA5NTc2NzIwNX0.v-qAHGR-I63RL4Ue0YH5evTwot9riE-nUuw0ACffaYA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── Bank definitions ──────────────────────────────────── */
const BANKS = ['BDO', 'BPI', 'N26', 'Commerzbank'];

/* ─── Currency definitions ──────────────────────────────── */
const CURRENCIES = [
  { code: 'EUR', symbol: '€',  label: '€ EUR' },
  { code: 'USD', symbol: '$',  label: '$ USD' },
  { code: 'PHP', symbol: '₱',  label: '₱ PHP' },
  { code: 'GBP', symbol: '£',  label: '£ GBP' },
  { code: 'JPY', symbol: '¥',  label: '¥ JPY' },
  { code: 'INR', symbol: '₹',  label: '₹ INR' },
  { code: 'AUD', symbol: 'A$', label: 'A$ AUD' },
  { code: 'CAD', symbol: 'C$', label: 'C$ CAD' },
  { code: 'CHF', symbol: 'Fr', label: 'Fr CHF' },
  { code: 'SGD', symbol: 'S$', label: 'S$ SGD' },
];

function buildBankGrid(current) {
  const grid = document.getElementById('bankGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'bank-chip' + (!current ? ' active' : '');
  none.textContent = 'None';
  none.addEventListener('click', () => { selectedBank = null; buildBankGrid(null); });
  grid.appendChild(none);

  BANKS.forEach(name => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bank-chip' + (current === name ? ' active' : '');
    chip.textContent = name;
    chip.addEventListener('click', () => { selectedBank = name; buildBankGrid(name); });
    grid.appendChild(chip);
  });
}

/* ─── Category colour palette ───────────────────────────── */
const CATEGORY_COLORS = [
  '#7c3aed','#1d4ed8','#059669','#db2777',
  '#b45309','#dc2626','#0d9488','#ea580c',
  '#0891b2','#475569',
];

/* ─── State ─────────────────────────────────────────────── */
let expenses          = [];
let incomeEntries     = [];
let profiles          = [];
let categories        = [];
let currentProfileId  = null;
let completedMonths   = [];
let settings          = { currency: { symbol: '€', code: 'EUR' } };
let currentUser       = null;
let currentYear, currentMonth;
let pendingDeleteId          = null;
let pendingInstallmentCatId  = null;
let selectedCategory  = null;
let selectedBank      = null;
let selectedCatShared   = false;
let authMode            = 'signin';
let movePickerYear      = null;
let movePickerMonth     = null;
let moveModalMode       = 'move'; // 'move' | 'duplicate'
let rateCache           = {}; // { 'PHP': 0.01612 } — fromCode → primary currency multiplier
const expandedListGroups = new Set(); // prefix keys of expanded group parents in list view
const expandedListCats   = new Set(); // catIds of expanded categories in list view
let   listViewMonth      = null;      // "YYYY-M" — tracks month for auto-expand reset

function saveExpandState() {
  localStorage.setItem(`exState_${currentYear}_${currentMonth}`,
    JSON.stringify({ g: [...expandedListGroups], c: [...expandedListCats] }));
}
function loadExpandState() {
  try {
    const raw = localStorage.getItem(`exState_${currentYear}_${currentMonth}`);
    if (!raw) return false;
    const { g = [], c = [] } = JSON.parse(raw);
    expandedListGroups.clear(); expandedListCats.clear();
    g.forEach(x => expandedListGroups.add(x));
    c.forEach(x => expandedListCats.add(x));
    return true;
  } catch { return false; }
}

const DND_HANDLE = `<div class="drag-handle" aria-label="Drag to reorder"><svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="5" cy="3.5" r="1.4"/><circle cx="11" cy="3.5" r="1.4"/><circle cx="5" cy="7.5" r="1.4"/><circle cx="11" cy="7.5" r="1.4"/><circle cx="5" cy="11.5" r="1.4"/><circle cx="11" cy="11.5" r="1.4"/></svg></div>`;


/* ─── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);

function saveViewMonth() {
  localStorage.setItem('viewYear',  currentYear);
  localStorage.setItem('viewMonth', currentMonth);
}

async function init() {
  const now        = new Date();
  const savedYear  = parseInt(localStorage.getItem('viewYear'),  10);
  const savedMonth = parseInt(localStorage.getItem('viewMonth'), 10);
  currentYear  = !isNaN(savedYear)  ? savedYear  : now.getFullYear();
  currentMonth = !isNaN(savedMonth) ? savedMonth : now.getMonth();

  bindEvents();

  const { data: { session } } = await sb.auth.getSession();

  if (session?.user) {
    currentUser = session.user;
    // Skeleton (loading screen) stays visible during the data fetch
    await loadUserData();
    buildCategoryGrid();
    showApp();
    hideLoading(); // remove skeleton once the real content is painted
  } else {
    showAuth();
    hideLoading();
  }

  const bootstrappedUserId = session?.user?.id ?? null;

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;

    if (event === 'SIGNED_IN' && session?.user) {
      if (session.user.id === bootstrappedUserId) return;
      currentUser = session.user;
      showSkeleton(); // instantly hide auth form and show skeleton while data loads
      await loadUserData();
      buildCategoryGrid();
      showApp();
      hideLoading();
    } else if (event === 'SIGNED_OUT') {
      currentUser      = null;
      expenses         = [];
      incomeEntries    = [];
      profiles         = [];
      currentProfileId = null;
      completedMonths  = [];
      settings         = { currency: { symbol: '€', code: 'EUR' } };
      localStorage.removeItem('activeProfileId');
      showAuth();
    }
  });
}

/* ─── Loading / Skeleton ────────────────────────────────── */
function hideLoading()  { document.getElementById('loadingScreen').classList.add('hidden'); }

function showSkeleton() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('loadingScreen').classList.remove('hidden');
}

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
  const [expRes, setRes, incRes, profRes, doneRes, catRes] = await Promise.all([
    sb.from('expenses').select('*').order('created_at', { ascending: false }),
    sb.from('user_settings').select('*').eq('user_id', currentUser.id).maybeSingle(),
    sb.from('monthly_income').select('*').order('created_at', { ascending: true }),
    sb.from('profiles').select('*').order('created_at', { ascending: true }),
    sb.from('completed_months').select('profile_id,year,month'),
    sb.from('categories').select('*').order('created_at', { ascending: true }),
  ]);

  if (!expRes.error && expRes.data)
    expenses = expRes.data.map(e => ({ ...e, amount: parseFloat(e.amount) }));

  if (!setRes.error && setRes.data)
    settings = { currency: { code: setRes.data.currency_code, symbol: setRes.data.currency_symbol } };

  if (!incRes.error && incRes.data)
    incomeEntries = incRes.data.map(r => ({ ...r, amount: parseFloat(r.amount) }));

  if (!profRes.error && profRes.data) profiles = profRes.data;
  if (!doneRes.error && doneRes.data) completedMonths = doneRes.data;
  if (!catRes.error  && catRes.data)  categories = catRes.data;

  // Auto-create default profile for new users
  if (profiles.length === 0) {
    const { data: prof, error } = await sb.from('profiles')
      .insert({ user_id: currentUser.id, name: 'Me' }).select().single();
    if (!error && prof) profiles = [prof];
  }

  // Seed default categories for new users
  if (categories.length === 0) {
    const seeds = [
      { name: 'Housing',   color: '#1d4ed8' },
      { name: 'Food',      color: '#ea580c' },
      { name: 'Transport', color: '#059669' },
      { name: 'Personal',  color: '#7c3aed' },
    ];
    const { data: rows, error } = await sb.from('categories')
      .insert(seeds.map(s => ({ ...s, user_id: currentUser.id }))).select();
    if (!error && rows) categories = rows;
  }

  await loadExchangeRates();

  const savedProfileId = localStorage.getItem('activeProfileId');
  if (savedProfileId && profiles.find(p => p.id === savedProfileId)) {
    currentProfileId = savedProfileId;
  } else {
    currentProfileId = profiles[0]?.id || null;
    if (currentProfileId) localStorage.setItem('activeProfileId', currentProfileId);
  }

  if (!selectedCategory || !categories.find(c => c.id === selectedCategory))
    selectedCategory = categories[0]?.id || null;
}

/* ─── Exchange Rates (Wise-sourced, cached per-hour) ────── */
async function fetchRate(fromCode, toCode) {
  if (fromCode === toCode) return 1;
  const hour  = new Date().toISOString().slice(0, 13); // "2026-06-02T14" — hourly bucket
  const lsKey = `er_${fromCode}_${toCode}_${hour}`;
  const srcKey = lsKey + '_src';
  const cached = localStorage.getItem(lsKey);
  if (cached) return parseFloat(cached);

  const apis = [
    { name: 'Wise',
      url: `https://api.wise.com/v1/rates?source=${fromCode}&target=${toCode}`,
      extract: j => Array.isArray(j) ? j[0]?.rate : null },
    { name: 'ER-API',
      url: `https://open.er-api.com/v6/latest/${toCode}`,
      extract: j => j.rates?.[fromCode] > 0 ? 1 / j.rates[fromCode] : null },
    { name: 'fawazahmed0',
      url: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${toCode.toLowerCase()}.min.json`,
      extract: j => { const v = j[toCode.toLowerCase()]?.[fromCode.toLowerCase()]; return v > 0 ? 1 / v : null; } },
  ];

  for (const { name, url, extract } of apis) {
    try {
      const json = await (await fetch(url)).json();
      const rate = extract(json);
      if (rate > 0) {
        localStorage.setItem(lsKey,  String(rate));
        localStorage.setItem(srcKey, name);
        return rate;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function loadExchangeRates() {
  const primary = settings.currency.code;
  const used    = new Set(categories.map(c => c.currency_code).filter(Boolean));
  used.delete(primary);
  rateCache = {};
  await Promise.all([...used].map(async code => {
    const r = await fetchRate(code, primary);
    if (r != null) rateCache[code] = r;
  }));
}

async function renderRates() {
  const panel = document.getElementById('ratesDisplay');
  if (!panel) return;
  const primary = settings.currency;
  const used = [...new Set(categories.map(c => c.currency_code).filter(Boolean))].filter(c => c !== primary.code);
  if (used.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const hour = new Date().toISOString().slice(0, 13);
  const rows = used.map(code => {
    const cur    = CURRENCIES.find(x => x.code === code) || { code, symbol: code };
    const lsKey  = `er_${code}_${primary.code}_${hour}`;
    const cached = localStorage.getItem(lsKey);
    const src    = localStorage.getItem(lsKey + '_src') || '';
    const rate   = cached ? parseFloat(cached) : null;
    const rateStr = rate ? `${primary.symbol}1 = ${cur.symbol}${(1 / rate).toFixed(2)}` : '—';
    return `<div class="rate-row"><span class="rate-pair">${rateStr}</span><span class="rate-src">${src ? 'via ' + src : ''}</span></div>`;
  }).join('');
  panel.innerHTML = `<div class="rates-header"><span class="rates-label">Live Rates</span><button class="rates-refresh-btn" id="ratesRefreshBtn">↻ Refresh</button></div><div>${rows}</div>`;
  document.getElementById('ratesRefreshBtn').addEventListener('click', async () => {
    const h = new Date().toISOString().slice(0, 13);
    used.forEach(code => {
      const k = `er_${code}_${primary.code}_${h}`;
      localStorage.removeItem(k);
      localStorage.removeItem(k + '_src');
    });
    rateCache = {};
    panel.innerHTML = `<div class="rates-header"><span class="rates-label">Live Rates</span><span class="rate-src">Fetching…</span></div>`;
    await loadExchangeRates();
    renderRates();
  });
}

// Returns amount converted to primary currency, or null if rate unknown
function toBase(amount, code) {
  if (code === settings.currency.code) return amount;
  const rate = rateCache[code];
  return rate != null ? amount * rate : null;
}

/* ─── Helpers ───────────────────────────────────────────── */
function getCat(id) {
  const c = categories.find(c => c.id === id) || { id: 'other', name: 'Other', color: '#868e96', shared: false };
  if (!c.shared && /shared/i.test(c.name)) return { ...c, shared: true };
  return c;
}
function getCatCurrency(catId) {
  const c = getCat(catId);
  return (c.currency_code && c.currency_symbol)
    ? { code: c.currency_code, symbol: c.currency_symbol }
    : settings.currency;
}
function fmtNum(n) {
  return parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(n)      { return `${settings.currency.symbol}${fmtNum(n)}`; }
function fmtCat(n, catId) { const { symbol } = getCatCurrency(catId); return `${symbol}${fmtNum(n)}`; }
function fmtGroupTotal(catIds, byCat) {
  const acc = {};
  catIds.forEach(id => {
    if (!byCat[id]) return;
    const { code, symbol } = getCatCurrency(id);
    if (!acc[code]) acc[code] = { symbol, total: 0 };
    acc[code].total += byCat[id].total;
  });
  return Object.values(acc).map(({ symbol, total }) => `${symbol}${fmtNum(total)}`).join(' · ');
}
function fmtGroupGrandTotal(catIds, byCat) {
  const acc = {};
  catIds.forEach(id => {
    if (!byCat[id]) return;
    const { code, symbol } = getCatCurrency(id);
    if (!acc[code]) acc[code] = { symbol, total: 0 };
    acc[code].total += (byCat[id].total || 0) + (byCat[id].paidTotal || 0);
  });
  return Object.values(acc).map(({ symbol, total }) => `${symbol}${fmtNum(total)}`).join(' · ');
}
function fmtGroupDoneTotal(catIds, byCat) {
  const acc = {};
  catIds.forEach(id => {
    if (!byCat[id] || !byCat[id].paidTotal) return;
    const { code, symbol } = getCatCurrency(id);
    if (!acc[code]) acc[code] = { symbol, total: 0 };
    acc[code].total += byCat[id].paidTotal;
  });
  const parts = Object.values(acc).filter(v => v.total > 0).map(({ symbol, total }) => `${symbol}${fmtNum(total)}`);
  return parts.join(' · ');
}
function parseAmount(str) { return parseFloat(String(str).replace(',', '.')); }
function effectiveAmount(e) { const c = getCat(e.category); return c.shared ? e.amount / 2 : e.amount; }

function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function expenseInstallmentHtml(e) {
  if (!e.installment_total || !e.installment_current) return '';
  const due  = e.installment_due_day ? ` · due ${ordinal(e.installment_due_day)}` : '';
  const done = e.installment_current >= e.installment_total;
  return `<div class="expense-installment${done ? ' expense-installment--done' : ''}">${e.installment_current}/${e.installment_total}${due}</div>`;
}

/* Returns a map of first-word-prefix → [catId, ...] for prefixes shared by 2+ categories */
function detectPrefixGroups(catIds) {
  const prefixMap = {};
  catIds.forEach(id => {
    const firstWord = getCat(id).name.split(/\s+/)[0];
    if (!prefixMap[firstWord]) prefixMap[firstWord] = [];
    prefixMap[firstWord].push(id);
  });
  return Object.fromEntries(Object.entries(prefixMap).filter(([, ids]) => ids.length >= 2));
}
function escHtml(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function monthStartISO() {
  const m = String(currentMonth + 1).padStart(2, '0');
  return `${currentYear}-${m}-01`;
}

function getMonthExpenses() {
  return expenses.filter(e => {
    if (e.profile_id !== currentProfileId) return false;
    const d = new Date(e.date + 'T00:00:00');
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });
}

function getMonthIncome() {
  return incomeEntries.filter(r =>
    r.profile_id === currentProfileId &&
    r.year === currentYear && r.month === currentMonth
  );
}

function getMonthLabel(y, m) {
  return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function isMonthDone(y, m) {
  return completedMonths.some(c => c.profile_id === currentProfileId && c.year === y && c.month === m);
}

async function toggleMonthDone() {
  const y = currentYear, m = currentMonth;
  const done = isMonthDone(y, m);
  if (done) {
    completedMonths = completedMonths.filter(c => !(c.profile_id === currentProfileId && c.year === y && c.month === m));
    renderHeader(); renderSummary();
    try {
      const { error } = await sb.from('completed_months').delete()
        .eq('user_id', currentUser.id).eq('profile_id', currentProfileId).eq('year', y).eq('month', m);
      if (error) throw error;
    } catch (err) {
      completedMonths.push({ profile_id: currentProfileId, year: y, month: m });
      renderHeader(); renderSummary(); showToast('Error: ' + err.message, true);
    }
  } else {
    completedMonths.push({ profile_id: currentProfileId, year: y, month: m });
    renderHeader(); renderSummary();
    try {
      const { error } = await sb.from('completed_months')
        .insert({ user_id: currentUser.id, profile_id: currentProfileId, year: y, month: m });
      if (error) throw error;
    } catch (err) {
      completedMonths = completedMonths.filter(c => !(c.profile_id === currentProfileId && c.year === y && c.month === m));
      renderHeader(); renderSummary(); showToast('Error: ' + err.message, true);
    }
  }
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'toast toast-error show' : 'toast show';
  const delay = isError ? 4500 : 2200;
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.className = 'toast hidden'; }, 300); }, delay);
}

/* ─── DB helpers (pure network calls, no state mutation) ── */
async function dbSaveExpense(payload) {
  const { data: row, error } = await sb.from('expenses').insert(payload).select().single();
  if (error) throw error;
  return row;
}
async function dbPatchExpense(id, patch) {
  const { error } = await sb.from('expenses').update(patch).eq('id', id);
  if (error) throw error;
}
async function dbRemoveExpense(id) {
  const { error } = await sb.from('expenses').delete().eq('id', id);
  if (error) throw error;
}
async function dbSaveIncome(payload) {
  const { data: row, error } = await sb.from('monthly_income').insert(payload).select().single();
  if (error) throw error;
  return row;
}
async function dbRemoveIncome(id) {
  const { error } = await sb.from('monthly_income').delete().eq('id', id);
  if (error) throw error;
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
  renderProfileBar();
  renderSummary();
  renderListView();
  syncSettingsUI();
}

/* ─── Profiles ──────────────────────────────────────────── */
function renderProfileBar() {
  // Update header trigger label
  const prof = profiles.find(p => p.id === currentProfileId);
  const lbl  = document.getElementById('profileTriggerLabel');
  if (lbl) lbl.textContent = prof?.name ?? 'Me';
  const av = document.getElementById('profileAvatarEl');
  if (av) av.textContent = (prof?.name ?? 'M').charAt(0).toUpperCase();

  // Populate profile sheet list
  const sheetList = document.getElementById('profileSheetList');
  if (!sheetList) return;
  sheetList.innerHTML = '';
  profiles.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'option-row-btn' + (p.id === currentProfileId ? ' profile-option-active' : '');
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      currentProfileId = p.id;
      localStorage.setItem('activeProfileId', p.id);
      closeModal('profileSheet');
      renderAll();
    });
    sheetList.appendChild(btn);
  });
}

function openAddProfileModal() {
  document.getElementById('profileNameInput').value = '';
  document.getElementById('profileFormError').classList.add('hidden');
  openModal('profileModal');
  setTimeout(() => document.getElementById('profileNameInput').focus(), 300);
}

async function handleAddProfile(e) {
  e.preventDefault();
  const name  = document.getElementById('profileNameInput').value.trim();
  const errEl = document.getElementById('profileFormError');
  if (!name) { errEl.textContent = 'Enter a name.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const tmp = 'tmp_' + Date.now();
  profiles.push({ id: tmp, user_id: currentUser.id, name });
  currentProfileId = tmp;
  closeModal('profileModal');
  renderAll();
  showToast(`${name} added`);

  try {
    const { data: prof, error } = await sb.from('profiles')
      .insert({ user_id: currentUser.id, name }).select().single();
    if (error) throw error;
    const idx = profiles.findIndex(p => p.id === tmp);
    if (idx !== -1) profiles[idx] = prof;
    if (currentProfileId === tmp) { currentProfileId = prof.id; localStorage.setItem('activeProfileId', prof.id); }
    renderProfileBar();
  } catch (err) {
    profiles = profiles.filter(p => p.id !== tmp);
    if (currentProfileId === tmp) { currentProfileId = profiles[0]?.id || null; if (currentProfileId) localStorage.setItem('activeProfileId', currentProfileId); }
    renderAll(); showToast('Could not save — ' + err.message, true);
  }
}

async function deleteProfile(id) {
  const prof = profiles.find(p => p.id === id);
  if (!prof) return;
  if (profiles.length <= 1) { showToast("Can't delete the only person"); return; }
  if (!confirm(`Delete "${prof.name}" and all their allocations? This cannot be undone.`)) return;
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, true); return; }
  profiles      = profiles.filter(p => p.id !== id);
  expenses      = expenses.filter(e => e.profile_id !== id);
  incomeEntries = incomeEntries.filter(r => r.profile_id !== id);
  if (currentProfileId === id) currentProfileId = profiles[0]?.id || null;
  renderAll();
  showToast(`${prof.name} deleted`);
}

function renderProfilesList() {
  const container = document.getElementById('profilesList');
  if (!container) return;
  container.innerHTML = '';
  profiles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-row-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
      <div class="settings-row-main">
        <div class="settings-row-title">${escHtml(p.name)}</div>
      </div>
      ${profiles.length > 1
        ? `<button class="settings-icon-btn danger profile-del-btn" aria-label="Delete ${escHtml(p.name)}">
             <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
           </button>`
        : '<span class="settings-row-badge">Only profile</span>'}`;
    if (profiles.length > 1) {
      row.querySelector('.profile-del-btn').addEventListener('click', () => deleteProfile(p.id));
    }
    container.appendChild(row);
  });
}

function renderHeader() {
  const done = isMonthDone(currentYear, currentMonth);
  document.getElementById('monthLabel').textContent = getMonthLabel(currentYear, currentMonth) + (done ? ' ·  done' : '');
}

function renderSummary() {
  const list   = getMonthExpenses();
  const income = getMonthIncome();
  const earned = income.reduce((s, r) => s + r.amount, 0);

  // Group effective amounts by currency code
  const byCur = {};
  list.forEach(e => {
    const cur = getCatCurrency(e.category);
    if (!byCur[cur.code]) byCur[cur.code] = { symbol: cur.symbol, total: 0 };
    byCur[cur.code].total += effectiveAmount(e);
  });
  const curEntries = Object.entries(byCur);
  const totalAll   = curEntries.reduce((s, [, v]) => s + v.total, 0);
  const isMultiCur = curEntries.length > 1;

  const heroEl  = document.getElementById('summaryHero');
  const labelEl = document.getElementById('summaryLabel');
  const subEl   = document.getElementById('summarySub');
  const n = list.length;
  const itemStr = n === 1 ? '1 item' : `${n} items`;

  heroEl.style.color = '';
  heroEl.innerHTML   = '';

  const primaryCode = settings.currency.code;
  const primarySym  = settings.currency.symbol;

  // Convert every currency bucket to primary; track what can't be converted
  let totalBase = 0;
  let allConverted = true;
  curEntries.forEach(([code, { total }]) => {
    const b = toBase(total, code);
    if (b != null) totalBase += b;
    else { allConverted = false; totalBase += (code === primaryCode ? total : 0); }
  });

  let heroIsPrimary = false;

  if (earned > 0) {
    const saved  = earned - totalBase;
    const isOver = saved < 0;
    labelEl.textContent = isOver ? 'Over budget' : 'Saved this month';
    heroEl.textContent  = `${primarySym}${fmtNum(Math.abs(saved))}`;
    subEl.textContent = `of ${primarySym}${fmtNum(earned)} earned · ${primarySym}${fmtNum(totalBase)} spent`;
    heroIsPrimary = true;
  } else if (curEntries.length === 0) {
    labelEl.textContent = 'Tracked this month';
    heroEl.textContent  = `${primarySym}0.00`;
    subEl.textContent   = itemStr;
    heroIsPrimary = true;
  } else if (curEntries.length === 1) {
    const [soleCode, { symbol, total }] = curEntries[0];
    labelEl.textContent = 'Tracked this month';
    heroEl.textContent  = `${symbol}${fmtNum(total)}`;
    subEl.textContent   = itemStr;
    heroIsPrimary = soleCode === primaryCode;
  } else if (allConverted) {
    // Multi-currency, no income — show total in primary; original breakdown in sub
    const breakdown = curEntries
      .sort((a, b) => (a[0] === primaryCode ? -1 : b[0] === primaryCode ? 1 : b[1].total - a[1].total))
      .map(([, { symbol, total }]) => `${symbol}${fmtNum(total)}`).join(' · ');
    labelEl.textContent = 'Tracked this month';
    heroEl.textContent  = `${primarySym}${fmtNum(totalBase)}`;
    subEl.textContent   = `${breakdown} · ${itemStr}`;
    heroIsPrimary = true;
  } else {
    // Fallback: primary or largest as hero, rest in sub
    const heroEntry = byCur[primaryCode]
      ? [primaryCode, byCur[primaryCode]]
      : curEntries.sort((a, b) => b[1].total - a[1].total)[0];
    const [heroCode, { symbol: hSym, total: hTotal }] = heroEntry;
    const rest = curEntries
      .filter(([code]) => code !== heroCode)
      .map(([, { symbol, total }]) => `${symbol}${fmtNum(total)}`).join(' · ');
    labelEl.textContent = 'Tracked this month';
    heroEl.textContent  = `${hSym}${fmtNum(hTotal)}`;
    subEl.textContent   = rest ? `${rest} · ${itemStr}` : itemStr;
    heroIsPrimary = heroCode === primaryCode;
  }


  // Progress bar
  const paidCount = list.filter(e => e.checked).length;
  const pct = n > 0 ? Math.round(paidCount / n * 100) : 0;
  const progText = document.getElementById('scProgText');
  const progFill = document.getElementById('scProgFill');
  const progPct  = document.getElementById('scProgPct');
  if (progText) progText.textContent = `${paidCount} of ${n} paid`;
  if (progFill) progFill.style.width = `${pct}%`;
  if (progPct) {
    progPct.textContent  = pct === 100 ? '✓ 100%' : `${pct}%`;
    progPct.style.color  = pct === 100 ? '#16a34a' : pct > 0 ? 'var(--accent)' : 'var(--muted)';
  }

  // Stats — paid vs due amounts in primary currency
  let paidBase = 0, dueBase = 0;
  list.forEach(e => {
    const cur = getCatCurrency(e.category);
    const amt = effectiveAmount(e);
    const b   = toBase(amt, cur.code) ?? (cur.code === primaryCode ? amt : 0);
    if (e.checked) paidBase += b; else dueBase += b;
  });
  const fmtStat = v => v === 0 ? `${primarySym}0` : v >= 100000
    ? `${primarySym}${(v / 1000).toFixed(0)}k`
    : `${primarySym}${Math.round(v).toLocaleString('en-US')}`;
  const statItems = document.getElementById('scStatItems');
  const statCats  = document.getElementById('scStatCats');
  if (statItems) statItems.textContent = n > 0 ? fmtStat(paidBase) : '—';
  if (statCats)  statCats.textContent  = n > 0 ? fmtStat(dueBase)  : '—';

  updateCardMenu(earned, totalAll);
}

function updateCardMenu(earned, totalAll) {
  const menu = document.getElementById('cardMenu');
  if (!menu) return;
  const done = isMonthDone(currentYear, currentMonth);
  const rows = [];
  if (earned === 0) {
    rows.push(`<button class="card-menu-item" id="cmLogIncome">Log income</button>`);
  } else {
    rows.push(`<button class="card-menu-item" id="cmEditIncome">Edit income</button>`);
  }
  if (totalAll > 0 || done) {
    rows.push(`<button class="card-menu-item ${done ? 'cm-undone' : 'cm-done'}" id="cmToggleDone">${done ? 'Undo done' : 'Mark as done'}</button>`);
  }
  if (totalAll > 0) {
    rows.push(`<button class="card-menu-item" id="cmMoveTo">Move to…</button>`);
    rows.push(`<button class="card-menu-item" id="cmDuplicateTo">Duplicate to…</button>`);
    rows.push(`<button class="card-menu-item cm-danger" id="cmDeleteMonth">Delete month…</button>`);
  }
  menu.innerHTML = rows.join('');
  const close = () => menu.classList.add('hidden');
  menu.querySelector('#cmLogIncome')?.addEventListener('click',    () => { close(); openIncomeModal(); });
  menu.querySelector('#cmEditIncome')?.addEventListener('click',   () => { close(); openIncomeModal(); });
  menu.querySelector('#cmToggleDone')?.addEventListener('click',   () => { close(); toggleMonthDone(); });
  menu.querySelector('#cmMoveTo')?.addEventListener('click',       () => { close(); openMoveModal(); });
  menu.querySelector('#cmDuplicateTo')?.addEventListener('click',  () => { close(); openDuplicateMonthModal(); });
  menu.querySelector('#cmDeleteMonth')?.addEventListener('click',  () => { close(); openDeleteMonthConfirm(); });
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
    acc[e.category] = (acc[e.category] || 0) + effectiveAmount(e); return acc;
  }, {});
  Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .forEach(([catId, amount]) => {
      const cat = getCat(catId);
      const seg = document.createElement('div');
      seg.className = 'category-bar-segment';
      seg.title = cat.name;
      seg.style.cssText = `width:${(amount / total) * 100}%;background:${cat.color};opacity:0.7;`;
      el.appendChild(seg);
    });
}

/* ─── Drag & Drop ───────────────────────────────────────────── */
let dnd = null;

function setupDrag(container, getDraggables, onReorder, handleSelector = '.drag-handle', threshold = 0) {
  container.addEventListener('pointerdown', ev => {
    const handle = ev.target.closest(handleSelector);
    if (!handle) return;
    const draggable = handle.closest('[data-drag-id]');
    if (!draggable) return;
    if (!getDraggables().includes(draggable)) return;

    const doInitDrag = (startEv) => {
      startEv.preventDefault();
      startEv.stopPropagation();
      handle.setPointerCapture(startEv.pointerId);

      const rect = draggable.getBoundingClientRect();
      const ghost = draggable.cloneNode(true);
      Object.assign(ghost.style, {
        position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', margin: '0', zIndex: '9999',
        pointerEvents: 'none', opacity: '0.95', borderRadius: '14px',
        boxShadow: '0 12px 40px rgba(26,26,46,0.28)', transform: 'scale(1.02)',
      });
      document.body.appendChild(ghost);
      draggable.classList.add('drag-source');

      const indicator = document.createElement('div');
      indicator.className = 'drag-indicator';

      dnd = { draggable, ghost, indicator, container, getDraggables, onReorder,
              offsetY: startEv.clientY - rect.top, insertBefore: null };

      handle.addEventListener('pointermove', onDndMove, { passive: false });
      handle.addEventListener('pointerup',   onDndEnd,  { once: true });
      handle.addEventListener('pointercancel', () => {
        if (!dnd) return;
        dnd.ghost.remove(); dnd.indicator.remove();
        dnd.draggable.classList.remove('drag-source');
        dnd = null;
      }, { once: true });
    };

    if (threshold === 0) {
      doInitDrag(ev);
    } else {
      const startY = ev.clientY;
      const onPre = (moveEv) => {
        if (Math.abs(moveEv.clientY - startY) >= threshold) {
          handle.removeEventListener('pointermove', onPre);
          doInitDrag(moveEv);
        }
      };
      handle.addEventListener('pointermove', onPre, { passive: false });
      handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', onPre), { once: true });
    }
  });
}

function onDndMove(ev) {
  if (!dnd) return;
  ev.preventDefault();
  const { ghost, indicator, container, draggable, getDraggables, offsetY } = dnd;
  ghost.style.top = (ev.clientY - offsetY) + 'px';

  const siblings = getDraggables().filter(el => el !== draggable);
  let insertBefore = null;
  for (const sib of siblings) {
    const r = sib.getBoundingClientRect();
    if (ev.clientY < r.top + r.height * 0.5) { insertBefore = sib; break; }
  }
  (insertBefore?.parentElement ?? container).insertBefore(indicator, insertBefore ?? null);
  dnd.insertBefore = insertBefore;
}

function onDndEnd() {
  if (!dnd) return;
  const { draggable, ghost, indicator, container, getDraggables, onReorder, insertBefore } = dnd;
  dnd = null;
  ghost.remove();
  indicator.remove();
  draggable.classList.remove('drag-source');
  container.insertBefore(draggable, insertBefore ?? null);
  onReorder(getDraggables().map(el => el.dataset.dragId));
}

async function saveExpenseOrder(orderedIds) {
  orderedIds.forEach((id, idx) => {
    const e = expenses.find(e => e.id === id);
    if (e) e.sort_order = idx + 1;
  });
  try {
    await Promise.all(orderedIds.map((id, idx) => dbPatchExpense(id, { sort_order: idx + 1 })));
  } catch (err) {
    showToast('Could not save order — ' + err.message, true);
    renderListView();
  }
}

async function saveCategoryOrder(orderedTileIds) {
  const cont = document.getElementById('expenseList');
  let counter = 1;
  const updates = [];
  for (const dragId of orderedTileIds) {
    const tileEl = [...cont.querySelectorAll('[data-drag-id]')].find(el => el.dataset.dragId === dragId);
    const catIds = tileEl?.dataset.catIds ? JSON.parse(tileEl.dataset.catIds) : [dragId];
    const sorted = [...catIds].sort((a, b) => (getCat(a).sort_order ?? 99999) - (getCat(b).sort_order ?? 99999));
    for (const id of sorted) {
      const cat = categories.find(c => c.id === id);
      if (cat) { cat.sort_order = counter; updates.push({ id, sort_order: counter }); }
      counter++;
    }
  }
  try {
    await Promise.all(updates.map(u => sb.from('categories').update({ sort_order: u.sort_order }).eq('id', u.id)));
  } catch (err) {
    showToast('Could not save order — ' + err.message, true);
    renderAll();
  }
}

function renderItemsBody(items, container) {
  const byOrder = (a, b) => ((a.sort_order ?? 99999) - (b.sort_order ?? 99999)) || b.amount - a.amount;
  const unchecked = items.filter(e => !e.checked).sort(byOrder);
  const checked   = items.filter(e =>  e.checked).sort(byOrder);

  unchecked.forEach(e => container.appendChild(buildItem(e)));
  if (unchecked.length > 0 && checked.length > 0) {
    const d = document.createElement('div');
    d.className = 'items-done-divider';
    d.textContent = checked.length === 1 ? '1 done' : `${checked.length} done`;
    container.appendChild(d);
  }
  checked.forEach(e => container.appendChild(buildItem(e)));

  if (unchecked.length > 1) {
    setupDrag(
      container,
      () => [...container.querySelectorAll(':scope > .expense-item:not(.checked)')],
      saveExpenseOrder, '.item-check-btn', 8
    );
  }
  if (checked.length > 1) {
    setupDrag(
      container,
      () => [...container.querySelectorAll(':scope > .expense-item.checked')],
      saveExpenseOrder, '.item-check-btn', 8
    );
  }
}

function renderListView() {
  const container = document.getElementById('expenseList');
  const list = getMonthExpenses();

  const sectionHdr = document.querySelector('.list-section-hdr');
  if (list.length === 0) {
    if (sectionHdr) sectionHdr.style.display = 'none';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 9h8M8 13h5"/></svg></div>
        <p>No allocations yet</p>
        <span>Tap + to add your first budget item</span>
        <button class="list-add-btn empty-add-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add expense
        </button>
      </div>`;
    container.querySelector('.empty-add-btn').addEventListener('click', openAddModal);
    return;
  }
  if (sectionHdr) sectionHdr.style.display = '';

  const primaryCode = settings.currency.code;
  const primarySym  = settings.currency.symbol;

  // Group expenses by category
  const byCat = {};
  list.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = { items: [], total: 0, paidTotal: 0 };
    byCat[e.category].items.push(e);
    const amt = effectiveAmount(e);
    if (e.checked) byCat[e.category].paidTotal += amt;
    else byCat[e.category].total += amt;
  });

  const catIds = Object.keys(byCat);
  const prefixGroups = detectPrefixGroups(catIds); // prefix → [catId, ...]
  const inGroup = new Set(Object.values(prefixGroups).flat());

  // Build top-level render list: prefix-groups + ungrouped singles
  const seenPrefixes = new Set();
  const topLevel = [];
  catIds.forEach(catId => {
    const firstWord = getCat(catId).name.split(/\s+/)[0];
    if (inGroup.has(catId)) {
      if (!seenPrefixes.has(firstWord)) {
        seenPrefixes.add(firstWord);
        const groupIds = prefixGroups[firstWord];
        const groupTotal = groupIds.reduce((s, id) => s + (byCat[id]?.total || 0), 0);
        topLevel.push({ type: 'group', prefix: firstWord, catIds: groupIds, total: groupTotal });
      }
    } else {
      topLevel.push({ type: 'single', catId, total: byCat[catId].total });
    }
  });
  // Sort by min sort_order of constituent categories, fallback to total
  topLevel.forEach(item => {
    const ids = item.catIds ?? [item.catId];
    const orders = ids.map(id => categories.find(c => c.id === id)?.sort_order ?? 99999);
    item.sortKey = Math.min(...orders);
  });
  topLevel.sort((a, b) => a.sortKey - b.sortKey || b.total - a.total);

  // When navigating to a new month: restore saved expand state, or default to first item
  const monthKey = `${currentYear}-${currentMonth}`;
  if (listViewMonth !== monthKey) {
    listViewMonth = monthKey;
    if (!loadExpandState()) {
      expandedListCats.clear(); expandedListGroups.clear();
      if (topLevel.length > 0) {
        const top = topLevel[0];
        if (top.type === 'group') expandedListGroups.add(top.prefix);
        else expandedListCats.add(top.catId);
      }
      saveExpandState();
    }
  }

  container.innerHTML = '';
  const chevHTML = (collapsed) =>
    `<svg class="cat-chevron${collapsed ? ' collapsed' : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,6 8,10 12,6"/></svg>`;

  topLevel.forEach(item => {
    const tile = document.createElement('div');

    if (item.type === 'group') {
      const isExpanded = expandedListGroups.has(item.prefix);
      tile.className = 'list-tile list-tile-grp';
      tile.dataset.dragId = `grp__${item.prefix}`;
      tile.dataset.catIds = JSON.stringify(item.catIds);

      const hdr = document.createElement('div');
      hdr.className = 'list-tile-hdr';
      const grpFirstCat = getCat(item.catIds[0]);
      const grpColor = grpFirstCat?.color || 'var(--accent)';
      const grpPaid      = item.catIds.reduce((s, id) => s + (byCat[id]?.items.filter(e => e.checked).length || 0), 0);
      const grpTotal     = item.catIds.reduce((s, id) => s + (byCat[id]?.items.length || 0), 0);
      const grpUnpaidAmt = item.catIds.reduce((s, id) => s + (byCat[id]?.total || 0), 0);
      const grpLeftHtml  = grpUnpaidAmt > 0
        ? `<div class="list-hdr-left">${fmtGroupTotal(item.catIds, byCat)} left</div>`
        : grpPaid > 0 ? `<div class="list-hdr-left list-hdr-left--done">✓ all paid</div>` : '';
      const grpBaseTotal = item.catIds.reduce((s, id) => {
        if (!byCat[id]) return s;
        const { code } = getCatCurrency(id);
        const amt = (byCat[id].total || 0) + (byCat[id].paidTotal || 0);
        const b = toBase(amt, code);
        return b != null ? s + b : s;
      }, 0);
      const grpHasNonPrimary = item.catIds.some(id => getCatCurrency(id).code !== primaryCode);
      const grpConvHtml = grpHasNonPrimary && grpBaseTotal > 0
        ? `<div class="list-hdr-conv">≈ ${primarySym}${fmtNum(grpBaseTotal)}</div>` : '';
      hdr.innerHTML = `
        <div class="cat-icon-box" style="background:${grpColor}">
          <span class="cat-icon-letter">${escHtml(item.prefix.charAt(0).toUpperCase())}</span>
          ${DND_HANDLE}
        </div>
        <div class="list-tile-main">
          <div class="list-hdr-name"><span class="list-hdr-name-text">${escHtml(item.prefix)}</span>${chevHTML(!isExpanded)}</div>
          <div class="list-hdr-paid-count">${grpPaid}/${grpTotal} paid</div>
        </div>
        <div class="list-hdr-right">
          <div class="list-hdr-total">${fmtGroupGrandTotal(item.catIds, byCat)}</div>
          ${grpLeftHtml}
          ${grpConvHtml}
        </div>
        <button class="cat-opts-btn" data-cat-ids='${JSON.stringify(item.catIds)}' data-label="${escHtml(item.prefix)}" aria-label="Options">
          <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>
        </button>`;
      tile.appendChild(hdr);

      const grpBody = document.createElement('div');
      grpBody.className = 'cat-group-body' + (isExpanded ? '' : ' collapsed');
      tile.appendChild(grpBody);

      hdr.addEventListener('click', ev => {
        if (ev.target.closest('.drag-handle') || ev.target.closest('.cat-opts-btn')) return;
        const nowExpanded = expandedListGroups.has(item.prefix);
        if (nowExpanded) expandedListGroups.delete(item.prefix);
        else expandedListGroups.add(item.prefix);
        grpBody.classList.toggle('collapsed', nowExpanded);
        hdr.querySelector('.cat-chevron').classList.toggle('collapsed', nowExpanded);
        saveExpandState();
      });
      hdr.querySelector('.cat-opts-btn').addEventListener('click', ev => { ev.stopPropagation(); openCatCtxMenu(ev.currentTarget, item.catIds[0]); });

      const sortedSubs = item.catIds
        .filter(id => byCat[id])
        .sort((a, b) => (getCat(a).sort_order ?? 99999) - (getCat(b).sort_order ?? 99999));

      sortedSubs.forEach(catId => {
        const cat = getCat(catId);
        const { items, total, paidTotal } = byCat[catId];
        const sublabel = cat.name.split(/\s+/).slice(1).join(' ') || cat.name;
        const isCatExp = expandedListCats.has(catId);

        const subTile = document.createElement('div');
        subTile.className = 'list-sub-tile';
        grpBody.appendChild(subTile);

        const subPaid    = items.filter(e => e.checked).length;
        const subGrand   = total + paidTotal;
        const subLeftHtml = total > 0
          ? `<div class="list-hdr-left">${fmtCat(total, catId)} left</div>`
          : paidTotal > 0 ? `<div class="list-hdr-left list-hdr-left--done">✓ all paid</div>` : '';
        const sh = document.createElement('div');
        sh.className = 'list-sub-hdr';
        sh.innerHTML = `
          <div class="list-sub-dot" style="background:${cat.color}"></div>
          <div class="list-tile-main">
            <div class="list-sub-name"><span class="list-hdr-name-text">${escHtml(sublabel)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</span>${chevHTML(!isCatExp)}</div>
            <div class="list-sub-count">${subPaid}/${items.length}</div>
          </div>
          <div class="list-sub-right">
            <div class="list-sub-total">${fmtCat(subGrand, catId)}</div>
            ${subLeftHtml}
          </div>`;
        subTile.appendChild(sh);

        const itemsBody = document.createElement('div');
        itemsBody.className = 'cat-items-body' + (isCatExp ? '' : ' collapsed');
        subTile.appendChild(itemsBody);

        sh.addEventListener('click', () => {
          const nowExpanded = expandedListCats.has(catId);
          if (nowExpanded) expandedListCats.delete(catId);
          else expandedListCats.add(catId);
          itemsBody.classList.toggle('collapsed', nowExpanded);
          sh.querySelector('.cat-chevron').classList.toggle('collapsed', nowExpanded);
          saveExpandState();
        });

        renderItemsBody(items, itemsBody);
      });

    } else {
      const cat = getCat(item.catId);
      const { items, total, paidTotal } = byCat[item.catId];
      const isCatExp = expandedListCats.has(item.catId);
      tile.className = 'list-tile';
      tile.dataset.dragId = item.catId;

      const paidCount  = items.filter(e => e.checked).length;
      const grandTotal = total + paidTotal;
      const leftHtml   = total > 0
        ? `<div class="list-hdr-left">${fmtCat(total, item.catId)} left</div>`
        : paidTotal > 0 ? `<div class="list-hdr-left list-hdr-left--done">✓ all paid</div>` : '';
      const { code: catCode } = getCatCurrency(item.catId);
      const catBaseTotal = catCode !== primaryCode ? toBase(grandTotal, catCode) : null;
      const catConvHtml  = catBaseTotal != null
        ? `<div class="list-hdr-conv">≈ ${primarySym}${fmtNum(catBaseTotal)}</div>` : '';
      const hdr = document.createElement('div');
      hdr.className = 'list-tile-hdr';
      hdr.innerHTML = `
        <div class="cat-icon-box" style="background:${cat.color}">
          <span class="cat-icon-letter">${escHtml(cat.name.charAt(0).toUpperCase())}</span>
          ${DND_HANDLE}
        </div>
        <div class="list-tile-main">
          <div class="list-hdr-name"><span class="list-hdr-name-text">${escHtml(cat.name)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</span>${chevHTML(!isCatExp)}</div>
          <div class="list-hdr-paid-count">${paidCount}/${items.length} paid</div>
        </div>
        <div class="list-hdr-right">
          <div class="list-hdr-total">${fmtCat(grandTotal, item.catId)}</div>
          ${leftHtml}
          ${catConvHtml}
        </div>
        <button class="cat-opts-btn" data-cat-id="${item.catId}" aria-label="Options">
          <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>
        </button>`;
      tile.appendChild(hdr);

      const itemsBody = document.createElement('div');
      itemsBody.className = 'cat-items-body' + (isCatExp ? '' : ' collapsed');
      tile.appendChild(itemsBody);

      hdr.addEventListener('click', ev => {
        if (ev.target.closest('.drag-handle') || ev.target.closest('.cat-opts-btn')) return;
        const nowExpanded = expandedListCats.has(item.catId);
        if (nowExpanded) expandedListCats.delete(item.catId);
        else expandedListCats.add(item.catId);
        itemsBody.classList.toggle('collapsed', nowExpanded);
        hdr.querySelector('.cat-chevron').classList.toggle('collapsed', nowExpanded);
        saveExpandState();
      });
      hdr.querySelector('.cat-opts-btn').addEventListener('click', ev => { ev.stopPropagation(); openCatCtxMenu(ev.currentTarget, item.catId); });

      renderItemsBody(items, itemsBody);
    }

    container.appendChild(tile);
  });

  // Setup drag-to-reorder for category tiles
  setupDrag(container, () => [...container.querySelectorAll(':scope > .list-tile')], saveCategoryOrder);
}

async function handleRenameCategory(catId, newName) {
  const idx = categories.findIndex(c => c.id === catId);
  if (idx === -1) return;
  const old = categories[idx];
  categories[idx] = { ...old, name: newName };
  renderAll();
  try {
    const { error } = await sb.from('categories').update({ name: newName }).eq('id', catId);
    if (error) throw error;
  } catch (err) {
    categories[idx] = old;
    renderAll(); showToast('Could not rename — ' + err.message, true);
  }
}

/* ─── Installment modal (expense-level) ─────────────────── */
function openInstallmentModal(expenseId) {
  pendingInstallmentCatId = expenseId; // reuse variable; holds expense id
  const e = expenses.find(x => x.id === expenseId);
  document.getElementById('installmentCatName').textContent = e?.description ?? '';
  document.getElementById('installmentTotal').value   = e?.installment_total   || '';
  document.getElementById('installmentCurrent').value = e?.installment_current || '';
  document.getElementById('installmentDueDay').value  = e?.installment_due_day || '';
  document.getElementById('installmentError').classList.add('hidden');
  document.getElementById('installmentClear').style.display = e?.installment_total ? '' : 'none';
  openModal('installmentModal');
}
async function handleInstallmentSave() {
  const id     = pendingInstallmentCatId;
  const total  = parseInt(document.getElementById('installmentTotal').value);
  const current= parseInt(document.getElementById('installmentCurrent').value);
  const dueDay = parseInt(document.getElementById('installmentDueDay').value) || null;
  const errEl  = document.getElementById('installmentError');
  if (!total || total < 2)   { errEl.textContent = 'Enter total installments (min 2).'; errEl.classList.remove('hidden'); return; }
  if (!current || current < 1 || current > total) { errEl.textContent = 'Current installment must be between 1 and total.'; errEl.classList.remove('hidden'); return; }
  const idx = expenses.findIndex(e => e.id === id); if (idx === -1) { closeModal('installmentModal'); return; }
  const old = { ...expenses[idx] };
  expenses[idx] = { ...expenses[idx], installment_total: total, installment_current: current, installment_due_day: dueDay };
  closeModal('installmentModal'); renderAll(); showToast('Installments saved');
  try { await sb.from('expenses').update({ installment_total: total, installment_current: current, installment_due_day: dueDay }).eq('id', id); }
  catch (err) { expenses[idx] = old; renderAll(); showToast('Could not save — ' + err.message, true); }
}
async function handleInstallmentClear() {
  const id  = pendingInstallmentCatId;
  const idx = expenses.findIndex(e => e.id === id); if (idx === -1) { closeModal('installmentModal'); return; }
  const old = { ...expenses[idx] };
  expenses[idx] = { ...expenses[idx], installment_total: null, installment_current: null, installment_due_day: null };
  closeModal('installmentModal'); renderAll(); showToast('Installments removed');
  try { await sb.from('expenses').update({ installment_total: null, installment_current: null, installment_due_day: null }).eq('id', id); }
  catch (err) { expenses[idx] = old; renderAll(); showToast('Could not remove — ' + err.message, true); }
}

/* ─── Category context menu ─────────────────────────────── */
function openCatCtxMenu(btn, catId) {
  const menu = document.getElementById('catCtxMenu');
  const cat  = getCat(catId);
  menu.innerHTML = `
    <button class="card-menu-item" id="ccmAdd">+ Add to ${escHtml(cat?.name ?? 'category')}</button>
    <button class="card-menu-item" id="ccmRename">Rename</button>`;
  const rect = btn.getBoundingClientRect();
  menu.style.top   = `${rect.bottom + 6}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.classList.remove('hidden');
  menu.querySelector('#ccmAdd').addEventListener('click', () => {
    menu.classList.add('hidden');
    openAddModal();
    selectCategory(catId);
  });
  menu.querySelector('#ccmRename').addEventListener('click', () => {
    menu.classList.add('hidden');
    const current = getCat(catId)?.name ?? '';
    const next = prompt('Rename category:', current);
    if (next && next.trim() && next.trim() !== current) handleRenameCategory(catId, next.trim());
  });
}

document.addEventListener('click', () => document.getElementById('catCtxMenu')?.classList.add('hidden'));

function buildItem(e) {
  const cat = getCat(e.category);
  const el = document.createElement('div');
  el.className = 'expense-item' + (e.checked ? ' checked' : '');
  el.dataset.id = e.id;
  el.dataset.dragId = e.id;
  let amtSub = '';
  if (e.checked) {
    amtSub = '<div class="expense-amt-sub expense-amt-paid">✓ paid</div>';
  } else if (cat.shared) {
    amtSub = `<div class="expense-amt-sub">${fmtCat(effectiveAmount(e), e.category)} your share</div>`;
  }
  el.innerHTML = `
    <button class="item-check-btn${e.checked ? ' checked' : ''}" data-id="${e.id}" aria-label="${e.checked ? 'Uncheck' : 'Check'}">
      ${e.checked ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>
    <div class="expense-info">
      <div class="expense-desc">${escHtml(e.description)}</div>
      ${expenseInstallmentHtml(e)}
      ${e.bank ? `<div class="expense-bank">${escHtml(e.bank)}</div>` : ''}
    </div>
    <div class="expense-amt-right">
      <div class="expense-amount">${fmtCat(e.amount, e.category)}${cat.shared ? '<span class="shared-badge">÷2</span>' : ''}</div>
      ${amtSub}
    </div>
    <button class="item-more-btn" aria-label="More options">
      <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>
    </button>`;
  el.addEventListener('click', ev => {
    if (ev.target.closest('.item-check-btn') || ev.target.closest('.item-more-btn')) return;
    openEditModal(e.id);
  });
  el.querySelector('.item-check-btn').addEventListener('click', ev => { ev.stopPropagation(); toggleCheck(e.id); });
  el.querySelector('.item-more-btn').addEventListener('click', ev => { ev.stopPropagation(); openItemOptions(e.id); });
  return el;
}

async function toggleCheck(id) {
  const idx = expenses.findIndex(e => e.id === id);
  if (idx === -1) return;
  const newVal = !expenses[idx].checked;
  expenses[idx] = { ...expenses[idx], checked: newVal };
  renderListView();
  try { await dbPatchExpense(id, { checked: newVal }); }
  catch (err) {
    expenses[idx] = { ...expenses[idx], checked: !newVal };
    renderListView(); showToast('Error: ' + err.message, true);
  }
}

/* ─── Category Grid ─────────────────────────────────────── */
function buildCategoryGrid(showAdd = false) {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'category-chip'; chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="chip-label">${escHtml(cat.name)}</span>`;
    chip.addEventListener('click', () => selectCategory(cat.id));
    grid.appendChild(chip);
  });
  if (showAdd) {
    const addChip = document.createElement('button');
    addChip.type = 'button'; addChip.className = 'category-chip cat-add-chip';
    addChip.innerHTML = `<span class="chip-label">+ New</span>`;
    addChip.addEventListener('click', openAddCategoryModal);
    grid.appendChild(addChip);
  }
}

function selectCategory(id) {
  selectedCategory = id;
  document.querySelectorAll('.category-chip').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
}

/* ─── Category Management ───────────────────────────────── */
function openAddCategoryModal() {
  document.getElementById('catNameInput').value = '';
  document.getElementById('catFormError').classList.add('hidden');
  document.getElementById('toggleShared').checked = false;
  buildCatCurrencySelect();
  openModal('categoryModal');
  setTimeout(() => document.getElementById('catNameInput').focus(), 300);
}

function buildCatCurrencySelect() {
  const sel = document.getElementById('catCurrencySelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Default</option>' +
    CURRENCIES.map(c => `<option value="${c.code}">${c.label}</option>`).join('');
  sel.value = '';
}

async function handleAddCategory(e) {
  e.preventDefault();
  const name  = document.getElementById('catNameInput').value.trim();
  const errEl = document.getElementById('catFormError');
  if (!name) { errEl.textContent = 'Enter a name.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const shared   = document.getElementById('toggleShared').checked;
  const selCode  = document.getElementById('catCurrencySelect').value;
  const cur      = CURRENCIES.find(c => c.code === selCode);
  const cur_code   = cur?.code   || null;
  const cur_symbol = cur?.symbol || null;
  const color    = CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length];
  const catOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sort_order ?? 0)) + 1 : 1;
  const tmp = 'tmp_' + Date.now();
  categories.push({ id: tmp, user_id: currentUser.id, name, color, shared, currency_code: cur_code, currency_symbol: cur_symbol, sort_order: catOrder });
  selectedCategory = tmp;
  closeModal('categoryModal');
  buildCategoryGrid(); selectCategory(tmp);
  showToast(`${name} added`);

  try {
    const { data: row, error } = await sb.from('categories')
      .insert({ user_id: currentUser.id, name, color, shared, currency_code: cur_code, currency_symbol: cur_symbol, sort_order: catOrder }).select().single();
    if (error) throw error;
    const idx = categories.findIndex(c => c.id === tmp);
    if (idx !== -1) categories[idx] = row;
    if (selectedCategory === tmp) selectedCategory = row.id;
    buildCategoryGrid(); selectCategory(selectedCategory);
    renderCategorySettings();
  } catch (err) {
    categories = categories.filter(c => c.id !== tmp);
    if (selectedCategory === tmp) selectedCategory = categories[0]?.id || null;
    buildCategoryGrid(); showToast('Could not save — ' + err.message, true);
  }
}

async function deleteCategoryById(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  if (!confirm(`Delete "${cat.name}"? Existing items will show as Other.`)) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, true); return; }
  categories = categories.filter(c => c.id !== id);
  renderCategorySettings(); renderAll();
  showToast(`${cat.name} deleted`);
}

function renderCategorySettings() {
  const container = document.getElementById('categoriesList');
  if (!container) return;
  container.innerHTML = '';
  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const curBadge = cat.currency_code ? ` <span class="cat-currency-badge">${escHtml(cat.currency_code)}</span>` : '';
    row.innerHTML = `
      <div class="cat-settings-dot-lg" style="background:${cat.color}"></div>
      <div class="settings-row-main">
        <div class="settings-row-title">${escHtml(cat.name)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}${curBadge}</div>
      </div>
      <div class="settings-row-actions">
        <button class="settings-icon-btn cat-rename-btn" aria-label="Rename ${escHtml(cat.name)}">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="settings-icon-btn danger cat-del-btn" aria-label="Delete ${escHtml(cat.name)}">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>`;

    row.querySelector('.cat-del-btn').addEventListener('click', () => deleteCategoryById(cat.id));
    row.querySelector('.cat-rename-btn').addEventListener('click', () => {
      const titleEl = row.querySelector('.settings-row-title');
      const input = document.createElement('input');
      input.type = 'text'; input.value = cat.name;
      input.className = 'form-input cat-rename-input';
      titleEl.replaceWith(input);
      input.focus(); input.select();

      const commit = async () => {
        const newName = input.value.trim();
        if (!newName || newName === cat.name) { renderCategorySettings(); return; }
        const idx = categories.findIndex(c => c.id === cat.id);
        if (idx !== -1) categories[idx] = { ...categories[idx], name: newName };
        renderCategorySettings(); renderAll();
        try {
          const { error } = await sb.from('categories').update({ name: newName }).eq('id', cat.id);
          if (error) throw error;
        } catch (err) {
          if (idx !== -1) categories[idx] = cat;
          renderCategorySettings(); renderAll(); showToast('Could not rename — ' + err.message, true);
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { renderCategorySettings(); }
      });
    });

    container.appendChild(row);
  });
}

/* ─── Add / Edit Modal ──────────────────────────────────── */
function clearFormError() { document.getElementById('formError').classList.add('hidden'); }
function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg; el.classList.remove('hidden');
}


function openAddModal() {
  buildCategoryGrid();
  selectedBank     = null; buildBankGrid(null);
  selectedCategory = categories[0]?.id || null; selectCategory(selectedCategory);
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
  buildCategoryGrid();
  selectedCategory = e.category; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'Edit Allocation';
  document.getElementById('submitBtn').textContent  = 'Save Changes';
  selectedBank = e.bank || null; buildBankGrid(selectedBank);
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
  const amount = parseAmount(document.getElementById('amountInput').value);
  const desc   = document.getElementById('descInput').value.trim();
  const bank   = selectedBank || null;
  const editId = document.getElementById('editId').value;
  if (!amount || amount <= 0) { showFormError('Enter an amount first.'); return; }
  if (!desc)                   { showFormError('Add a label so you know what this is for.'); return; }

  const date = monthStartISO();
  closeModal('expenseModal');

  if (editId) {
    const i    = expenses.findIndex(e => e.id === editId);
    const prev = i !== -1 ? { ...expenses[i] } : null;
    if (i !== -1) expenses[i] = { ...expenses[i], amount, description: desc, bank, category: selectedCategory, date };
    renderAll();
    showToast('Updated'); // optimistic — fires the moment the modal closes
    try {
      await dbPatchExpense(editId, { amount, description: desc, bank, category: selectedCategory, date });
    } catch (err) {
      if (prev && i !== -1) expenses[i] = prev;
      renderAll(); showToast('Could not save — ' + err.message, true);
    }
  } else {
    const tmp = 'tmp_' + Date.now();
    const catItems = expenses.filter(e => e.category === selectedCategory && !e.checked);
    const newOrder = catItems.length > 0 ? Math.max(...catItems.map(e => e.sort_order ?? 0)) + 1 : 1;
    expenses.unshift({ id: tmp, user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null, checked: false, sort_order: newOrder });
    renderAll();
    showToast('Added'); // optimistic — fires the moment the modal closes
    try {
      const row = await dbSaveExpense({ user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null, sort_order: newOrder });
      const idx = expenses.findIndex(e => e.id === tmp);
      if (idx !== -1) expenses[idx] = { ...row, amount: parseFloat(row.amount) };
    } catch (err) {
      expenses = expenses.filter(e => e.id !== tmp);
      renderAll(); showToast('Could not save — ' + err.message, true);
    }
  }
}

/* ─── Move Month Modal ──────────────────────────────────── */
function openMoveModal() {
  moveModalMode = 'move';
  let y = currentYear, m = currentMonth + 1;
  if (m > 11) { m = 0; y++; }
  movePickerYear = y; movePickerMonth = m;
  updateMovePickerUI();
  openModal('moveModal');
}

function openDuplicateMonthModal() {
  moveModalMode = 'duplicate';
  let y = currentYear, m = currentMonth + 1;
  if (m > 11) { m = 0; y++; }
  movePickerYear = y; movePickerMonth = m;
  updateMovePickerUI();
  openModal('moveModal');
}

function updateMovePickerUI() {
  const isDup = moveModalMode === 'duplicate';
  document.getElementById('moveModalTitle').textContent = isDup ? 'Duplicate list to…' : 'Move to…';

  const sel = document.getElementById('moveMonthSelect');
  sel.innerHTML = '';
  const now = new Date();
  for (let i = -12; i <= 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const opt = document.createElement('option');
    opt.value = `${y}-${m}`;
    opt.textContent = getMonthLabel(y, m);
    sel.appendChild(opt);
  }
  sel.value = `${movePickerYear}-${movePickerMonth}`;

  const isSame     = movePickerYear === currentYear && movePickerMonth === currentMonth;
  const confirmBtn = document.getElementById('confirmMoveBtn');
  confirmBtn.disabled      = isSame && !isDup;
  confirmBtn.style.opacity = (isSame && !isDup) ? '0.35' : '';
  confirmBtn.textContent   = isDup ? 'Duplicate' : 'Move';
}

async function handleMoveConfirm() {
  const srcYear  = currentYear;
  const srcMonth = currentMonth;
  const list     = getMonthExpenses();
  if (!list.length) { closeModal('moveModal'); return; }

  const targetYear  = movePickerYear;
  const targetMonth = movePickerMonth;
  const targetDate  = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
  const ids         = list.map(e => e.id);

  const prevExpenses = expenses.map(e => ({ ...e }));
  expenses = expenses.map(e => ids.includes(e.id) ? { ...e, date: targetDate } : e);

  closeModal('moveModal');
  currentYear  = targetYear;
  currentMonth = targetMonth;
  saveViewMonth();
  renderAll();
  showToast(`Moved to ${getMonthLabel(targetYear, targetMonth)}`);

  try {
    const { error } = await sb.from('expenses').update({ date: targetDate }).in('id', ids);
    if (error) throw error;
  } catch (err) {
    expenses     = prevExpenses;
    currentYear  = srcYear;
    currentMonth = srcMonth;
    renderAll();
    showToast('Could not move — ' + err.message, true);
  }
}

async function handleDuplicateMonthConfirm() {
  const list = getMonthExpenses();
  if (!list.length) { closeModal('moveModal'); return; }

  const targetYear  = movePickerYear;
  const targetMonth = movePickerMonth;
  const targetDate  = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
  const monthDelta  = (targetYear * 12 + targetMonth) - (currentYear * 12 + currentMonth);

  closeModal('moveModal');

  const copies = list.flatMap(e => {
    let installCurrent = e.installment_current || null;
    if (e.installment_total && e.installment_current) {
      const next = e.installment_current + monthDelta;
      if (next < 1) return []; // no earlier installment exists — skip
      installCurrent = Math.min(e.installment_total, next);
    }
    const installDone = installCurrent != null && installCurrent >= (e.installment_total || Infinity);
    return [{
      user_id: e.user_id, profile_id: e.profile_id,
      amount: e.amount, description: e.description,
      bank: e.bank, category: e.category,
      date: targetDate, note: e.note,
      sort_order: e.sort_order, checked: installDone,
      installment_total:   e.installment_total   || null,
      installment_current: installCurrent,
      installment_due_day: e.installment_due_day || null,
    }];
  });

  const tmpIds = copies.map((_, i) => 'tmp_dup_' + Date.now() + '_' + i);
  const optimistic = copies.map((c, i) => ({ ...c, id: tmpIds[i] }));
  const prevExpenses = [...expenses];

  currentYear  = targetYear;
  currentMonth = targetMonth;
  saveViewMonth();
  expenses = [...expenses, ...optimistic];
  renderAll();
  showToast(`Duplicated ${list.length} expense${list.length !== 1 ? 's' : ''} to ${getMonthLabel(targetYear, targetMonth)}`);

  try {
    const { data: rows, error } = await sb.from('expenses').insert(copies).select();
    if (error) throw error;
    tmpIds.forEach(tid => { expenses = expenses.filter(e => e.id !== tid); });
    rows.forEach(r => expenses.push({ ...r, amount: parseFloat(r.amount) }));
    renderAll();
  } catch (err) {
    expenses     = prevExpenses;
    currentYear  = currentYear; // already navigated
    renderAll();
    showToast('Could not duplicate — ' + err.message, true);
  }
}

/* ─── Income Modal ──────────────────────────────────────── */
function openIncomeModal() {
  document.getElementById('incomeModalTitle').textContent     = `Income · ${getMonthLabel(currentYear, currentMonth)}`;
  document.getElementById('incomeCurrencySymbol').textContent = settings.currency.symbol;
  document.getElementById('incomeAmountInput').value = '';
  document.getElementById('incomeSourceInput').value = '';
  document.getElementById('incomeFormError').classList.add('hidden');
  // Reset source chips to Salary
  document.querySelectorAll('.income-src-chip').forEach(c => c.classList.toggle('active', c.dataset.src === 'Salary'));
  document.getElementById('incomeSourceCustomGroup').style.display = 'none';
  renderIncomeList();
  openModal('incomeModal');
  setTimeout(() => document.getElementById('incomeAmountInput').focus(), 300);
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
      <div class="income-item-icon"><svg viewBox="0 0 24 24"><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M18.36 5.64l1.41-1.41"/><circle cx="12" cy="12" r="4"/></svg></div>
      <div class="income-item-info">
        <div class="income-item-source">${escHtml(r.source)}</div>
        ${r.note ? `<div class="income-item-note">${escHtml(r.note)}</div>` : ''}
      </div>
      <div class="income-item-amount">${fmt(r.amount)}</div>
      <button class="income-item-del" data-id="${r.id}" aria-label="Remove">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>`;
    el.querySelector('.income-item-del').addEventListener('click', async () => {
      const prev = [...incomeEntries];
      incomeEntries = incomeEntries.filter(x => x.id !== r.id);
      renderIncomeList(); renderSummary();
      showToast('Income removed');
      try { await dbRemoveIncome(r.id); }
      catch (err) { incomeEntries = prev; renderIncomeList(); renderSummary(); showToast('Error: ' + err.message, true); }
    });
    container.appendChild(el);
  });
}

async function handleIncomeSubmit(e) {
  e.preventDefault();
  const amount = parseAmount(document.getElementById('incomeAmountInput').value);
  const errEl  = document.getElementById('incomeFormError');
  if (!amount || amount <= 0) { errEl.textContent = 'Enter an amount.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const activeChip = document.querySelector('.income-src-chip.active');
  const source = (activeChip?.dataset.src === '')
    ? (document.getElementById('incomeSourceInput').value.trim() || 'Other')
    : (activeChip?.dataset.src || 'Salary');

  const tmp = 'tmp_' + Date.now();
  incomeEntries.push({ id: tmp, user_id: currentUser.id, profile_id: currentProfileId, year: currentYear, month: currentMonth, amount, source, note: null });
  closeModal('incomeModal');
  renderSummary();
  showToast('Income added');

  try {
    const row = await dbSaveIncome({ user_id: currentUser.id, profile_id: currentProfileId, year: currentYear, month: currentMonth, amount, source, note: null });
    const idx = incomeEntries.findIndex(r => r.id === tmp);
    if (idx !== -1) incomeEntries[idx] = { ...row, amount: parseFloat(row.amount) };
  } catch (err) {
    incomeEntries = incomeEntries.filter(r => r.id !== tmp);
    renderSummary();
    showToast('Could not save — ' + err.message, true);
  }
}

/* ─── Delete ────────────────────────────────────────────── */
let pendingDeleteMonth = false;

function setDeleteModalContent(title, desc, btnLabel) {
  const t = document.getElementById('deleteModalTitle');
  const d = document.getElementById('deleteModalDesc');
  const b = document.getElementById('confirmDelete');
  if (t) t.textContent = title;
  if (d) d.textContent = desc;
  if (b) b.textContent = btnLabel;
}

function openDeleteConfirm(id) {
  pendingDeleteMonth = false;
  setDeleteModalContent('Remove allocation?', 'This action cannot be undone.', 'Remove');
  pendingDeleteId = id;
  openModal('deleteModal');
}

function openDeleteMonthConfirm() {
  const monthExpenses = getMonthExpenses();
  const n = monthExpenses.length;
  const label = getMonthLabel(currentYear, currentMonth);
  pendingDeleteMonth = true;
  pendingDeleteId = null;
  setDeleteModalContent(
    `Delete ${label}?`,
    `This will permanently remove all ${n} expense${n === 1 ? '' : 's'} in ${label}. This cannot be undone.`,
    'Delete all'
  );
  openModal('deleteModal');
}

async function handleDeleteMonth() {
  const toDelete = getMonthExpenses();
  if (toDelete.length === 0) return;
  const saved = [...toDelete];
  expenses = expenses.filter(e => {
    const d = new Date(e.date);
    return !(d.getFullYear() === currentYear && d.getMonth() === currentMonth);
  });
  closeModal('deleteModal');
  pendingDeleteMonth = false;
  renderAll();
  showToast(`Deleted ${saved.length} expense${saved.length === 1 ? '' : 's'}`);
  try {
    await Promise.all(saved.map(e => dbRemoveExpense(e.id)));
  } catch (err) {
    saved.forEach(e => expenses.push(e));
    renderAll();
    showToast('Could not delete — ' + err.message, true);
  }
}

/* ─── Item Options Sheet ────────────────────────────────── */
let pendingOptionsId = null;
function openItemOptions(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  pendingOptionsId = id;
  document.getElementById('itemOptionsDesc').textContent = e.description;
  openModal('itemOptionsModal');
}

async function duplicateExpense(id) {
  const src = expenses.find(e => e.id === id); if (!src) return;
  const tmp = 'tmp_' + Date.now();
  const catItems = expenses.filter(e => e.category === src.category && !e.checked);
  const newOrder = catItems.length > 0 ? Math.max(...catItems.map(e => e.sort_order ?? 0)) + 1 : 1;
  const copy = { ...src, id: tmp, checked: false, sort_order: newOrder };
  expenses.unshift(copy);
  renderAll();
  showToast('Duplicated');
  try {
    const payload = { user_id: src.user_id, profile_id: src.profile_id, amount: src.amount, description: src.description, bank: src.bank, category: src.category, date: src.date, note: src.note, sort_order: newOrder, installment_total: src.installment_total || null, installment_current: src.installment_current || null, installment_due_day: src.installment_due_day || null };
    const row = await dbSaveExpense(payload);
    const idx = expenses.findIndex(e => e.id === tmp);
    if (idx !== -1) expenses[idx] = { ...row, amount: parseFloat(row.amount) };
  } catch (err) {
    expenses = expenses.filter(e => e.id !== tmp);
    renderAll(); showToast('Could not duplicate — ' + err.message, true);
  }
}

async function handleConfirmDelete() {
  if (pendingDeleteMonth) { await handleDeleteMonth(); return; }
  if (!pendingDeleteId) return;
  const id      = pendingDeleteId;
  const deleted = expenses.find(e => e.id === id);
  expenses      = expenses.filter(e => e.id !== id);
  closeModal('deleteModal');
  pendingDeleteId = null;
  renderAll();
  showToast('Removed');
  try { await dbRemoveExpense(id); }
  catch (err) {
    if (deleted) expenses.unshift(deleted);
    renderAll(); showToast('Could not delete — ' + err.message);
  }
}

/* ─── Settings ──────────────────────────────────────────── */
function syncSettingsUI() {
  const sel = document.getElementById('currencySelect');
  if (sel) sel.value = settings.currency.code;
}

function buildCurrencySelect() {
  const sel = document.getElementById('currencySelect');
  if (!sel) return;
  sel.innerHTML = CURRENCIES.map(c => `<option value="${c.code}">${c.label}</option>`).join('');
  sel.value = settings.currency.code;
}

async function handleCurrencySelect(code, symbol) {
  settings.currency = { code, symbol };
  syncSettingsUI(); renderAll();
  try { await dbSaveSettings(); } catch {}
}

/* ─── Modal Helpers ─────────────────────────────────────── */
const MODALS = ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal', 'installmentModal', 'moveModal', 'profileSheet'];

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
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    saveViewMonth(); renderAll();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    saveViewMonth(); renderAll();
  });

  // Allocation form
  document.getElementById('openAdd').addEventListener('click', openAddModal);
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('closeModal').addEventListener('click', () => closeModal('expenseModal'));
  document.getElementById('amountInput').addEventListener('input', clearFormError);
  document.getElementById('descInput').addEventListener('input', clearFormError);

  // Card actions menu
  document.getElementById('cardMenuBtn').addEventListener('click', e => {
    e.stopPropagation();
    const menu = document.getElementById('cardMenu');
    if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.top   = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.classList.remove('hidden');
  });
  document.addEventListener('click', () => document.getElementById('cardMenu')?.classList.add('hidden'));

  // Income
  document.getElementById('incomeForm').addEventListener('submit', handleIncomeSubmit);
  document.getElementById('closeIncomeModal').addEventListener('click', () => closeModal('incomeModal'));
  document.querySelectorAll('.income-src-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.income-src-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const customGroup = document.getElementById('incomeSourceCustomGroup');
      const isOther = chip.dataset.src === '';
      customGroup.style.display = isOther ? '' : 'none';
      if (isOther) document.getElementById('incomeSourceInput').focus();
      else document.getElementById('incomeAmountInput').focus();
    });
  });

  // Delete
  document.getElementById('cancelDelete').addEventListener('click',  () => closeModal('deleteModal'));
  document.getElementById('confirmDelete').addEventListener('click', handleConfirmDelete);

  // Item options sheet
  document.getElementById('itemOptionsEdit').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openEditModal(id);
  });
  document.getElementById('itemOptionsDuplicate').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); duplicateExpense(id);
  });
  document.getElementById('itemOptionsInstallments').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openInstallmentModal(id);
  });
  document.getElementById('itemOptionsDelete').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openDeleteConfirm(id);
  });
  document.getElementById('itemOptionsCancel').addEventListener('click', () => closeModal('itemOptionsModal'));

  // Installment modal
  document.getElementById('installmentSave').addEventListener('click', handleInstallmentSave);
  document.getElementById('installmentClear').addEventListener('click', handleInstallmentClear);
  document.getElementById('installmentCancel').addEventListener('click', () => closeModal('installmentModal'));

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => { buildCurrencySelect(); renderProfilesList(); renderCategorySettings(); renderRates(); openModal('settingsModal'); });
  document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('addPersonSettingsBtn').addEventListener('click', openAddProfileModal);
  document.getElementById('addCategorySettingsBtn').addEventListener('click', openAddCategoryModal);

  // Profile trigger + sheet
  document.getElementById('profileTrigger').addEventListener('click', () => { renderProfileBar(); openModal('profileSheet'); });
  document.getElementById('profileSheetCancel').addEventListener('click', () => closeModal('profileSheet'));
  document.getElementById('profileSheetAdd').addEventListener('click', () => { closeModal('profileSheet'); openAddProfileModal(); });

  // Profile modal
  document.getElementById('profileForm').addEventListener('submit', handleAddProfile);
  document.getElementById('cancelAddProfile').addEventListener('click', () => closeModal('profileModal'));

  // Category modal
  document.getElementById('categoryForm').addEventListener('submit', handleAddCategory);
  document.getElementById('cancelAddCat').addEventListener('click', () => closeModal('categoryModal'));
  document.getElementById('currencySelect').addEventListener('change', e => {
    const cur = CURRENCIES.find(c => c.code === e.target.value);
    if (cur) handleCurrencySelect(cur.code, cur.symbol);
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
        sb.from('completed_months').delete().eq('user_id', currentUser.id),
      ]);
      expenses = []; incomeEntries = []; completedMonths = [];
      closeModal('settingsModal'); renderAll(); showToast('All data cleared');
    } catch (err) { showToast('Error: ' + err.message, true); }
  });

  // Move / Duplicate modal
  document.getElementById('moveMonthSelect').addEventListener('change', e => {
    const [y, m] = e.target.value.split('-').map(Number);
    movePickerYear = y; movePickerMonth = m;
    updateMovePickerUI();
  });
  document.getElementById('confirmMoveBtn').addEventListener('click', () => {
    moveModalMode === 'duplicate' ? handleDuplicateMonthConfirm() : handleMoveConfirm();
  });
  document.getElementById('cancelMove').addEventListener('click', () => closeModal('moveModal'));

  // Backdrop clicks
  ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal', 'installmentModal', 'moveModal', 'profileSheet'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
