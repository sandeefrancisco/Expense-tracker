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
let editingProfileId         = null;
let pendingDeleteProfileId   = null;
let pendingDeleteCatId       = null;
let pendingDeleteGroupIds    = null;
let pendingDeleteGroupPrefix = null;
let pendingInstallmentCatId  = null;
let selectedCategory  = null;
let selectedBank      = null;
let screenshotTargetCatId = null;
let selectedCatShared   = false;
let authMode            = 'signin';
let movePickerYear      = null;
let movePickerMonth     = null;
let moveModalMode       = 'move'; // 'move' | 'duplicate' | 'moveItem'
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
    acc[code].total += (byCat[id].total || 0) + (byCat[id].paidTotal || 0) + (byCat[id].plannedTotal || 0);
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
function effectiveAmount(e) {
  if (e.split_type === 'equal') return e.amount / 2;
  if (e.split_type === 'custom' && e.split_percentage != null) return e.amount * e.split_percentage / 100;
  const c = getCat(e.category);
  return c.shared ? e.amount / 2 : e.amount;
}

function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function expenseInstallmentHtml(e) {
  if (!e.installment_total || !e.installment_current) return '';
  const due   = e.installment_due_day ? ` · due ${ordinal(e.installment_due_day)}` : '';
  const done  = e.installment_current >= e.installment_total;
  const final = e.installment_complete ? ' · final' : '';
  const cls   = e.installment_complete
    ? 'expense-installment expense-installment--final'
    : `expense-installment${done ? ' expense-installment--done' : ''}`;
  return `<div class="${cls}">${e.installment_current}/${e.installment_total}${due}${final}</div>`;
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

function getEffectiveIncome() {
  const current = getMonthIncome();
  if (current.length > 0) return current;
  const all = incomeEntries.filter(r => r.profile_id === currentProfileId);
  if (all.length === 0) return [];
  const sorted = [...all].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  const { year: ly, month: lm } = sorted[0];
  return all.filter(r => r.year === ly && r.month === lm);
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

const WIN_MESSAGES = [
  { emoji: '🎉', title: 'All paid!',       sub: "You're crushing it this month"    },
  { emoji: '🔥', title: 'Zero balance!',   sub: "On fire — every bill settled"     },
  { emoji: '✨', title: '100% settled!',   sub: "Feels incredible, right?"         },
  { emoji: '💪', title: 'All clear!',      sub: "Financial boss mode activated"    },
  { emoji: '🏆', title: 'Perfect month!',  sub: "Every single one paid"            },
];

function fireConfetti() {
  const old = document.getElementById('confettiContainer');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'confettiContainer';
  wrap.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:hidden;';
  document.body.appendChild(wrap);
  const colors = ['#2563EB','#059669','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#10B981'];
  for (let i = 0; i < 55; i++) {
    const el = document.createElement('div');
    const color    = colors[Math.floor(Math.random() * colors.length)];
    const circle   = Math.random() > 0.55;
    const size     = 5 + Math.random() * 9;
    const x        = Math.random() * 100;
    const delay    = Math.random() * 1.0;
    const duration = 1.8 + Math.random() * 1.8;
    const drift    = (Math.random() - 0.5) * 220;
    el.style.cssText = `position:absolute;left:${x}%;top:-16px;width:${size}px;height:${circle ? size : size * 0.55}px;background:${color};border-radius:${circle ? '50%' : '2px'};--cfx:${drift}px;animation:confettiFall ${duration}s ${delay}s ease-in forwards;`;
    wrap.appendChild(el);
  }
  setTimeout(() => wrap.remove(), 4500);
}

function showToast(msg, isError = false, type = null) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  let cls = 'toast show';
  if (isError)          cls += ' toast-error';
  else if (type === 'info') cls += ' toast-info';
  t.className = cls;
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
  const name = prof?.name ?? 'Me';
  const lbl  = document.getElementById('profileTriggerLabel');
  if (lbl) lbl.textContent = name;
  const av = document.getElementById('profileAvatarEl');
  if (av) av.textContent = name.charAt(0).toUpperCase();
  const heading = document.getElementById('profileHeading');
  if (heading) heading.textContent = `${name}’s expenses`;

  // Populate profile sheet list
  const sheetList = document.getElementById('profileSheetList');
  if (!sheetList) return;
  sheetList.innerHTML = '';
  profiles.forEach(p => {
    const row = document.createElement('div');
    row.className = 'profile-sheet-row';

    const btn = document.createElement('button');
    btn.className = 'option-row-btn profile-sheet-name' + (p.id === currentProfileId ? ' profile-option-active' : '');
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      currentProfileId = p.id;
      localStorage.setItem('activeProfileId', p.id);
      closeModal('profileSheet');
      renderAll();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'profile-edit-btn';
    editBtn.setAttribute('aria-label', 'Rename');
    editBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      closeModal('profileSheet');
      openRenameProfileModal(p.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'profile-delete-btn';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    deleteBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      closeModal('profileSheet');
      openDeleteProfileConfirm(p.id);
    });

    row.appendChild(btn);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);
    sheetList.appendChild(row);
  });
}

function openAddProfileModal() {
  editingProfileId = null;
  document.getElementById('profileNameInput').value = '';
  document.getElementById('profileFormError').classList.add('hidden');
  document.getElementById('profileModalTitle').textContent = 'Add person';
  document.getElementById('profileModalDesc').textContent = 'Give them a name to track their budget separately.';
  document.getElementById('confirmAddProfile').textContent = 'Add';
  openModal('profileModal');
  setTimeout(() => document.getElementById('profileNameInput').focus(), 300);
}

function openRenameProfileModal(id) {
  const p = profiles.find(x => x.id === id); if (!p) return;
  editingProfileId = id;
  document.getElementById('profileNameInput').value = p.name;
  document.getElementById('profileFormError').classList.add('hidden');
  document.getElementById('profileModalTitle').textContent = 'Rename person';
  document.getElementById('profileModalDesc').textContent = 'Enter a new name for this person.';
  document.getElementById('confirmAddProfile').textContent = 'Save';
  openModal('profileModal');
  setTimeout(() => {
    const inp = document.getElementById('profileNameInput');
    inp.focus(); inp.select();
  }, 300);
}

