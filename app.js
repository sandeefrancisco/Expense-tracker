'use strict';

/* ─── Supabase ──────────────────────────────────────────── */
const SUPABASE_URL      = 'https://eizhfvieozigsgolckez.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpemhmdmllb3ppZ3Nnb2xja2V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTEyMDUsImV4cCI6MjA5NTc2NzIwNX0.v-qAHGR-I63RL4Ue0YH5evTwot9riE-nUuw0ACffaYA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
let settings          = { currency: { symbol: '$', code: 'USD' } };
let currentUser       = null;
let currentYear, currentMonth;
let pendingDeleteId   = null;
let selectedCategory  = null;
let selectedCatColor  = CATEGORY_COLORS[0];
let selectedCatShared = false;
let authMode          = 'signin';

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
      currentUser      = null;
      expenses         = [];
      incomeEntries    = [];
      profiles         = [];
      currentProfileId = null;
      completedMonths  = [];
      settings         = { currency: { symbol: '$', code: 'USD' } };
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

  if (!currentProfileId || !profiles.find(p => p.id === currentProfileId))
    currentProfileId = profiles[0]?.id || null;

  if (!selectedCategory || !categories.find(c => c.id === selectedCategory))
    selectedCategory = categories[0]?.id || null;
}

/* ─── Helpers ───────────────────────────────────────────── */
function getCat(id) {
  const c = categories.find(c => c.id === id) || { id: 'other', name: 'Other', color: '#868e96', shared: false };
  // Auto-detect shared if name contains "shared" (case-insensitive)
  if (!c.shared && /shared/i.test(c.name)) return { ...c, shared: true };
  return c;
}
function fmt(n)      { return `${settings.currency.symbol}${parseFloat(n).toFixed(2)}`; }
function parseAmount(str) { return parseFloat(String(str).replace(',', '.')); }
function effectiveAmount(e) { const c = getCat(e.category); return c.shared ? e.amount / 2 : e.amount; }

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
      renderHeader(); renderSummary(); showToast('Error: ' + err.message);
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
      renderHeader(); renderSummary(); showToast('Error: ' + err.message);
    }
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden'); t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200); }, 2200);
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
  const bar = document.getElementById('profileBar');
  if (!bar) return;
  bar.innerHTML = '';
  profiles.forEach(p => {
    const pill = document.createElement('button');
    pill.className = 'profile-pill' + (p.id === currentProfileId ? ' active' : '');
    pill.textContent = p.name;
    pill.addEventListener('click', () => {
      currentProfileId = p.id;
      renderProfileBar();
      renderHeader();
      renderSummary();
      renderListView();
    });
    bar.appendChild(pill);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'profile-add-btn';
  addBtn.textContent = '+ Add person';
  addBtn.addEventListener('click', openAddProfileModal);
  bar.appendChild(addBtn);
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
    if (currentProfileId === tmp) currentProfileId = prof.id;
    renderProfileBar();
  } catch (err) {
    profiles = profiles.filter(p => p.id !== tmp);
    if (currentProfileId === tmp) currentProfileId = profiles[0]?.id || null;
    renderAll(); showToast('Could not save — ' + err.message);
  }
}

async function deleteProfile(id) {
  const prof = profiles.find(p => p.id === id);
  if (!prof) return;
  if (profiles.length <= 1) { showToast("Can't delete the only person"); return; }
  if (!confirm(`Delete "${prof.name}" and all their allocations? This cannot be undone.`)) return;
  const { error } = await sb.from('profiles').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
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
    row.className = 'profile-settings-row';
    row.innerHTML = `
      <span class="profile-settings-name">${escHtml(p.name)}</span>
      ${profiles.length > 1 ? `<button class="danger-btn profile-del-btn" data-id="${p.id}">Delete</button>` : '<span class="profile-only-label">Default</span>'}`;
    if (profiles.length > 1) {
      row.querySelector('.profile-del-btn').addEventListener('click', () => deleteProfile(p.id));
    }
    container.appendChild(row);
  });
}

