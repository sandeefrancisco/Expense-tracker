'use strict';

/* ─── Constants ─────────────────────────────────────────── */
const STORAGE_KEY = 'expense_tracker_v1';
const SETTINGS_KEY = 'expense_tracker_settings_v1';

const CATEGORIES = [
  { id: 'food',          emoji: '🍽️',  label: 'Food',          color: '#fa5252', bg: '#fff5f5' },
  { id: 'shopping',      emoji: '🛍️',  label: 'Shopping',      color: '#ae3ec9', bg: '#f8f0ff' },
  { id: 'transport',     emoji: '🚗',  label: 'Transport',     color: '#1971c2', bg: '#e7f5ff' },
  { id: 'housing',       emoji: '🏠',  label: 'Housing',       color: '#0ca678', bg: '#e6fcf5' },
  { id: 'entertainment', emoji: '🎬',  label: 'Fun',           color: '#e67700', bg: '#fff9db' },
  { id: 'health',        emoji: '💊',  label: 'Health',        color: '#2f9e44', bg: '#ebfbee' },
  { id: 'utilities',     emoji: '💡',  label: 'Bills',         color: '#1098ad', bg: '#e3fafc' },
  { id: 'education',     emoji: '📚',  label: 'Learning',      color: '#3b5bdb', bg: '#edf2ff' },
  { id: 'travel',        emoji: '✈️',  label: 'Travel',        color: '#0077b6', bg: '#e8f4fd' },
  { id: 'personal',      emoji: '💆',  label: 'Personal',      color: '#d6336c', bg: '#fff0f6' },
  { id: 'gifts',         emoji: '🎁',  label: 'Gifts',         color: '#f76707', bg: '#fff4e6' },
  { id: 'other',         emoji: '📦',  label: 'Other',         color: '#868e96', bg: '#f8f9fa' },
];

const DEFAULT_SETTINGS = {
  currency: { symbol: '$', code: 'USD' },
  budget: 0,
};

/* ─── State ─────────────────────────────────────────────── */
let expenses    = [];
let settings    = { ...DEFAULT_SETTINGS };
let currentYear, currentMonth;
let pendingDeleteId = null;
let activeView  = 'list';

/* ─── Init ──────────────────────────────────────────────── */
function init() {
  const now = new Date();
  currentYear  = now.getFullYear();
  currentMonth = now.getMonth();

  loadData();
  buildCategoryGrid();
  bindEvents();
  renderAll();
}

/* ─── Persistence ───────────────────────────────────────── */
function loadData() {
  try {
    expenses = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved) settings = { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    expenses = [];
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveExpenses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/* ─── Helpers ───────────────────────────────────────────── */
function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function formatCurrency(amount) {
  const sym = settings.currency.symbol;
  return `${sym}${parseFloat(amount).toFixed(2)}`;
}

function formatAmount(amount) {
  return parseFloat(amount).toFixed(2);
}

function getCurrentMonthExpenses() {
  return expenses.filter(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });
}

function getMonthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 200);
  }, 2200);
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
  const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth();
  document.getElementById('nextMonth').style.opacity = isCurrentMonth ? '0.3' : '1';
  document.getElementById('nextMonth').disabled = isCurrentMonth;
}

function renderSummary() {
  const monthExpenses = getCurrentMonthExpenses();
  const total = monthExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);

  document.getElementById('totalAmount').textContent = formatCurrency(total);

  const count = monthExpenses.length;
  document.getElementById('expenseCount').textContent =
    count === 0 ? '0 expenses' : count === 1 ? '1 expense' : `${count} expenses`;

  const budgetEl = document.getElementById('budgetStatus');
  if (settings.budget > 0) {
    const pct = Math.round((total / settings.budget) * 100);
    const remaining = settings.budget - total;
    if (remaining >= 0) {
      budgetEl.textContent = `${formatCurrency(remaining)} left of ${formatCurrency(settings.budget)}`;
    } else {
      budgetEl.textContent = `${formatCurrency(Math.abs(remaining))} over budget`;
    }
  } else {
    budgetEl.textContent = '';
  }

  renderCategoryBars(monthExpenses, total);
}

function renderCategoryBars(monthExpenses, total) {
  const container = document.getElementById('categoryBars');
  container.innerHTML = '';

  if (total === 0) {
    const seg = document.createElement('div');
    seg.className = 'category-bar-segment';
    seg.style.cssText = 'width:100%;background:rgba(255,255,255,0.2);';
    container.appendChild(seg);
    return;
  }

  const byCategory = groupByCategory(monthExpenses);
  Object.entries(byCategory)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([catId, data]) => {
      const cat = getCategoryById(catId);
      const pct = (data.total / total) * 100;
      const seg = document.createElement('div');
      seg.className = 'category-bar-segment';
      seg.style.cssText = `width:${pct}%;background:rgba(255,255,255,0.7);`;
      seg.title = `${cat.label}: ${formatCurrency(data.total)}`;
      container.appendChild(seg);
    });
}