async function handleAddProfile(e) {
  e.preventDefault();
  const name  = document.getElementById('profileNameInput').value.trim();
  const errEl = document.getElementById('profileFormError');
  if (!name) { errEl.textContent = 'Enter a name.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  if (editingProfileId) {
    const id = editingProfileId;
    editingProfileId = null;
    closeModal('profileModal');
    await handleRenameProfile(id, name);
    return;
  }

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

async function handleRenameProfile(id, newName) {
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return;
  const old = profiles[idx];
  profiles[idx] = { ...old, name: newName };
  renderAll();
  showToast('Renamed');
  try {
    const { error } = await sb.from('profiles').update({ name: newName }).eq('id', id);
    if (error) throw error;
  } catch (err) {
    profiles[idx] = old;
    renderAll(); showToast('Could not rename — ' + err.message, true);
  }
}

async function deleteProfile(id) {
  const prof = profiles.find(p => p.id === id);
  if (!prof) return;
  if (profiles.length <= 1) { showToast("Can't delete the only person", false, 'info'); return; }
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
  const rawList = getMonthExpenses();
  const list    = rawList.filter(e => !e.planned);
  const income = getEffectiveIncome();
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
    const now = new Date();
    const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth();
    const monthName = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long' });
    labelEl.textContent = isOver ? 'Over budget' : (isCurrentMonth ? 'Saved this month' : `Saved · ${monthName}`);
    heroEl.textContent  = `${isOver ? '-' : ''}${primarySym}${fmtNum(Math.abs(saved))}`;
    if (isOver) heroEl.style.color = 'var(--error)';
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
  // paidBase uses effectiveAmount (halved for shared); dueBase uses raw amount
  let paidBase = 0, dueBase = 0;
  list.forEach(e => {
    const cur     = getCatCurrency(e.category);
    const effAmt  = effectiveAmount(e);
    const rawAmt  = e.amount;
    const paidB   = toBase(effAmt, cur.code) ?? (cur.code === primaryCode ? effAmt : 0);
    const dueB    = toBase(rawAmt, cur.code) ?? (cur.code === primaryCode ? rawAmt : 0);
    if (e.checked) paidBase += paidB; else dueBase += dueB;
  });
  const fmtStat = v => v === 0 ? `${primarySym}0` : v >= 100000
    ? `${primarySym}${(v / 1000).toFixed(0)}k`
    : `${primarySym}${Math.round(v).toLocaleString('en-US')}`;
  const statItems = document.getElementById('scStatItems');
  const statCats  = document.getElementById('scStatCats');
  if (statItems) statItems.textContent = n > 0 ? fmtStat(paidBase) : '—';
  if (statCats)  statCats.textContent  = n > 0 ? fmtStat(dueBase)  : '—';

  // Salary subtext — "End of [prev month] Salary" whenever there is income
  const salarySubtext = document.getElementById('salarySubtext');
  if (salarySubtext) {
    if (earned > 0) {
      const prevMonth = new Date(currentYear, currentMonth - 1, 1).toLocaleDateString('en-US', { month: 'long' });
      salarySubtext.textContent = `End of ${prevMonth} Salary`;
      salarySubtext.classList.remove('hidden');
    } else {
      salarySubtext.classList.add('hidden');
    }
  }

  // Win banner — shown when every item is paid
  const winBanner = document.getElementById('winBanner');
  const isAllPaid = pct === 100 && n > 0;
  if (winBanner) {
    if (isAllPaid) {
      const msg = WIN_MESSAGES[(currentMonth - 1 + WIN_MESSAGES.length) % WIN_MESSAGES.length];
      document.getElementById('winEmoji').textContent = msg.emoji;
      document.getElementById('winTitle').textContent = msg.title;
      document.getElementById('winSub').textContent   = msg.sub;
      if (winBanner.classList.contains('hidden')) {
        winBanner.classList.remove('hidden');
        fireConfetti();
      }
    } else {
      winBanner.classList.add('hidden');
    }
  }

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

  if (unchecked.length > 1) initItemDrag(container);
}

function initItemDrag(container) {
  if (container.dataset.dragInit) return;
  container.dataset.dragInit = '1';

  container.addEventListener('pointerdown', ev => {
    if (!ev.target.closest('.drag-handle')) return;
    const item = ev.target.closest('.expense-item');
    if (!item || item.classList.contains('checked')) return;
    ev.preventDefault();

    const rect = item.getBoundingClientRect();
    const fingerOffsetY = ev.clientY - rect.top;
    item.classList.add('dragging');

    const ghost = item.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', zIndex: '1000', pointerEvents: 'none',
      boxShadow: '0 8px 24px rgba(0,0,0,.14)', background: 'var(--surface)',
      borderRadius: '14px', transition: 'none',
    });
    document.body.appendChild(ghost);
    try { navigator.vibrate(20); } catch (_) {}

    function draggable() {
      return [...container.querySelectorAll('.expense-item:not(.checked)')];
    }

    function onMove(me) {
      me.preventDefault();
      ghost.style.top = (me.clientY - fingerOffsetY) + 'px';

      const items = draggable();
      const srcIdx = items.indexOf(item);
      for (let i = 0; i < items.length; i++) {
        if (i === srcIdx) continue;
        const r = items[i].getBoundingClientRect();
        if (i < srcIdx && me.clientY < r.top + r.height / 2) {
          container.insertBefore(item, items[i]); break;
        } else if (i > srcIdx && me.clientY > r.top + r.height / 2) {
          items[i].after(item); break;
        }
      }
    }

    async function onEnd() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      ghost.remove();
      item.classList.remove('dragging');

      const ids = draggable().map(el => el.dataset.id);
      ids.forEach((id, idx) => {
        const e = expenses.find(x => x.id === id);
        if (e) e.sort_order = idx + 1;
      });
      try {
        await Promise.all(ids.map((id, idx) => dbPatchExpense(id, { sort_order: idx + 1 })));
      } catch (err) {
        showToast('Could not save order', true);
        renderListView();
      }
    }

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  });
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
      </div>`;
    return;
  }
  if (sectionHdr) sectionHdr.style.display = '';

  const primaryCode = settings.currency.code;
  const primarySym  = settings.currency.symbol;

  // Group expenses by category
  const byCat = {};
  list.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = { items: [], total: 0, paidTotal: 0, plannedTotal: 0 };
    byCat[e.category].items.push(e);
    if (e.planned) {
      byCat[e.category].plannedTotal += effectiveAmount(e);
    } else {
      const amt = effectiveAmount(e);
      if (e.checked) byCat[e.category].paidTotal += amt;
      else byCat[e.category].total += amt;
    }
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
      tile.dataset.tileType   = 'group';
      tile.dataset.tilePrefix = item.prefix;

      const hdr = document.createElement('div');
      hdr.className = 'list-tile-hdr';
      const grpFirstCat = getCat(item.catIds[0]);
      const grpColor = grpFirstCat?.color || 'var(--accent)';
      const grpPaid      = item.catIds.reduce((s, id) => s + (byCat[id]?.items.filter(e => e.checked && !e.planned).length || 0), 0);
      const grpTotal     = item.catIds.reduce((s, id) => s + (byCat[id]?.items.filter(e => !e.planned).length || 0), 0);
      const grpUnpaidAmt = item.catIds.reduce((s, id) => s + (byCat[id]?.total || 0), 0);
      const grpLeftHtml  = grpUnpaidAmt > 0
        ? `<div class="list-hdr-left">${fmtGroupTotal(item.catIds, byCat)} left</div>`
        : grpPaid > 0 ? `<div class="list-hdr-left list-hdr-left--done">✓ all paid</div>` : '';
      const grpBaseTotal = item.catIds.reduce((s, id) => {
        if (!byCat[id]) return s;
        const { code } = getCatCurrency(id);
        const amt = (byCat[id].total || 0) + (byCat[id].paidTotal || 0) + (byCat[id].plannedTotal || 0);
        const b = toBase(amt, code);
        return b != null ? s + b : s;
      }, 0);
      const grpHasNonPrimary = item.catIds.some(id => getCatCurrency(id).code !== primaryCode);
      const grpConvHtml = grpHasNonPrimary && grpBaseTotal > 0
        ? `<div class="list-hdr-conv">≈ ${primarySym}${fmtNum(grpBaseTotal)}</div>` : '';
      hdr.innerHTML = `
        <div class="cat-icon-box" style="background:${grpColor}">
          <span class="cat-icon-letter">${escHtml(item.prefix.charAt(0).toUpperCase())}</span>
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

      // interactions handled by delegated listener on #expenseList

      const sortedSubs = item.catIds
        .filter(id => byCat[id])
        .sort((a, b) => (getCat(a).sort_order ?? 99999) - (getCat(b).sort_order ?? 99999));

      sortedSubs.forEach(catId => {
        const cat = getCat(catId);
        const { items, total, paidTotal, plannedTotal } = byCat[catId];
        const sublabel = cat.name.split(/\s+/).slice(1).join(' ') || cat.name;
        const isCatExp = expandedListCats.has(catId);

        const subTile = document.createElement('div');
        subTile.className = 'list-sub-tile';
        grpBody.appendChild(subTile);

        const subActive  = items.filter(e => !e.planned);
        const subPaid    = subActive.filter(e => e.checked).length;
        const subGrand   = total + paidTotal + plannedTotal;
        const rawSubLeft = subActive.filter(e => !e.checked).reduce((s, e) => s + e.amount, 0);
        const subLeftHtml = rawSubLeft > 0
          ? `<div class="list-hdr-left">${fmtCat(rawSubLeft, catId)} left${cat.shared ? `<span class="left-share"> ÷2 ${fmtCat(rawSubLeft / 2, catId)}</span>` : ''}</div>`
          : paidTotal > 0 ? `<div class="list-hdr-left list-hdr-left--done">✓ all paid</div>` : '';
        const sh = document.createElement('div');
        sh.className = 'list-sub-hdr';
        sh.innerHTML = `
          <div class="list-sub-dot" style="background:${cat.color}"></div>
          <div class="list-tile-main">
            <div class="list-sub-name"><span class="list-hdr-name-text">${escHtml(sublabel)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</span>${chevHTML(!isCatExp)}</div>
            <div class="list-sub-count">${subPaid}/${subActive.length}</div>
          </div>
          <div class="list-sub-right">
            <div class="list-sub-total">${fmtCat(subGrand, catId)}</div>
            ${subLeftHtml}
          </div>`;
        sh.dataset.catId = catId;
        subTile.appendChild(sh);

        const itemsBody = document.createElement('div');
        itemsBody.className = 'cat-items-body' + (isCatExp ? '' : ' collapsed');
        subTile.appendChild(itemsBody);

        // expand/collapse handled by delegated listener on #expenseList
        renderItemsBody(items, itemsBody);
      });

    } else {
      const cat = getCat(item.catId);
      const { items, total, paidTotal, plannedTotal } = byCat[item.catId];
      const isCatExp = expandedListCats.has(item.catId);
      tile.className = 'list-tile';
      tile.dataset.dragId  = item.catId;
      tile.dataset.tileType = 'single';
      tile.dataset.catId    = item.catId;

      const activeItems = items.filter(e => !e.planned);
      const paidCount  = activeItems.filter(e => e.checked).length;
      const grandTotal = total + paidTotal + plannedTotal;
      const rawLeft    = activeItems.filter(e => !e.checked).reduce((s, e) => s + e.amount, 0);
      const catShared  = getCat(item.catId)?.shared;
      const leftHtml   = rawLeft > 0
        ? `<div class="list-hdr-left">${fmtCat(rawLeft, item.catId)} left${catShared ? `<span class="left-share"> ÷2 ${fmtCat(rawLeft / 2, item.catId)}</span>` : ''}</div>`
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
        </div>
        <div class="list-tile-main">
          <div class="list-hdr-name"><span class="list-hdr-name-text">${escHtml(cat.name)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</span>${chevHTML(!isCatExp)}</div>
          <div class="list-hdr-paid-count">${paidCount}/${activeItems.length} paid</div>
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

      // interactions handled by delegated listener on #expenseList

      renderItemsBody(items, itemsBody);
    }

    container.appendChild(tile);
  });

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
async function moveTileInOrder(dragId, direction) {
  const cont  = document.getElementById('expenseList');
  const tiles = [...cont.querySelectorAll(':scope > .list-tile')];
  const idx   = tiles.findIndex(t => t.dataset.dragId === dragId);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= tiles.length) return;
  if (direction === 'up') cont.insertBefore(tiles[idx], tiles[swapIdx]);
  else cont.insertBefore(tiles[swapIdx], tiles[idx]);
  const newOrder = [...cont.querySelectorAll(':scope > .list-tile')].map(t => t.dataset.dragId);
  await saveCategoryOrder(newOrder);
}