function renderHeader() {
  const done = isMonthDone(currentYear, currentMonth);
  document.getElementById('monthLabel').textContent = getMonthLabel(currentYear, currentMonth) + (done ? ' ✅' : '');
  const now = new Date();
  const cur = currentYear === now.getFullYear() && currentMonth === now.getMonth();
  const btn = document.getElementById('nextMonth');
  btn.style.opacity = cur ? '0.3' : '1'; btn.disabled = cur;
}

function renderSummary() {
  const list    = getMonthExpenses();
  const income  = getMonthIncome();
  const allocated = list.reduce((s, e) => s + effectiveAmount(e), 0);
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

  // Mark-done button
  const doneRow = document.getElementById('summaryDoneRow');
  if (doneRow) {
    const done = isMonthDone(currentYear, currentMonth);
    if (allocated > 0 || done) {
      doneRow.innerHTML = `<button class="summary-done-btn${done ? ' done' : ''}" id="toggleDoneBtn">${done ? '✅ Done · Undo' : '✓ Mark as done'}</button>`;
      doneRow.querySelector('#toggleDoneBtn').addEventListener('click', toggleMonthDone);
    } else {
      doneRow.innerHTML = '';
    }
  }
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

  // Group expenses by category
  const byCat = {};
  list.forEach(e => {
    if (!byCat[e.category]) byCat[e.category] = { items: [], total: 0 };
    byCat[e.category].items.push(e);
    byCat[e.category].total += effectiveAmount(e);
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
  topLevel.sort((a, b) => b.total - a.total);

  container.innerHTML = '';

  topLevel.forEach(item => {
    if (item.type === 'group') {
      // Parent header — e.g. "Berlin"
      const ph = document.createElement('div');
      ph.className = 'cat-group-header cat-group-parent';
      ph.innerHTML = `
        <div class="cat-group-name">${escHtml(item.prefix)}</div>
        <div class="cat-group-total">${fmt(item.total)}</div>`;
      container.appendChild(ph);

      // Sub-category headers + items
      const sortedSubs = item.catIds
        .filter(id => byCat[id])
        .sort((a, b) => byCat[b].total - byCat[a].total);

      sortedSubs.forEach(catId => {
        const cat = getCat(catId);
        const { items, total } = byCat[catId];
        const words = cat.name.split(/\s+/);
        const sublabel = words.slice(1).join(' ') || cat.name;

        const sh = document.createElement('div');
        sh.className = 'cat-group-header cat-group-sub';
        sh.innerHTML = `
          <span class="cat-group-dot" style="background:${cat.color}"></span>
          <div class="cat-group-name">${escHtml(sublabel)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</div>
          <div class="cat-group-total">${fmt(total)}</div>`;
        container.appendChild(sh);

        items.sort((a, b) => b.amount - a.amount).forEach(e => {
          container.appendChild(buildItem(e));
        });
      });
    } else {
      const cat = getCat(item.catId);
      const { items, total } = byCat[item.catId];

      const header = document.createElement('div');
      header.className = 'cat-group-header';
      header.innerHTML = `
        <span class="cat-group-dot" style="background:${cat.color}"></span>
        <div class="cat-group-name">${escHtml(cat.name)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</div>
        <div class="cat-group-total">${fmt(total)}</div>`;
      container.appendChild(header);

      items.sort((a, b) => b.amount - a.amount).forEach(e => {
        container.appendChild(buildItem(e));
      });
    }
  });
}

function buildItem(e) {
  const cat = getCat(e.category);
  const el = document.createElement('div');
  el.className = 'expense-item' + (e.checked ? ' checked' : '');
  el.dataset.id = e.id;
  el.innerHTML = `
    <button class="item-check-btn${e.checked ? ' checked' : ''}" data-id="${e.id}" aria-label="${e.checked ? 'Uncheck' : 'Check'}">
      ${e.checked ? '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>
    <div class="expense-amount">${fmt(e.amount)}${cat.shared ? '<span class="shared-badge">÷2</span>' : ''}</div>
    <div class="expense-info">
      <div class="expense-desc">${escHtml(e.description)}</div>
      ${e.bank ? `<div class="expense-bank">${escHtml(e.bank)}</div>` : ''}
    </div>`;
  el.addEventListener('click', ev => {
    if (ev.target.closest('.item-check-btn')) return;
    openItemOptions(e.id);
  });
  el.querySelector('.item-check-btn').addEventListener('click', ev => { ev.stopPropagation(); toggleCheck(e.id); });
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
    renderListView(); showToast('Error: ' + err.message);
  }
}

/* ─── Category Grid ─────────────────────────────────────── */
function buildCategoryGrid() {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'category-chip'; chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="chip-dot" style="background:${cat.color}"></span><span class="chip-label">${escHtml(cat.name)}</span>`;
    chip.addEventListener('click', () => selectCategory(cat.id));
    grid.appendChild(chip);
  });
  const addChip = document.createElement('button');
  addChip.type = 'button'; addChip.className = 'category-chip cat-add-chip';
  addChip.innerHTML = `<span class="chip-dot-add">+</span><span class="chip-label">New</span>`;
  addChip.addEventListener('click', openAddCategoryModal);
  grid.appendChild(addChip);
}

function selectCategory(id) {
  selectedCategory = id;
  document.querySelectorAll('.category-chip').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
}

/* ─── Category Management ───────────────────────────────── */
function openAddCategoryModal() {
  selectedCatColor  = CATEGORY_COLORS[0];
  selectedCatShared = false;
  document.getElementById('catNameInput').value = '';
  document.getElementById('catFormError').classList.add('hidden');
  const tb = document.getElementById('toggleShared');
  tb.textContent = 'No'; tb.classList.remove('on');
  buildColorPicker();
  openModal('categoryModal');
  setTimeout(() => document.getElementById('catNameInput').focus(), 300);
}

function buildColorPicker() {
  const picker = document.getElementById('catColorPicker');
  picker.innerHTML = '';
  CATEGORY_COLORS.forEach(color => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'cat-color-swatch' + (color === selectedCatColor ? ' selected' : '');
    sw.style.background = color; sw.dataset.color = color;
    sw.addEventListener('click', () => {
      selectedCatColor = color;
      document.querySelectorAll('.cat-color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === color));
    });
    picker.appendChild(sw);
  });
}

async function handleAddCategory(e) {
  e.preventDefault();
  const name  = document.getElementById('catNameInput').value.trim();
  const errEl = document.getElementById('catFormError');
  if (!name) { errEl.textContent = 'Enter a name.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const tmp = 'tmp_' + Date.now();
  categories.push({ id: tmp, user_id: currentUser.id, name, color: selectedCatColor, shared: selectedCatShared });
  selectedCategory = tmp;
  closeModal('categoryModal');
  buildCategoryGrid(); selectCategory(tmp);
  showToast(`${name} added`);

  try {
    const { data: row, error } = await sb.from('categories')
      .insert({ user_id: currentUser.id, name, color: selectedCatColor, shared: selectedCatShared }).select().single();
    if (error) throw error;
    const idx = categories.findIndex(c => c.id === tmp);
    if (idx !== -1) categories[idx] = row;
    if (selectedCategory === tmp) selectedCategory = row.id;
    buildCategoryGrid(); selectCategory(selectedCategory);
    renderCategorySettings();
  } catch (err) {
    categories = categories.filter(c => c.id !== tmp);
    if (selectedCategory === tmp) selectedCategory = categories[0]?.id || null;
    buildCategoryGrid(); showToast('Could not save — ' + err.message);
  }
}

async function deleteCategoryById(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  if (!confirm(`Delete "${cat.name}"? Existing items will show as Other.`)) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
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
    row.className = 'profile-settings-row';
    row.innerHTML = `
      <span class="cat-settings-dot" style="background:${cat.color}"></span>
      <span class="profile-settings-name">${escHtml(cat.name)}${cat.shared ? ' <span class="shared-badge">÷2</span>' : ''}</span>
      <button class="danger-btn cat-del-btn" data-id="${cat.id}">Delete</button>`;
    row.querySelector('.cat-del-btn').addEventListener('click', () => deleteCategoryById(cat.id));
    container.appendChild(row);
  });
}

/* ─── Add / Edit Modal ──────────────────────────────────── */
function clearFormError() { document.getElementById('formError').classList.add('hidden'); }
function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg; el.classList.remove('hidden');
}

function updateBankSuggestions() {
  const dl = document.getElementById('bankSuggestions');
  if (!dl) return;
  const banks = [...new Set(expenses.filter(e => e.bank).map(e => e.bank))];
  dl.innerHTML = banks.map(b => `<option value="${escHtml(b)}">`).join('');
}

function openAddModal() {
  buildCategoryGrid();
  updateBankSuggestions();
  selectedCategory = categories[0]?.id || null; selectCategory(selectedCategory);
  document.getElementById('modalTitle').textContent = 'New Allocation';
  document.getElementById('submitBtn').textContent  = 'Add Allocation';
  document.getElementById('amountInput').value = '';
  document.getElementById('descInput').value   = '';
  document.getElementById('bankInput').value   = '';
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
  document.getElementById('amountInput').value = parseFloat(e.amount).toFixed(2);
  document.getElementById('descInput').value   = e.description;
  document.getElementById('bankInput').value   = e.bank || '';
  document.getElementById('editId').value      = e.id;
  updateBankSuggestions();
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;
  clearFormError();
  openModal('expenseModal');
}

async function handleFormSubmit(ev) {
  ev.preventDefault();
  clearFormError();
  const amount = parseAmount(document.getElementById('amountInput').value);
  const desc   = document.getElementById('descInput').value.trim();
  const bank   = document.getElementById('bankInput').value.trim();
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
    try {
      await dbPatchExpense(editId, { amount, description: desc, bank, category: selectedCategory, date });
      showToast('Updated');
    } catch (err) {
      if (prev && i !== -1) expenses[i] = prev;
      renderAll(); showToast('Could not save — ' + err.message);
    }
  } else {
    const tmp = 'tmp_' + Date.now();
    expenses.unshift({ id: tmp, user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null, checked: false });
    renderAll();
    try {
      const row = await dbSaveExpense({ user_id: currentUser.id, profile_id: currentProfileId, amount, description: desc, bank, category: selectedCategory, date, note: null });
      const idx = expenses.findIndex(e => e.id === tmp);
      if (idx !== -1) expenses[idx] = { ...row, amount: parseFloat(row.amount) };
      showToast('Added');
    } catch (err) {
      expenses = expenses.filter(e => e.id !== tmp);
      renderAll(); showToast('Could not save — ' + err.message);
    }
  }
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
      const prev = [...incomeEntries];
      incomeEntries = incomeEntries.filter(x => x.id !== r.id);
      renderIncomeList(); renderSummary();
      showToast('Income removed');
      try { await dbRemoveIncome(r.id); }
      catch (err) { incomeEntries = prev; renderIncomeList(); renderSummary(); showToast('Error: ' + err.message); }
    });
    container.appendChild(el);
  });
}

async function handleIncomeSubmit(e) {
  e.preventDefault();
  const amount = parseAmount(document.getElementById('incomeAmountInput').value);
  const source = document.getElementById('incomeSourceInput').value.trim() || 'Salary';
  const note   = document.getElementById('incomeNoteInput').value.trim();
  const errEl  = document.getElementById('incomeFormError');
  if (!amount || amount <= 0) { errEl.textContent = 'Enter an income amount.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  const tmp = 'tmp_' + Date.now();
  incomeEntries.push({ id: tmp, user_id: currentUser.id, profile_id: currentProfileId, year: currentYear, month: currentMonth, amount, source, note: note || null });
  document.getElementById('incomeAmountInput').value = '';
  document.getElementById('incomeSourceInput').value = '';
  document.getElementById('incomeNoteInput').value   = '';
  renderIncomeList(); renderSummary();
  showToast('Income added');

  try {
    const row = await dbSaveIncome({ user_id: currentUser.id, profile_id: currentProfileId, year: currentYear, month: currentMonth, amount, source, note: note || null });
    const idx = incomeEntries.findIndex(r => r.id === tmp);
    if (idx !== -1) incomeEntries[idx] = { ...row, amount: parseFloat(row.amount) };
  } catch (err) {
    incomeEntries = incomeEntries.filter(r => r.id !== tmp);
    renderIncomeList(); renderSummary();
    showToast('Could not save — ' + err.message);
  }
}

/* ─── Delete ────────────────────────────────────────────── */
function openDeleteConfirm(id) { pendingDeleteId = id; openModal('deleteModal'); }

/* ─── Item Options Sheet ────────────────────────────────── */
let pendingOptionsId = null;
function openItemOptions(id) {
  const e = expenses.find(x => x.id === id); if (!e) return;
  pendingOptionsId = id;
  document.getElementById('itemOptionsDesc').textContent = e.description;
  openModal('itemOptionsModal');
}

async function handleConfirmDelete() {
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
  document.querySelectorAll('.currency-btn').forEach(b => b.classList.toggle('active', b.dataset.code === settings.currency.code));
}

async function handleCurrencySelect(code, symbol) {
  settings.currency = { code, symbol };
  syncSettingsUI(); renderAll();
  try { await dbSaveSettings(); } catch {}
}

/* ─── Modal Helpers ─────────────────────────────────────── */
const MODALS = ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal'];

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
  document.getElementById('amountInput').addEventListener('input', clearFormError);
  document.getElementById('descInput').addEventListener('input', clearFormError);

  // Income
  document.getElementById('logIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('editIncomeBtn').addEventListener('click', openIncomeModal);
  document.getElementById('incomeForm').addEventListener('submit', handleIncomeSubmit);
  document.getElementById('closeIncomeModal').addEventListener('click', () => closeModal('incomeModal'));

  // Delete
  document.getElementById('cancelDelete').addEventListener('click',  () => closeModal('deleteModal'));
  document.getElementById('confirmDelete').addEventListener('click', handleConfirmDelete);

  // Item options sheet
  document.getElementById('itemOptionsEdit').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openEditModal(id);
  });
  document.getElementById('itemOptionsDelete').addEventListener('click', () => {
    const id = pendingOptionsId; closeModal('itemOptionsModal'); openDeleteConfirm(id);
  });
  document.getElementById('itemOptionsCancel').addEventListener('click', () => closeModal('itemOptionsModal'));

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => { renderProfilesList(); renderCategorySettings(); openModal('settingsModal'); });
  document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));

  // Profile modal
  document.getElementById('profileForm').addEventListener('submit', handleAddProfile);
  document.getElementById('cancelAddProfile').addEventListener('click', () => closeModal('profileModal'));

  // Category modal
  document.getElementById('categoryForm').addEventListener('submit', handleAddCategory);
  document.getElementById('cancelAddCat').addEventListener('click', () => closeModal('categoryModal'));
  document.getElementById('toggleShared').addEventListener('click', () => {
    selectedCatShared = !selectedCatShared;
    const btn = document.getElementById('toggleShared');
    btn.textContent = selectedCatShared ? 'Yes' : 'No';
    btn.classList.toggle('on', selectedCatShared);
  });

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
        sb.from('completed_months').delete().eq('user_id', currentUser.id),
      ]);
      expenses = []; incomeEntries = []; completedMonths = [];
      closeModal('settingsModal'); renderAll(); showToast('All data cleared');
    } catch (err) { showToast('Error: ' + err.message); }
  });

  // Backdrop clicks
  ['expenseModal', 'incomeModal', 'settingsModal', 'deleteModal', 'profileModal', 'categoryModal', 'itemOptionsModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });
}
