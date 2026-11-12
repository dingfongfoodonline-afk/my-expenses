/* Pure logic helpers (no DOM). Shared by the app and by node tests. */
(function (root) {
  'use strict';

  const EXPENSE_CATS = [
    { id: 'food', name: 'Food', icon: '🍜', color: '#FF9F0A' },
    { id: 'transport', name: 'Transport', icon: '🚕', color: '#0A84FF' },
    { id: 'shopping', name: 'Shopping', icon: '🛍️', color: '#FF375F' },
    { id: 'bills', name: 'Bills', icon: '💡', color: '#FFD60A' },
    { id: 'health', name: 'Health', icon: '💊', color: '#30D158' },
    { id: 'entertainment', name: 'Entertainment', icon: '🎬', color: '#BF5AF2' },
    { id: 'work', name: 'Work', icon: '💼', color: '#64D2FF' },
    { id: 'other', name: 'Other', icon: '📦', color: '#8E8E93' }
  ];
  const INCOME_CATS = [
    { id: 'salary', name: 'Salary', icon: '💰', color: '#30D158' },
    { id: 'topup', name: 'Top-up', icon: '➕', color: '#34C759' },
    { id: 'transfer', name: 'Transfer in', icon: '🔁', color: '#5AC8FA' },
    { id: 'refund', name: 'Refund', icon: '↩️', color: '#66D4CF' },
    { id: 'other-in', name: 'Other income', icon: '✨', color: '#A2845E' }
  ];
  const PALETTE = ['#FF6B6B', '#4ECDC4', '#FFA94D', '#845EF7', '#20C997', '#F06595', '#339AF0', '#94D82D', '#FCC419', '#22B8CF'];

  function allCategories(custom) {
    const c = (custom || []).map(x => Object.assign({ custom: true }, x));
    return {
      expense: EXPENSE_CATS.concat(c.filter(x => x.type !== 'income')),
      income: INCOME_CATS.concat(c.filter(x => x.type === 'income'))
    };
  }
  function findCategory(id, custom) {
    const all = allCategories(custom);
    return all.expense.concat(all.income).find(c => c.id === id) ||
      { id: id, name: id ? String(id) : 'Other', icon: '📦', color: '#8E8E93' };
  }

  // Money is stored as integer satang (1/100) to avoid float drift.
  function toCents(v) {
    if (typeof v === 'number') return Math.round(v * 100);
    const s = String(v == null ? '' : v).replace(/[,\s฿]/g, '');
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  function fmtMoney(cents, symbol, opts) {
    symbol = symbol == null ? '฿' : symbol;
    opts = opts || {};
    const neg = cents < 0;
    const abs = Math.abs(cents) / 100;
    const dec = opts.compact && abs >= 1000 ? 0 : 2;
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const sign = opts.sign ? (neg ? '−' : '+') : (neg ? '−' : '');
    return sign + symbol + s;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function monthLabel(key, short) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: short ? 'short' : 'long', year: 'numeric' });
  }
  function addMonths(key, n) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function daysInMonth(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }
  function dayLabel(key, now) {
    now = now || Date.now();
    const today = dayKey(now);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (key === today) return 'Today';
    if (key === dayKey(y.getTime())) return 'Yesterday';
    const [yy, mm, dd] = key.split('-').map(Number);
    const d = new Date(yy, mm - 1, dd);
    const sameYear = yy === new Date(now).getFullYear();
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  }
  // "YYYY-MM-DD" + "HH:MM" (local) <-> timestamp
  function toLocalInputs(ts) { const d = new Date(ts); return { date: dayKey(ts), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) }; }
  function fromLocalInputs(date, time) {
    const [y, m, d] = String(date).split('-').map(Number);
    const [hh, mi] = String(time || '00:00').split(':').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mi || 0, 0, 0);
    return dt.getTime();
  }

  function totals(entries, startingCents) {
    let spent = 0, added = 0;
    for (const e of entries) { if (e.type === 'income') added += e.amount; else spent += e.amount; }
    return { spent, added, balance: (startingCents || 0) + added - spent };
  }

  function filterEntries(entries, f, custom) {
    f = f || {};
    const q = (f.query || '').trim().toLowerCase();
    return entries.filter(e => {
      if (f.month && f.month !== 'all' && monthKey(e.ts) !== f.month) return false;
      if (f.category && f.category !== 'all' && e.category !== f.category) return false;
      if (f.type && f.type !== 'all' && e.type !== f.type) return false;
      if (q) {
        const cat = findCategory(e.category, custom).name.toLowerCase();
        const hay = ((e.note || '') + ' ' + cat + ' ' + (e.amount / 100).toFixed(2)).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortNewest(entries) { return entries.slice().sort((a, b) => b.ts - a.ts || (b.created || 0) - (a.created || 0)); }

  function groupByDay(entries) {
    const groups = [];
    const map = new Map();
    for (const e of sortNewest(entries)) {
      const k = dayKey(e.ts);
      let g = map.get(k);
      if (!g) { g = { key: k, items: [], spent: 0, added: 0 }; map.set(k, g); groups.push(g); }
      g.items.push(e);
      if (e.type === 'income') g.added += e.amount; else g.spent += e.amount;
    }
    return groups;
  }

  function monthSummary(entries, month, custom) {
    const inMonth = entries.filter(e => monthKey(e.ts) === month);
    const byCat = new Map();
    let spent = 0, added = 0;
    const daily = new Array(daysInMonth(month)).fill(0);
    for (const e of inMonth) {
      if (e.type === 'income') { added += e.amount; continue; }
      spent += e.amount;
      byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount);
      daily[new Date(e.ts).getDate() - 1] += e.amount;
    }
    const cats = [...byCat.entries()].map(([id, amt]) => {
      const c = findCategory(id, custom);
      return { id, name: c.name, icon: c.icon, color: c.color, amount: amt, pct: spent ? amt / spent : 0 };
    }).sort((a, b) => b.amount - a.amount);
    const count = inMonth.filter(e => e.type !== 'income').length;
    return { month, spent, added, net: added - spent, cats, daily, count };
  }

  function monthsWithData(entries, now) {
    const s = new Set(entries.map(e => monthKey(e.ts)));
    s.add(monthKey(now || Date.now()));
    return [...s].sort().reverse();
  }

  function validateEntry(e) {
    const errs = [];
    if (!e || typeof e !== 'object') return ['not an object'];
    if (e.type !== 'expense' && e.type !== 'income') errs.push('type');
    if (!Number.isInteger(e.amount) || e.amount <= 0) errs.push('amount');
    if (typeof e.ts !== 'number' || !isFinite(e.ts)) errs.push('ts');
    if (!e.id || typeof e.id !== 'string') errs.push('id');
    return errs;
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function slug(name) {
    return 'c-' + String(name).toLowerCase().trim().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  }

  const api = { EXPENSE_CATS, INCOME_CATS, PALETTE, allCategories, findCategory, toCents, fmtMoney, dayKey, monthKey, monthLabel,
    addMonths, daysInMonth, dayLabel, toLocalInputs, fromLocalInputs, totals, filterEntries, sortNewest, groupByDay,
    monthSummary, monthsWithData, validateEntry, uid, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(typeof self !== 'undefined' ? self : this);