function openCatCtxMenu(btn, catId, groupCatIds = null, groupPrefix = null) {
  const isGroup = groupCatIds && groupCatIds.length > 1;
  const cat     = getCat(catId);
  const tile    = btn.closest('[data-drag-id]');
  const cont    = document.getElementById('expenseList');
  const tiles   = [...cont.querySelectorAll(':scope > .list-tile')];
  const idx     = tile ? tiles.indexOf(tile) : -1;
  const dragId  = tile?.dataset.dragId;
  const canUp   = idx > 0;
  const canDown = idx !== -1 && idx < tiles.length - 1;

  document.getElementById('catOptionsTitle').textContent = isGroup ? groupPrefix : (cat?.name ?? '');
  document.getElementById('cosAddLabel').textContent = `Add to ${isGroup ? groupPrefix : (cat?.name ?? 'category')}`;
  document.getElementById('cosMoveUp').classList.toggle('hidden', !canUp);
  document.getElementById('cosMoveDown').classList.toggle('hidden', !canDown);
  document.getElementById('cosDeleteLabel').textContent = isGroup ? 'Delete group' : 'Delete category';
  document.getElementById('cosDelete').classList.remove('hidden');

  // Determine planned state: if all active items in the category are planned → offer "Include all"
  const catIdsForPlanned = isGroup ? groupCatIds : [catId];
  const catItems = getMonthExpenses().filter(e => catIdsForPlanned.includes(e.category));
  const allPlanned = catItems.length > 0 && catItems.every(e => e.planned);
  document.getElementById('cosPlannedLabel').textContent = allPlanned ? 'Include all in totals' : 'Mark all as reminder';

  // Clear old listeners by replacing nodes
  ['cosAdd','cosUploadScreenshot','cosRename','cosMoveUp','cosMoveDown','cosDelete','cosPlanned'].forEach(id => {
    const el = document.getElementById(id);
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
  });

  document.getElementById('cosAdd').addEventListener('click', () => {
    closeModal('catOptionsSheet'); openAddModal(); selectCategory(catId);
  });
  document.getElementById('cosUploadScreenshot').addEventListener('click', () => {
    closeModal('catOptionsSheet');
    screenshotTargetCatId = isGroup ? groupCatIds[0] : catId;
    document.getElementById('screenshotInput').value = '';
    document.getElementById('screenshotInput').click();
  });
  document.getElementById('cosRename').addEventListener('click', () => {
    closeModal('catOptionsSheet');
    const current = cat?.name ?? '';
    const next = prompt('Rename category:', current);
    if (next && next.trim() && next.trim() !== current) handleRenameCategory(catId, next.trim());
  });
  document.getElementById('cosMoveUp').addEventListener('click', () => {
    closeModal('catOptionsSheet'); moveTileInOrder(dragId, 'up');
  });
  document.getElementById('cosMoveDown').addEventListener('click', () => {
    closeModal('catOptionsSheet'); moveTileInOrder(dragId, 'down');
  });
  document.getElementById('cosDelete').addEventListener('click', () => {
    closeModal('catOptionsSheet');
    if (isGroup) {
      deleteGroupCategories(groupCatIds, groupPrefix);
    } else {
      deleteCategoryById(catId);
    }
  });
  document.getElementById('cosPlanned').addEventListener('click', () => {
    closeModal('catOptionsSheet');
    toggleCategoryPlanned(catIdsForPlanned, !allPlanned);
  });

  openModal('catOptionsSheet');
}