function groupByCategory(list) {
  return list.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = { total: 0, count: 0 };
    acc[e.category].total += parseFloat(e.amount);
    acc[e.category].count++;
    return acc;
  }, {});
}

function renderListView() {
  const container = document.getElementById('expenseList');
  const monthExpenses = getCurrentMonthExpenses();

  if (monthExpenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <p>No expenses yet</p>
        <span>Tap + to add your first one</span>
      </div>`;
    return;
  }

  const sorted = [...monthExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));
  const groups = sorted.reduce((acc, e) => {
    if (!acc[e.date]) acc[e.date] = [];
    acc[e.date].push(e);
    return acc;
  }, {});

  container.innerHTML = '';
  Object.entries(groups)
    .sort(([a], [b]) => new Date(b) - new Date(a))
    .forEach(([date, items]) => {
      const label = document.createElement('div');
      label.className = 'date-group-label';
      label.textContent = formatDate(date);
      container.appendChild(label);

      items.forEach(e => {
        container.appendChild(buildExpenseItem(e));
      });
    });
}

function buildExpenseItem(e) {
  const cat = getCategoryById(e.category);
  const el  = document.createElement('div');
  el.className = 'expense-item';
  el.dataset.id = e.id;

  el.innerHTML = `
    <div class="expense-icon" style="background:${cat.bg};">${cat.emoji}</div>
    <div class="expense-info">
      <div class="expense-desc">${escHtml(e.description)}</div>
      <div class="expense-meta">
        <span>${cat.label}</span>
        ${e.note ? `<span>·</span><span>${escHtml(e.note)}</span>` : ''}
      </div>
    </div>
    <div class="expense-amount">${formatCurrency(e.amount)}</div>
    <div class="expense-actions">
      <button class="item-action-btn edit-action" data-id="${e.id}" aria-label="Edit">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="item-action-btn delete-action" data-id="${e.id}" aria-label="Delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    </div>`;

  el.addEventListener('click', e => {
    if (e.target.closest('.item-action-btn')) return;
    el.classList.toggle('show-actions');
  });

  el.querySelector('.edit-action').addEventListener('click', ev => {
    ev.stopPropagation();
    openEditModal(el.dataset.id);
  });

  el.querySelector('.delete-action').addEventListener('click', ev => {
    ev.stopPropagation();
    openDeleteConfirm(el.dataset.id);
  });

  return el;
}

function renderBreakdownView() {
  const container = document.getElementById('breakdownList');
  const monthExpenses = getCurrentMonthExpenses();
  const total = monthExpenses.reduce((s, e) => s + parseFloat(e.amount), 0);

  if (monthExpenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <p>No data yet</p>
        <span>Add some expenses to see breakdown</span>
      </div>`;
    return;
  }

  const grouped = groupByCategory(monthExpenses);
  const sorted  = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);
  const max     = sorted[0][1].total;

  container.innerHTML = '';
  sorted.forEach(([catId, data]) => {
    const cat  = getCategoryById(catId);
    const pct  = total > 0 ? (data.total / total) * 100 : 0;
    const bar  = total > 0 ? (data.total / max) * 100 : 0;

    const el = document.createElement('div');
    el.className = 'breakdown-item';
    el.innerHTML = `
      <div class="breakdown-header">
        <div class="breakdown-icon" style="background:${cat.bg};">${cat.emoji}</div>
        <div class="breakdown-info">
          <div class="breakdown-name">${cat.label}</div>
          <div class="breakdown-count">${data.count} ${data.count === 1 ? 'expense' : 'expenses'} · ${pct.toFixed(1)}%</div>
        </div>
        <div class="breakdown-amount">${formatCurrency(data.total)}</div>
      </div>
      <div class="breakdown-bar-track">
        <div class="breakdown-bar-fill" style="width:0;background:${cat.color};" data-width="${bar}"></div>
      </div>`;
    container.appendChild(el);
  });

  requestAnimationFrame(() => {
    container.querySelectorAll('.breakdown-bar-fill').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  });
}

/* ─── Category Grid ─────────────────────────────────────── */
function buildCategoryGrid() {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip';
    chip.dataset.id = cat.id;
    chip.innerHTML = `<span class="chip-emoji">${cat.emoji}</span><span class="chip-label">${cat.label}</span>`;
    chip.addEventListener('click', () => selectCategory(cat.id));
    grid.appendChild(chip);
  });
}

let selectedCategory = CATEGORIES[0].id;

function selectCategory(id) {
  selectedCategory = id;
  document.querySelectorAll('.category-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
}

/* ─── Add / Edit Modal ──────────────────────────────────── */
function openAddModal() {
  selectedCategory = CATEGORIES[0].id;
  selectCategory(selectedCategory);

  document.getElementById('modalTitle').textContent = 'New Expense';
  document.getElementById('submitBtn').textContent  = 'Add Expense';
  document.getElementById('amountInput').value  = '';
  document.getElementById('descInput').value    = '';
  document.getElementById('noteInput').value    = '';
  document.getElementById('editId').value       = '';
  document.getElementById('dateInput').value    = todayDate();
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;

  openModal('expenseModal');
  setTimeout(() => document.getElementById('amountInput').focus(), 300);
}

function openEditModal(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;

  selectedCategory = e.category;
  selectCategory(selectedCategory);

  document.getElementById('modalTitle').textContent = 'Edit Expense';
  document.getElementById('submitBtn').textContent  = 'Save Changes';
  document.getElementById('amountInput').value  = formatAmount(e.amount);
  document.getElementById('descInput').value    = e.description;
  document.getElementById('noteInput').value    = e.note || '';
  document.getElementById('editId').value       = e.id;
  document.getElementById('dateInput').value    = e.date;
  document.getElementById('currencySymbol').textContent = settings.currency.symbol;

  openModal('expenseModal');
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function handleFormSubmit(ev) {
  ev.preventDefault();

  const amount = parseFloat(document.getElementById('amountInput').value);
  const desc   = document.getElementById('descInput').value.trim();
  const date   = document.getElementById('dateInput').value;
  const note   = document.getElementById('noteInput').value.trim();
  const editId = document.getElementById('editId').value;

  if (!amount || amount <= 0) {
    document.getElementById('amountInput').focus();
    return;
  }
  if (!desc) {
    document.getElementById('descInput').focus();
    return;
  }
  if (!date) return;

  if (editId) {
    const idx = expenses.findIndex(e => e.id === editId);
    if (idx !== -1) {
      expenses[idx] = { ...expenses[idx], amount, description: desc, category: selectedCategory, date, note };
      showToast('Expense updated');
    }
  } else {
    expenses.push({ id: generateId(), amount, description: desc, category: selectedCategory, date, note, createdAt: Date.now() });
    showToast('Expense added');
  }

  saveExpenses();
  closeModal('expenseModal');
  renderAll();
}

/* ─── Delete ────────────────────────────────────────────── */
function openDeleteConfirm(id) {
  pendingDeleteId = id;
  openModal('deleteModal');
}

function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  expenses = expenses.filter(e => e.id !== pendingDeleteId);
  saveExpenses();
  closeModal('deleteModal');
  pendingDeleteId = null;
  renderAll();
  showToast('Expense deleted');
}

/* ─── Settings ──────────────────────────────────────────── */
function syncSettingsUI() {
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.code === settings.currency.code);
  });
  document.getElementById('budgetInput').value = settings.budget || '';
  document.getElementById('budgetCurrencySymbol').textContent = settings.currency.symbol;
}

function handleCurrencySelect(code, symbol) {
  settings.currency = { code, symbol };
  saveSettings();
  syncSettingsUI();
  renderAll();
}

function handleBudgetChange(val) {
  settings.budget = parseFloat(val) || 0;
  saveSettings();
  renderSummary();
}

/* ─── Modal Helpers ─────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.style.overflow = '';
}

function closeAllModals() {
  ['expenseModal', 'settingsModal', 'deleteModal'].forEach(closeModal);
}

/* ─── View Switching ────────────────────────────────────── */
function switchView(view) {
  activeView = view;

  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  document.getElementById('listView').classList.toggle('hidden', view !== 'list');
  document.getElementById('breakdownView').classList.toggle('hidden', view !== 'breakdown');

  if (view === 'breakdown') renderBreakdownView();
}

/* ─── Event Binding ─────────────────────────────────────── */
function bindEvents() {
  // Month navigation
  document.getElementById('prevMonth').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderAll();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    const now = new Date();
    if (currentYear === now.getFullYear() && currentMonth === now.getMonth()) return;
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderAll();
  });

  // FAB / Add
  document.getElementById('openAdd').addEventListener('click', openAddModal);

  // Form submit
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);

  // Close modals
  document.getElementById('closeModal').addEventListener('click', () => closeModal('expenseModal'));
  document.getElementById('closeSettings').addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('cancelDelete').addEventListener('click', () => closeModal('deleteModal'));
  document.getElementById('confirmDelete').addEventListener('click', handleConfirmDelete);

  // Backdrop clicks
  document.getElementById('expenseModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('expenseModal');
  });
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('settingsModal');
  });
  document.getElementById('deleteModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('deleteModal');
  });

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => openModal('settingsModal'));

  document.getElementById('currencyOptions').addEventListener('click', e => {
    const btn = e.target.closest('.currency-btn');
    if (btn) handleCurrencySelect(btn.dataset.code, btn.dataset.symbol);
  });

  document.getElementById('budgetInput').addEventListener('input', e => {
    handleBudgetChange(e.target.value);
  });

  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm('Delete all expenses? This cannot be undone.')) {
      expenses = [];
      saveExpenses();
      closeModal('settingsModal');
      renderAll();
      showToast('All expenses cleared');
    }
  });

  // View toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
  });
}

/* ─── XSS prevention ────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─── Boot ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