function deleteGroupCategories(catIds, prefix) {
  openDeleteGroupConfirm(catIds, prefix);
}

async function toggleCategoryPlanned(catIds, toPlanned) {
  const targets = getMonthExpenses().filter(e => catIds.includes(e.category));
  if (targets.length === 0) return;
  const prev = targets.map(e => ({ id: e.id, planned: e.planned }));
  targets.forEach(e => {
    const idx = expenses.findIndex(x => x.id === e.id);
    if (idx !== -1) expenses[idx] = { ...expenses[idx], planned: toPlanned };
  });
  renderAll();
  try {
    await Promise.all(targets.map(e => dbPatchExpense(e.id, { planned: toPlanned })));
    showToast(toPlanned ? 'Marked as reminder' : 'Included in totals');
  } catch (err) {
    prev.forEach(({ id, planned }) => {
      const idx = expenses.findIndex(x => x.id === id);
      if (idx !== -1) expenses[idx] = { ...expenses[idx], planned };
    });
    renderAll(); showToast('Error: ' + err.message, true);
  }
}

/* ─── Screenshot OCR ────────────────────────────────────── */
function openScreenshotPreviewModal() {
  document.getElementById('ocrLoading').classList.remove('hidden');
  document.getElementById('screenshotPreviewContent').classList.add('hidden');
  document.getElementById('screenshotPreviewFooter').classList.add('hidden');
  document.getElementById('screenshotItemsList').innerHTML = '';
  document.getElementById('screenshotPreviewError').classList.add('hidden');
  openModal('screenshotPreviewModal');
}

function showOcrError(msg) {
  document.getElementById('ocrLoading').classList.add('hidden');
  document.getElementById('screenshotPreviewContent').classList.remove('hidden');
  document.getElementById('screenshotPreviewHint').classList.add('hidden');
  const errEl = document.getElementById('screenshotPreviewError');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

function renderScreenshotPreviewItems(items) {
  document.getElementById('ocrLoading').classList.add('hidden');
  document.getElementById('screenshotPreviewContent').classList.remove('hidden');
  document.getElementById('screenshotPreviewHint').classList.remove('hidden');
  document.getElementById('screenshotPreviewError').classList.add('hidden');

  const list = document.getElementById('screenshotItemsList');
  list.innerHTML = '';

  if (items.length === 0) {
    list.innerHTML = '<p class="ocr-empty">No list items found in the screenshot. Try a clearer image.</p>';
    return;
  }

  const catCur = getCatCurrency(screenshotTargetCatId);
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'ocr-item-row';
    row.dataset.idx = idx;
    row.innerHTML = `
      <label class="ocr-item-check-wrap">
        <input type="checkbox" class="ocr-item-check" checked />
        <span class="ocr-check-box"></span>
      </label>
      <input type="text" class="ocr-item-name form-input" value="${escHtml(item.name)}" placeholder="Item name" maxlength="80" />
      <div class="ocr-item-amt-wrap">
        <span class="ocr-item-sym">${escHtml(catCur.symbol)}</span>
        <input type="text" class="ocr-item-amt form-input" value="${item.amount != null ? parseFloat(item.amount).toFixed(2) : ''}" placeholder="Amount" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" />
      </div>
      <button type="button" class="ocr-item-del" aria-label="Remove">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`;
    row.querySelector('.ocr-item-del').addEventListener('click', () => row.remove());
    list.appendChild(row);
  });

  document.getElementById('screenshotPreviewFooter').classList.remove('hidden');
}

function parseOcrText(rawText) {
  const items = [];
  // Match a number (with optional decimal) at end of line, optionally preceded by currency symbol
  const amtRe = /(?:[$€£₱¥₹]\s*)?([\d]{1,10}(?:[.,]\d{1,2})?)\s*(?:[$€£₱¥₹])?$/;

  rawText.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim().replace(/\s+/g, ' ');
    if (line.length < 2 || line.length > 120) return;

    const m = line.match(amtRe);
    if (m && m.index > 0) {
      const amtStr = m[1].replace(',', '.');
      const amount = parseFloat(amtStr);
      const name   = line.slice(0, m.index).replace(/[-:•*|/\\]+$/, '').trim();
      if (name.length >= 2 && amount > 0 && amount < 1_000_000) {
        items.push({ name: name.slice(0, 80), amount });
        return;
      }
    }
    // No recognisable amount — add as name only
    if (line.length >= 2 && line.length <= 80) {
      items.push({ name: line, amount: null });
    }
  });

  return items;
}

async function processScreenshot(file) {
  openScreenshotPreviewModal();

  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    showOcrError('Image is too large (max 10 MB). Please use a smaller screenshot.');
    return;
  }

  try {
    const loadingP = document.querySelector('#ocrLoading p');
    if (loadingP) loadingP.textContent = 'Loading OCR engine…';

    const result = await Tesseract.recognize(file, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && loadingP) {
          const pct = Math.round((m.progress || 0) * 100);
          loadingP.textContent = `Reading text… ${pct}%`;
        }
      },
    });

    const items = parseOcrText(result.data.text || '');
    renderScreenshotPreviewItems(items);
  } catch (err) {
    showOcrError('Could not read screenshot: ' + err.message);
  }
}

async function handleScreenshotImport() {
  const rows = [...document.querySelectorAll('#screenshotItemsList .ocr-item-row')];
  const toImport = [];

  for (const row of rows) {
    const checked = row.querySelector('.ocr-item-check')?.checked;
    if (!checked) continue;
    const name = row.querySelector('.ocr-item-name')?.value.trim();
    const amtRaw = row.querySelector('.ocr-item-amt')?.value;
    const amount = parseAmount(amtRaw);
    if (!name) continue;
    if (!amount || amount <= 0) {
      const errEl = document.getElementById('screenshotPreviewError');
      errEl.textContent = `"${name}" needs a valid amount before importing.`;
      errEl.classList.remove('hidden');
      return;
    }
    toImport.push({ name, amount });
  }

  if (toImport.length === 0) {
    const errEl = document.getElementById('screenshotPreviewError');
    errEl.textContent = 'No items selected to import.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('screenshotImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  const catId  = screenshotTargetCatId;
  const date   = monthStartISO();
  const catItems = expenses.filter(e => e.category === catId && !e.checked);
  let nextOrder = catItems.length > 0 ? Math.max(...catItems.map(e => e.sort_order ?? 0)) + 1 : 1;

  const tmpRows = toImport.map((item, i) => ({
    id: 'tmp_ocr_' + Date.now() + '_' + i,
    user_id: currentUser.id,
    profile_id: currentProfileId,
    amount: item.amount,
    description: item.name,
    bank: null,
    category: catId,
    date,
    note: null,
    checked: false,
    planned: false,
    sort_order: nextOrder + i,
    installment_total: null,
    installment_current: null,
    installment_due_day: null,
    installment_complete: false,
    split_type: null,
    split_percentage: null,
  }));

  tmpRows.forEach(r => expenses.unshift(r));
  closeModal('screenshotPreviewModal');
  expandedListCats.add(catId);
  saveExpandState();
  renderAll();
  showToast(`${toImport.length} item${toImport.length !== 1 ? 's' : ''} added`);

  try {
    const payloads = toImport.map((item, i) => ({
      user_id: currentUser.id,
      profile_id: currentProfileId,
      amount: item.amount,
      description: item.name,
      bank: null,
      category: catId,
      date,
      note: null,
      sort_order: nextOrder + i,
      checked: false,
      planned: false,
      installment_total: null,
      installment_current: null,
      installment_due_day: null,
      installment_complete: false,
      split_type: null,
      split_percentage: null,
    }));
    const { data: rows, error } = await sb.from('expenses').insert(payloads).select();
    if (error) throw error;
    tmpRows.forEach(t => { expenses = expenses.filter(e => e.id !== t.id); });
    rows.forEach(r => expenses.push({ ...r, amount: parseFloat(r.amount) }));
    renderAll();
  } catch (err) {
    tmpRows.forEach(t => { expenses = expenses.filter(e => e.id !== t.id); });
    renderAll();
    showToast('Could not save — ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Selected';
  }
}

function buildItem(e) {
  const cat = getCat(e.category);
  const el = document.createElement('div');
  el.className = 'expense-item' + (e.checked ? ' checked' : '') + (e.planned ? ' planned' : '');
  el.dataset.id = e.id;
  el.dataset.dragId = e.id;

  const hasSplit = e.split_type === 'equal' || e.split_type === 'custom';
  const isShared = !hasSplit && cat.shared;

  let amtSub = '';
  if (e.checked) {
    amtSub = `<div class="expense-amt-sub expense-amt-paid">${e.installment_complete ? '✓ installment complete' : '✓ paid'}</div>`;
  } else if ((hasSplit || isShared) && !e.planned) {
    amtSub = `<div class="expense-amt-sub">${fmtCat(effectiveAmount(e), e.category)} your share</div>`;
  }

  const splitBadge = hasSplit
    ? (e.split_type === 'equal'
        ? '<span class="split-badge">÷2</span>'
        : `<span class="split-badge">${e.split_percentage}%</span>`)
    : (isShared ? '<span class="shared-badge">÷2</span>' : '');

  el.innerHTML = `
    <button class="drag-handle" aria-label="Drag to reorder" tabindex="-1">
      <svg viewBox="0 0 12 18" width="12" height="18" fill="currentColor">
        <circle cx="3.5" cy="3"  r="1.5"/><circle cx="8.5" cy="3"  r="1.5"/>
        <circle cx="3.5" cy="9"  r="1.5"/><circle cx="8.5" cy="9"  r="1.5"/>
        <circle cx="3.5" cy="15" r="1.5"/><circle cx="8.5" cy="15" r="1.5"/>
      </svg>
    </button>
    <button class="item-check-btn${e.checked ? ' checked' : ''}" data-id="${e.id}" aria-label="${e.checked ? 'Uncheck' : 'Check'}">
      ${e.checked ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>
    <div class="expense-info">
      <div class="expense-name-row">
        <div class="expense-desc">${escHtml(e.description)}</div>
        ${e.planned ? '<span class="planned-badge">Reminder</span>' : ''}
      </div>
      ${expenseInstallmentHtml(e)}
      ${e.bank ? `<div class="expense-bank">${escHtml(e.bank)}</div>` : ''}
    </div>
    <div class="expense-amt-right">
      <div class="expense-amount">${fmtCat(e.amount, e.category)}${splitBadge}</div>
      ${amtSub}
    </div>
    <button class="item-more-btn" aria-label="More options">
      <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="5" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="19" r="1.8" fill="currentColor"/></svg>
    </button>`;
  return el;
}

async function toggleCheck(id) {
  const idx = expenses.findIndex(e => e.id === id);
  if (idx === -1) return;
  const newVal = !expenses[idx].checked;
  expenses[idx] = { ...expenses[idx], checked: newVal };
  renderSummary(); renderListView();
  try { await dbPatchExpense(id, { checked: newVal }); }
  catch (err) {
    expenses[idx] = { ...expenses[idx], checked: !newVal };
    renderSummary(); renderListView(); showToast('Error: ' + err.message, true);
  }
}

async function togglePlanned(id) {
  const idx = expenses.findIndex(e => e.id === id);
  if (idx === -1) return;
  const newVal = !expenses[idx].planned;
  expenses[idx] = { ...expenses[idx], planned: newVal };
  renderAll();
  try { await dbPatchExpense(id, { planned: newVal }); }
  catch (err) {
    expenses[idx] = { ...expenses[idx], planned: !newVal };
    renderAll(); showToast('Error: ' + err.message, true);
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
  buildCategoryGrid(true); selectCategory(tmp);
  renderCategorySettings();
  showToast(`${name} added`);

  try {
    const { data: row, error } = await sb.from('categories')
      .insert({ user_id: currentUser.id, name, color, shared, currency_code: cur_code, currency_symbol: cur_symbol, sort_order: catOrder }).select().single();
    if (error) throw error;
    const idx = categories.findIndex(c => c.id === tmp);
    if (idx !== -1) categories[idx] = row;
    if (selectedCategory === tmp) selectedCategory = row.id;
    buildCategoryGrid(true); selectCategory(selectedCategory);
    renderCategorySettings();
  } catch (err) {
    categories = categories.filter(c => c.id !== tmp);
    if (selectedCategory === tmp) selectedCategory = categories[0]?.id || null;
    buildCategoryGrid(true); renderCategorySettings(); showToast('Could not save — ' + err.message, true);
  }
}

function deleteCategoryById(id) {
  openDeleteCategoryConfirm(id);
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


function clearInstallmentInline() {
  document.getElementById('inlineInstallTotal').value   = '';
  document.getElementById('inlineInstallCurrent').value = '';
  document.getElementById('inlineInstallDue').value     = '';
  document.getElementById('installmentInline').classList.add('hidden');
  document.getElementById('installmentToggleBtn').checked = false;
}

function clearSplitInline() {
  document.getElementById('splitInline').classList.add('hidden');
  document.getElementById('splitToggleBtn').checked = false;
  document.getElementById('splitPercentGroup').classList.add('hidden');
  document.getElementById('splitPercentInput').value = '';
  document.querySelectorAll('.split-type-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.split === 'equal'));
}

function openAddModal() {
  buildCategoryGrid(true);
  selectedBank     = null; buildBankGrid(null);
  selectedCategory = categories[0]?.id || null; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'New Allocation';
  document.getElementById('submitBtn').textContent  = 'Add Allocation';
  document.getElementById('amountInput').value = '';
  document.getElementById('descInput').value   = '';
  document.getElementById('editId').value      = '';
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  document.getElementById('plannedToggleBtn').checked = false;
  clearInstallmentInline();
  clearSplitInline();
  clearFormError();
  openModal('expenseModal');
}

function openEditModal(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  buildCategoryGrid(true);
  selectedCategory = e.category; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'Edit Allocation';
  document.getElementById('submitBtn').textContent  = 'Save Changes';
  selectedBank = e.bank || null; buildBankGrid(selectedBank);
  document.getElementById('amountInput').value = parseFloat(e.amount).toFixed(2);
  document.getElementById('descInput').value   = e.description;
  document.getElementById('editId').value      = e.id;
  // Populate installment fields if present
  if (e.installment_total) {
    document.getElementById('inlineInstallTotal').value   = e.installment_total;
    document.getElementById('inlineInstallCurrent').value = e.installment_current || '';
    document.getElementById('inlineInstallDue').value     = e.installment_due_day || '';
    document.getElementById('installmentInline').classList.remove('hidden');
    document.getElementById('installmentToggleBtn').checked = true;
  } else {
    clearInstallmentInline();
  }
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  document.getElementById('plannedToggleBtn').checked = e.planned || false;
  if (e.split_type) {
    document.getElementById('splitToggleBtn').checked = true;
    document.getElementById('splitInline').classList.remove('hidden');
    document.querySelectorAll('.split-type-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.split === e.split_type));
    if (e.split_type === 'custom') {
      document.getElementById('splitPercentGroup').classList.remove('hidden');
      document.getElementById('splitPercentInput').value = e.split_percentage ?? '';
    } else {
      document.getElementById('splitPercentGroup').classList.add('hidden');
      document.getElementById('splitPercentInput').value = '';
    }
  } else {
    clearSplitInline();
  }
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

  // Read optional inline installment fields
  const installInlineVisible = !document.getElementById('installmentInline').classList.contains('hidden');
  const installTotal   = installInlineVisible ? parseInt(document.getElementById('inlineInstallTotal').value,   10) || null : null;
  const installCurrent = installInlineVisible ? parseInt(document.getElementById('inlineInstallCurrent').value, 10) || null : null;
  const installDue     = installInlineVisible ? parseInt(document.getElementById('inlineInstallDue').value,     10) || null : null;
  if (installInlineVisible && installTotal) {
    if (!installCurrent || installCurrent < 1 || installCurrent > installTotal) {
      showFormError('Enter a valid current installment number (1–' + installTotal + ').'); return;
    }
  }
  const installFields = {
    installment_total:   installTotal   || null,
    installment_current: installCurrent || null,
    installment_due_day: installDue     || null,
    installment_complete: false,
  };
  const planned = document.getElementById('plannedToggleBtn').checked;

  const splitVisible = !document.getElementById('splitInline').classList.contains('hidden');
  const splitType = splitVisible
    ? (document.querySelector('.split-type-chip.active')?.dataset.split || 'equal')
    : null;
  const splitPercentage = splitType === 'custom'
    ? parseFloat(document.getElementById('splitPercentInput').value) || null
    : null;
  if (splitType === 'custom' && (!splitPercentage || splitPercentage < 1 || splitPercentage > 99)) {
    showFormError('Enter your share percentage (1–99).'); return;
  }
  const splitFields = { split_type: splitType, split_percentage: splitPercentage };

  const date = monthStartISO();
  closeModal('expenseModal');

  if (editId) {
    const i    = expenses.findIndex(e => e.id === editId);
    const prev = i !== -1 ? { ...expenses[i] } : null;
    if (i !== -1) expenses[i] = { ...expenses[i], amount, description: desc, bank, category: selectedCategory, ...installFields, planned, ...splitFields };
    renderAll();
    showToast('Updated');
    try {
      await dbPatchExpense(editId, { amount, description: desc, bank, category: selectedCategory, ...installFields, planned, ...splitFields });
    } catch (err) {
      if (prev && i !== -1) expenses[i] = prev;
      renderAll(); showToast('Could not save — ' + err.message, true);
    }
  } else {
    const tmp = 'tmp_' + Date.now();
    const catItems = expenses.filter(e => e.category === selectedCategory && !e.checked);
    const newOrder = catItems.length > 0 ? Math.max(...catItems.map(e => e.sort_order ?? 0)) + 1 : 1;
    expenses.unshift({ id: tmp, user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null, checked: false, planned, sort_order: newOrder, ...installFields, ...splitFields });
    renderAll();
    showToast('Added');
    try {
      const row = await dbSaveExpense({ user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null, sort_order: newOrder, ...installFields, planned, ...splitFields });
      const idx = expenses.findIndex(e => e.id === tmp);
      if (idx !== -1) expenses[idx] = { ...row, amount: parseFloat(row.amount) };
      renderAll();
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
  const isDup  = moveModalMode === 'duplicate';
  const isItem = moveModalMode === 'moveItem';
  document.getElementById('moveModalTitle').textContent = isDup ? 'Duplicate list to…' : isItem ? 'Move item to…' : 'Move to…';

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

function openMoveItemModal(id) {
  pendingMoveItemId = id;
  moveModalMode = 'moveItem';
  let y = currentYear, m = currentMonth + 1;
  if (m > 11) { m = 0; y++; }
  movePickerYear = y; movePickerMonth = m;
  updateMovePickerUI();
  openModal('moveModal');
}

async function handleMoveItemConfirm() {
  const id = pendingMoveItemId; if (!id) return;
  const e = expenses.find(x => x.id === id); if (!e) return;

  const targetYear  = movePickerYear;
  const targetMonth = movePickerMonth;
  const targetDate  = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
  const prevDate    = e.date;

  e.date = targetDate;
  closeModal('moveModal');
  renderAll();
  showToast(`Moved to ${getMonthLabel(targetYear, targetMonth)}`);

  try {
    await dbPatchExpense(id, { date: targetDate });
  } catch (err) {
    e.date = prevDate;
    renderAll();
    showToast('Could not move — ' + err.message, true);
  }
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
    let installComplete = false;
    if (e.installment_total && e.installment_current) {
      const next = e.installment_current + monthDelta;
      if (next < 1) return []; // no earlier installment — skip
      installComplete = next > e.installment_total; // only when it would exceed (e.g. 6→7 on a /6)
      installCurrent  = Math.min(e.installment_total, next);
    }
    return [{
      user_id: e.user_id, profile_id: e.profile_id,
      amount: e.amount, description: e.description,
      bank: e.bank, category: e.category,
      date: targetDate, note: e.note,
      sort_order: e.sort_order, checked: false,
      installment_total:    e.installment_total   || null,
      installment_current:  installCurrent,
      installment_due_day:  e.installment_due_day || null,
      installment_complete: installComplete,
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
    renderSummary();
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

function openDeleteCategoryConfirm(id) {
  const cat = getCat(id); if (!cat) return;
  pendingDeleteCatId = id;
  pendingDeleteGroupIds = null; pendingDeleteGroupPrefix = null;
  setDeleteModalContent(`Delete "${cat.name}"?`, 'Existing items in this category will show as Other.', 'Delete');
  openModal('deleteModal');
}

function openDeleteProfileConfirm(id) {
  const p = profiles.find(x => x.id === id); if (!p) return;
  pendingDeleteProfileId = id;
  setDeleteModalContent(`Delete "${p.name}"?`, 'All their expenses and income will be permanently removed.', 'Delete');
  openModal('deleteModal');
}

function openDeleteGroupConfirm(catIds, prefix) {
  pendingDeleteGroupIds = catIds; pendingDeleteGroupPrefix = prefix;
  pendingDeleteCatId = null;
  const names = catIds.map(id => getCat(id)?.name).filter(Boolean).join(', ');
  setDeleteModalContent(`Delete group "${prefix}"?`, `Removes ${names}. Existing items will show as Other.`, 'Delete group');
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
let pendingOptionsId  = null;
let pendingMoveItemId = null;
function openItemOptions(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  pendingOptionsId = id;
  document.getElementById('itemOptionsDesc').textContent = e.description;

  const plannedLabel = document.getElementById('itemOptionsPlannedLabel');
  if (plannedLabel) plannedLabel.textContent = e.planned ? 'Include in totals' : 'Mark as reminder';

  // Determine position within same category + checked state for move up/down
  const peers = getMonthExpenses()
    .filter(x => x.category === e.category && x.checked === e.checked)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const idx = peers.findIndex(x => x.id === id);
  document.getElementById('itemOptionsMoveUp').classList.toggle('hidden', idx <= 0);
  document.getElementById('itemOptionsMoveDown').classList.toggle('hidden', idx < 0 || idx >= peers.length - 1);

  openModal('itemOptionsModal');
}

async function moveExpenseInOrder(id, direction) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  const peers = getMonthExpenses()
    .filter(x => x.category === e.category && x.checked === e.checked)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const idx = peers.findIndex(x => x.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= peers.length) return;

  const a = peers[idx], b = peers[swapIdx];
  const aOrder = a.sort_order ?? idx + 1;
  const bOrder = b.sort_order ?? swapIdx + 1;
  a.sort_order = bOrder;
  b.sort_order = aOrder;
  renderListView();
  try {
    await Promise.all([
      dbPatchExpense(a.id, { sort_order: a.sort_order }),
      dbPatchExpense(b.id, { sort_order: b.sort_order }),
    ]);
  } catch (err) {
    a.sort_order = aOrder; b.sort_order = bOrder;
    renderListView();
    showToast('Could not reorder — ' + err.message, true);
  }
}

async function duplicateExpense(id) {
  const src = expenses.find(e => e.id === id); if (!src) return;
  const tmp = 'tmp_' + Date.now();
  const catItems = expenses.filter(e => e.category === src.category && !e.checked);
  const newOrder = catItems.length > 0 ? Math.max(...catItems.map(e => e.sort_order ?? 0)) + 1 : 1;
  const copy = { ...src, id: tmp, checked: false, planned: false, sort_order: newOrder };
  expenses.unshift(copy);
  renderAll();
  showToast('Duplicated');
  try {
    const payload = { user_id: src.user_id, profile_id: src.profile_id, amount: src.amount, description: src.description, bank: src.bank, category: src.category, date: src.date, note: src.note, sort_order: newOrder, installment_total: src.installment_total || null, installment_current: src.installment_current || null, installment_due_day: src.installment_due_day || null };
    const row = await dbSaveExpense(payload);
    const idx = expenses.findIndex(e => e.id === tmp);
    if (idx !== -1) expenses[idx] = { ...row, amount: parseFloat(row.amount) };
    renderAll();
  } catch (err) {
    expenses = expenses.filter(e => e.id !== tmp);
    renderAll(); showToast('Could not duplicate — ' + err.message, true);
  }
}

async function handleConfirmDelete() {
  if (pendingDeleteMonth) { await handleDeleteMonth(); return; }

  if (pendingDeleteProfileId) {
    const id = pendingDeleteProfileId;
    pendingDeleteProfileId = null;
    closeModal('deleteModal');
    await deleteProfile(id);
    return;
  }

  if (pendingDeleteGroupIds) {
    const ids    = pendingDeleteGroupIds;
    const prefix = pendingDeleteGroupPrefix;
    pendingDeleteGroupIds = null; pendingDeleteGroupPrefix = null;
    closeModal('deleteModal');
    try {
      await Promise.all(ids.map(id => sb.from('categories').delete().eq('id', id)));
      categories = categories.filter(c => !ids.includes(c.id));
      renderCategorySettings(); renderAll();
      showToast(`"${prefix}" group deleted`);
    } catch (err) { showToast('Error: ' + err.message, true); }
    return;
  }

  if (pendingDeleteCatId) {
    const id  = pendingDeleteCatId;
    const cat = getCat(id);
    pendingDeleteCatId = null;
    closeModal('deleteModal');
    try {
      const { error } = await sb.from('categories').delete().eq('id', id);
      if (error) throw error;
      categories = categories.filter(c => c.id !== id);
      renderCategorySettings(); renderAll();
      showToast(`${cat?.name ?? 'Category'} deleted`);
    } catch (err) { showToast('Error: ' + err.message, true); }
    return;
  }

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

/* ─── Page switching ─────────────────────────────────────── */
function showSettingsPage() {
  document.getElementById('mainPage').classList.add('hidden');
  document.getElementById('settingsPage').classList.remove('hidden');
  document.getElementById('openSettings').classList.add('active');
  document.getElementById('navHome').classList.remove('active');
  document.getElementById('pageTop').classList.add('hidden');
  buildCurrencySelect(); renderCategorySettings(); renderRates();
}
function hideSettingsPage() {
  document.getElementById('settingsPage').classList.add('hidden');
  document.getElementById('mainPage').classList.remove('hidden');
  document.getElementById('openSettings').classList.remove('active');
  document.getElementById('navHome').classList.add('active');
  document.getElementById('pageTop').classList.remove('hidden');
}

/* ─── Modal Helpers ─────────────────────────────────────── */
const MODALS = ['expenseModal', 'incomeModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal', 'installmentModal', 'moveModal', 'profileSheet', 'catOptionsSheet', 'screenshotPreviewModal'];

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  const anyOpen = MODALS.some(m => {
    const el = document.getElementById(m);
    return el && !el.classList.contains('hidden');
  });
  if (!anyOpen) document.body.classList.remove('modal-open');
}

function closeAllModals() {
  MODALS.forEach(m => document.getElementById(m)?.classList.add('hidden'));
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

  // ── Delegated listener for the entire expense list ──────────────────────────
  // One permanent listener handles all item/tile interactions regardless of
  // how many times renderListView() rebuilds the DOM.
  document.getElementById('expenseList').addEventListener('click', e => {
    // Check button
    const checkBtn = e.target.closest('.item-check-btn');
    if (checkBtn) {
      e.stopPropagation();
      const item = checkBtn.closest('[data-id]');
      if (item?.dataset.id) toggleCheck(item.dataset.id);
      return;
    }
    // More/options button
    const moreBtn = e.target.closest('.item-more-btn');
    if (moreBtn) {
      e.stopPropagation();
      const item = moreBtn.closest('[data-id]');
      if (item?.dataset.id) openItemOptions(item.dataset.id);
      return;
    }
    // Category options button
    const catOptsBtn = e.target.closest('.cat-opts-btn');
    if (catOptsBtn) {
      e.stopPropagation();
      const catIdsRaw = catOptsBtn.dataset.catIds;
      const catId     = catOptsBtn.dataset.catId;
      if (catIdsRaw) {
        const catIds = JSON.parse(catIdsRaw);
        openCatCtxMenu(catOptsBtn, catIds[0], catIds, catOptsBtn.dataset.label || '');
      } else if (catId) {
        openCatCtxMenu(catOptsBtn, catId);
      }
      return;
    }
    // Expense item tap → edit
    const expItem = e.target.closest('.expense-item[data-id]');
    if (expItem) {
      openEditModal(expItem.dataset.id);
      return;
    }
    // Sub-category header (inside group) expand/collapse
    const subHdr = e.target.closest('.list-sub-hdr[data-cat-id]');
    if (subHdr) {
      const catId    = subHdr.dataset.catId;
      const subTile  = subHdr.parentElement;
      const body     = subTile?.querySelector('.cat-items-body');
      const chevron  = subHdr.querySelector('.cat-chevron');
      if (catId && body) {
        const nowExp = expandedListCats.has(catId);
        if (nowExp) expandedListCats.delete(catId); else expandedListCats.add(catId);
        body.classList.toggle('collapsed', nowExp);
        chevron?.classList.toggle('collapsed', nowExp);
        saveExpandState();
      }
      return;
    }
    // Tile header expand/collapse (group or single)
    const tileHdr = e.target.closest('.list-tile-hdr');
    if (tileHdr) {
      const tile = tileHdr.closest('[data-tile-type]');
      if (!tile) return;
      if (tile.dataset.tileType === 'group') {
        const prefix  = tile.dataset.tilePrefix;
        const body    = tile.querySelector('.cat-group-body');
        const chevron = tileHdr.querySelector('.cat-chevron');
        if (prefix && body) {
          const nowExp = expandedListGroups.has(prefix);
          if (nowExp) expandedListGroups.delete(prefix); else expandedListGroups.add(prefix);
          body.classList.toggle('collapsed', nowExp);
          chevron?.classList.toggle('collapsed', nowExp);
          saveExpandState();
        }
      } else if (tile.dataset.tileType === 'single') {
        const catId   = tile.dataset.catId;
        const body    = tile.querySelector('.cat-items-body');
        const chevron = tileHdr.querySelector('.cat-chevron');
        if (catId && body) {
          const nowExp = expandedListCats.has(catId);
          if (nowExp) expandedListCats.delete(catId); else expandedListCats.add(catId);
          body.classList.toggle('collapsed', nowExp);
          chevron?.classList.toggle('collapsed', nowExp);
          saveExpandState();
        }
      }
    }
  });

  // Allocation form
  document.getElementById('openAdd').addEventListener('click', () => {
    openAddModal();
    document.getElementById('amountInput').focus();
  });
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('closeModal').addEventListener('click', () => closeModal('expenseModal'));
  document.getElementById('installmentToggleBtn').addEventListener('change', function() {
    const inline = document.getElementById('installmentInline');
    if (this.checked) {
      inline.classList.remove('hidden');
      document.getElementById('inlineInstallTotal').focus();
    } else {
      inline.classList.add('hidden');
      document.getElementById('inlineInstallTotal').value   = '';
      document.getElementById('inlineInstallCurrent').value = '';
      document.getElementById('inlineInstallDue').value     = '';
    }
  });
  document.getElementById('splitToggleBtn').addEventListener('change', function() {
    if (this.checked) {
      document.getElementById('splitInline').classList.remove('hidden');
    } else {
      clearSplitInline();
    }
  });
  document.querySelectorAll('.split-type-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.split-type-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const isCustom = chip.dataset.split === 'custom';
      const pctGroup = document.getElementById('splitPercentGroup');
      pctGroup.classList.toggle('hidden', !isCustom);
      if (isCustom) document.getElementById('splitPercentInput').focus();
    });
  });
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
  document.getElementById('cancelDelete').addEventListener('click',  () => {
    closeModal('deleteModal');
    pendingDeleteId = null; pendingDeleteCatId = null;
    pendingDeleteGroupIds = null; pendingDeleteGroupPrefix = null;
    pendingDeleteMonth = false; pendingDeleteProfileId = null;
  });
  document.getElementById('confirmDelete').addEventListener('click', handleConfirmDelete);

  // Item options sheet
  document.getElementById('itemOptionsEdit').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openEditModal(id);
  });
  document.getElementById('itemOptionsDuplicate').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); duplicateExpense(id);
  });
  document.getElementById('itemOptionsMoveToMonth').addEventListener('click', () => {
    const id = pendingOptionsId;
    closeModal('itemOptionsModal');
    setTimeout(() => openMoveItemModal(id), 50);
  });
  document.getElementById('itemOptionsInstallments').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openInstallmentModal(id);
  });
  document.getElementById('itemOptionsPlanned').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); togglePlanned(id);
  });
  document.getElementById('itemOptionsMoveUp').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); moveExpenseInOrder(id, 'up');
  });
  document.getElementById('itemOptionsMoveDown').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); moveExpenseInOrder(id, 'down');
  });
  document.getElementById('itemOptionsDelete').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openDeleteConfirm(id);
  });
  document.getElementById('itemOptionsCancel').addEventListener('click', () => closeModal('itemOptionsModal'));
  document.getElementById('catOptionsCancel').addEventListener('click', () => closeModal('catOptionsSheet'));

  // Installment modal
  document.getElementById('installmentSave').addEventListener('click', handleInstallmentSave);
  document.getElementById('installmentClear').addEventListener('click', handleInstallmentClear);
  document.getElementById('installmentCancel').addEventListener('click', () => closeModal('installmentModal'));

  // Settings page
  document.getElementById('openSettings').addEventListener('click', () => { closeAllModals(); showSettingsPage(); });
  document.getElementById('navHome').addEventListener('click', () => { closeAllModals(); hideSettingsPage(); });
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
    await sb.auth.signOut(); hideSettingsPage();
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
      hideSettingsPage(); renderAll(); showToast('All data cleared');
    } catch (err) { showToast('Error: ' + err.message, true); }
  });

  // Move / Duplicate modal
  document.getElementById('moveMonthSelect').addEventListener('change', e => {
    const [y, m] = e.target.value.split('-').map(Number);
    movePickerYear = y; movePickerMonth = m;
    updateMovePickerUI();
  });
  document.getElementById('confirmMoveBtn').addEventListener('click', () => {
    if (moveModalMode === 'duplicate') handleDuplicateMonthConfirm();
    else if (moveModalMode === 'moveItem') handleMoveItemConfirm();
    else handleMoveConfirm();
  });
  document.getElementById('cancelMove').addEventListener('click', () => closeModal('moveModal'));

  // Screenshot OCR
  document.getElementById('screenshotInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) processScreenshot(file);
  });
  document.getElementById('closeScreenshotPreview').addEventListener('click', () => closeModal('screenshotPreviewModal'));
  document.getElementById('screenshotImportBtn').addEventListener('click', handleScreenshotImport);

  // Backdrop clicks
  ['expenseModal', 'incomeModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal', 'installmentModal', 'moveModal', 'profileSheet', 'catOptionsSheet', 'screenshotPreviewModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
