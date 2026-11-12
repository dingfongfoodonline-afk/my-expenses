/* My Expenses — app UI. Plain JS, no dependencies, no network. */
(function () {
  'use strict';
  const L = window.Logic;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const APP_VERSION = '1.0.0';

  const state = {
    entries: [],
    settings: { start: 0, symbol: '฿', customCats: [] },
    filter: { month: 'all', category: 'all', query: '' },
    view: 'home',
    sumMonth: L.monthKey(Date.now()),
    listLimit: 200
  };
  const thumbURLs = new Map(); // id -> { blob, url }
  let form = null; // add/edit form state

  // ---------- utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(c, o) { return L.fmtMoney(c, state.settings.symbol, o); }
  function cats() { return L.allCategories(state.settings.customCats); }
  function cat(id) { return L.findCategory(id, state.settings.customCats); }
  function tint(hex, a) { return hex + Math.round(a * 255).toString(16).padStart(2, '0'); }
  function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2000);
  }
  function fmtBytes(n) { if (!n && n !== 0) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }

  function thumbURL(e) {
    if (!e.thumb) return null;
    const c = thumbURLs.get(e.id);
    if (c && c.blob === e.thumb) return c.url;
    if (c) URL.revokeObjectURL(c.url);
    const url = URL.createObjectURL(e.thumb);
    thumbURLs.set(e.id, { blob: e.thumb, url });
    return url;
  }
  function dropThumb(id) { const c = thumbURLs.get(id); if (c) { URL.revokeObjectURL(c.url); thumbURLs.delete(id); } }

  // ---------- dialog ----------
  function dialog(o) {
    return new Promise(resolve => {
      const d = $('#dlg');
      $('#dlg-title').textContent = o.title || '';
      $('#dlg-msg').textContent = o.msg || '';
      const extra = $('#dlg-extra'); extra.innerHTML = ''; if (o.extra) extra.appendChild(o.extra);
      const bw = $('#dlg-btns'); bw.innerHTML = '';
      const btns = o.buttons || [{ label: 'OK', value: true, bold: true }];
      bw.classList.toggle('stack', !!o.stack || btns.length > 2);
      btns.forEach(b => {
        const el = document.createElement('button');
        el.textContent = b.label; if (b.bold) el.classList.add('bold'); if (b.danger) el.classList.add('danger');
        el.onclick = () => { d.hidden = true; resolve(typeof b.value === 'function' ? b.value() : b.value); };
        bw.appendChild(el);
      });
      d.hidden = false;
      const inp = extra.querySelector('input'); if (inp) setTimeout(() => inp.focus(), 50);
    });
  }
  function confirmDlg(title, msg, okLabel, danger) {
    return dialog({ title, msg, buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, bold: !danger, danger: !!danger }] });
  }

  // ---------- data ----------
  async function loadAll() {
    const [entries, start, symbol, customCats] = await Promise.all([
      DB.allEntries(), DB.getKV('start', 0), DB.getKV('symbol', '฿'), DB.getKV('customCats', [])
    ]);
    state.entries = entries || [];
    state.settings = { start: start || 0, symbol: symbol || '฿', customCats: customCats || [] };
  }

  // ---------- render: home ----------
  function renderHome() {
    const t = L.totals(state.entries, state.settings.start);
    const bal = $('#bc-balance');
    bal.textContent = money(t.balance);
    bal.classList.toggle('neg', t.balance < 0);
    $('#bc-added').textContent = money(t.added);
    $('#bc-spent').textContent = money(t.spent);
    $('#bc-start').textContent = state.settings.start ? 'Includes starting balance ' + money(state.settings.start) : '';

    // month chips
    const months = L.monthsWithData(state.entries);
    const cur = L.monthKey(Date.now());
    if (state.filter.month !== 'all' && !months.includes(state.filter.month)) months.push(state.filter.month);
    const mc = $('#month-chips');
    mc.innerHTML = [`<button class="chip ${state.filter.month === 'all' ? 'on' : ''}" data-month="all">All time</button>`]
      .concat(months.map(m => `<button class="chip ${state.filter.month === m ? 'on' : ''}" data-month="${m}">${m === cur ? 'This month' : esc(L.monthLabel(m, true))}</button>`)).join('');

    // category chips: only categories that are used + current filter
    const used = new Set(state.entries.map(e => e.category));
    if (state.filter.category !== 'all') used.add(state.filter.category);
    const all = cats(); const ordered = all.expense.concat(all.income).filter(c => used.has(c.id));
    for (const id of used) if (!ordered.find(c => c.id === id)) ordered.push(cat(id));
    const cc = $('#cat-chips');
    cc.hidden = ordered.length < 2 && state.filter.category === 'all';
    cc.innerHTML = [`<button class="chip ${state.filter.category === 'all' ? 'on' : ''}" data-cat="all">All categories</button>`]
      .concat(ordered.map(c => `<button class="chip ${state.filter.category === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${c.icon} ${esc(c.name)}</button>`)).join('');

    const filtered = L.filterEntries(state.entries, state.filter, state.settings.customCats);
    const ft = L.totals(filtered, 0);
    const isFiltered = state.filter.month !== 'all' || state.filter.category !== 'all' || state.filter.query.trim();
    const fb = $('#filterbar');
    if (state.entries.length) {
      fb.hidden = false;
      fb.innerHTML = `<span>${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · spent <b>${money(ft.spent)}</b>${ft.added ? ` · added <b>${money(ft.added)}</b>` : ''}</span>` +
        (isFiltered ? `<button class="clear" id="clear-filters">Clear</button>` : '');
    } else fb.hidden = true;

    const groups = L.groupByDay(filtered);
    let shown = 0; const html = [];
    for (const g of groups) {
      if (shown >= state.listLimit) break;
      const items = g.items.slice(0, state.listLimit - shown); shown += items.length;
      html.push(`<div class="daygroup"><div class="dayhead"><span>${esc(L.dayLabel(g.key))}</span><span class="tot">${g.spent ? '−' + money(g.spent) : ''}${g.added ? `${g.spent ? ' · ' : ''}<span class="in">+${money(g.added)}</span>` : ''}</span></div><div class="items">`);
      for (const e of items) html.push(itemHTML(e));
      html.push('</div></div>');
    }
    if (filtered.length > shown) html.push(`<button class="chip" id="show-more" style="margin:16px auto 0;display:flex">Show more (${filtered.length - shown})</button>`);
    $('#list').innerHTML = html.join('');
    const empty = $('#empty');
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
      empty.querySelector('h2').textContent = state.entries.length ? 'Nothing matches' : 'No entries yet';
      empty.querySelector('p').innerHTML = state.entries.length ? 'Try another month, category or search.' : 'Tap <b>+</b> to log your first expense or add money.';
    }
  }
  function itemHTML(e) {
    const c = cat(e.category);
    const d = new Date(e.ts);
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const url = thumbURL(e);
    const ico = url
      ? `<div class="ico"><img src="${url}" alt="" loading="lazy"><span class="badge">${c.icon}</span></div>`
      : `<div class="ico" style="background:${tint(c.color, .18)}">${c.icon}</div>`;
    const title = e.note ? esc(e.note.split('\n')[0]) : esc(c.name);
    const sub = [time, e.note ? esc(c.name) : null, e.photo ? '📷' : null].filter(Boolean).join(' · ');
    const amt = e.type === 'income' ? `<div class="it-amt in">+${money(e.amount)}</div>` : `<div class="it-amt">−${money(e.amount)}</div>`;
    return `<button class="item" data-id="${esc(e.id)}">${ico}<div class="it-main"><div class="it-title">${title}</div><div class="it-sub">${sub}</div></div>${amt}</button>`;
  }

  // ---------- render: summary ----------
  function renderSummary() {
    const m = state.sumMonth;
    const s = L.monthSummary(state.entries, m, state.settings.customCats);
    $('#sum-month').textContent = L.monthLabel(m);
    $('#sum-spent').textContent = money(s.spent, { compact: true });
    $('#sum-added').textContent = money(s.added, { compact: true });
    const net = $('#sum-net'); net.textContent = money(s.net, { compact: true, sign: s.net !== 0 });
    net.style.color = s.net < 0 ? 'var(--red)' : s.net > 0 ? 'var(--green)' : '';
    $('#sum-next').disabled = m >= L.monthKey(Date.now());
    $('#sum-next').style.opacity = $('#sum-next').disabled ? .35 : 1;

    // donut
    const R = 80, C = 2 * Math.PI * R, SW = 26;
    let svg = `<svg viewBox="0 0 220 220" role="img" aria-label="Spending by category"><circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--fill)" stroke-width="${SW}"/>`;
    if (s.spent > 0) {
      let off = 0; const gap = s.cats.length > 1 ? 2 : 0;
      for (const c of s.cats) {
        const len = c.pct * C;
        const vis = Math.max(len - gap, 0.5);
        svg += `<circle class="donut-seg" cx="110" cy="110" r="${R}" fill="none" stroke="${c.color}" stroke-width="${SW}" stroke-dasharray="${vis.toFixed(2)} ${(C - vis).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 110 110)"><title>${esc(c.name)} ${Math.round(c.pct * 100)}%</title></circle>`;
        off += len;
      }
    }
    svg += `<text x="110" y="102" text-anchor="middle" class="donut-c1">Spent</text><text x="110" y="128" text-anchor="middle" class="donut-c2">${esc(money(s.spent, { compact: true }))}</text></svg>`;
    $('#donut').innerHTML = svg;
    $('#catlist').innerHTML = s.cats.length ? s.cats.map(c => `
      <button class="catrow btn" data-cat="${esc(c.id)}"><div class="ico" style="background:${tint(c.color, .18)}">${c.icon}</div>
      <div class="nm">${esc(c.name)}</div><div class="am">${money(c.amount)}</div>
      <div class="bar"><i style="width:${(c.pct * 100).toFixed(1)}%;background:${c.color}"></i></div><div class="pc">${(c.pct * 100).toFixed(c.pct < .1 ? 1 : 0)}%</div></button>`).join('')
      : `<div class="nodata">No spending in ${esc(L.monthLabel(m))}</div>`;

    // daily bars
    const n = s.daily.length, W = 320, H = 160, top = 14, bottom = 22, left = 4;
    const max = Math.max(...s.daily, 0);
    const bw = (W - left * 2) / n;
    const today = L.monthKey(Date.now()) === m ? new Date().getDate() : -1;
    let d = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily spending">`;
    if (max > 0) {
      d += `<line class="dgrid" x1="0" x2="${W}" y1="${top}" y2="${top}"/><text class="daxis" x="${W - 2}" y="${top - 4}" text-anchor="end">${esc(money(max, { compact: true }))}</text>`;
      s.daily.forEach((v, i) => {
        if (!v) return;
        const h = Math.max(2, (v / max) * (H - top - bottom));
        d += `<rect class="dbar ${i + 1 === today ? 'today' : ''}" x="${(left + i * bw + bw * .15).toFixed(2)}" y="${(H - bottom - h).toFixed(2)}" width="${(bw * .7).toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(3, bw * .3).toFixed(1)}"><title>${i + 1}: ${esc(money(v))}</title></rect>`;
      });
    }
    d += `<line class="dgrid" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" style="stroke-dasharray:none"/>`;
    [1, 5, 10, 15, 20, 25, n].forEach(day => { d += `<text class="daxis" x="${(left + (day - .5) * bw).toFixed(1)}" y="${H - 6}" text-anchor="middle">${day}</text>`; });
    d += '</svg>';
    $('#daily').innerHTML = max > 0 ? d : `<div class="nodata">No spending yet</div>`;
    const daysElapsed = today > 0 ? today : n;
    $('#sum-avg').textContent = s.spent ? 'avg ' + money(Math.round(s.spent / daysElapsed)) + '/day' : '';
  }

  // ---------- render: settings ----------
  function renderSettings() {
    const si = $('#set-start'); if (document.activeElement !== si) si.value = state.settings.start ? (state.settings.start / 100).toFixed(2) : '';
    const sy = $('#set-symbol'); if (document.activeElement !== sy) sy.value = state.settings.symbol;
    const cc = state.settings.customCats;
    $('#custom-cats').innerHTML = cc.length ? cc.map(c => `<div class="row catedit"><div class="ico" style="background:${tint(c.color, .18)}">${c.icon}</div><div class="grow">${esc(c.name)} <span class="tag">${c.type === 'income' ? 'Income' : 'Expense'}</span></div><button class="x" data-delcat="${esc(c.id)}">Delete</button></div>`).join('')
      : `<div class="row"><span class="row-r">No custom categories yet</span></div>`;
    $('#custom-cats').hidden = false;
    $('#st-count').textContent = state.entries.length;
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $('#st-used').textContent = fmtBytes(e.usage); }).catch(() => {});
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { $('#st-persist').textContent = p ? 'On ✓' : 'Not granted'; }).catch(() => { $('#st-persist').textContent = 'Unknown'; });
    else $('#st-persist').textContent = 'Not supported';
    $('#ver').textContent = 'My Expenses ' + APP_VERSION + ' · data stored on this device only';
  }

  function render() {
    if (state.view === 'home') renderHome();
    else if (state.view === 'summary') renderSummary();
    else renderSettings();
  }

  function setView(v) {
    state.view = v;
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    render();
    window.scrollTo(0, 0);
  }

  // ---------- photos ----------
  function loadImg(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { res({ img, url }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that image')); };
      img.src = url;
    });
  }
  function canvasBlob(cv, q) { return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('Image encode failed'))), 'image/jpeg', q)); }
  async function processPhoto(file, max, thumbSize) {
    max = max || 1600; thumbSize = thumbSize || 192;
    const { img, url } = await loadImg(file);
    try {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('Empty image');
      const s = Math.min(1, max / Math.max(w, h));
      const cw = Math.round(w * s), ch = Math.round(h * s);
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
      cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, cw, ch);
      const photo = await canvasBlob(cv, 0.82);
      const t = document.createElement('canvas'); t.width = t.height = thumbSize;
      const tx = t.getContext('2d'); const side = Math.min(w, h);
      tx.imageSmoothingQuality = 'high';
      tx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, thumbSize, thumbSize);
      const thumb = await canvasBlob(t, 0.75);
      cv.width = cv.height = t.width = t.height = 0; // free memory on iOS
      return { photo, thumb, width: cw, height: ch };
    } finally { URL.revokeObjectURL(url); }
  }
  let viewerURL = null;
  function openViewer(blob) {
    if (!blob) return;
    if (viewerURL) URL.revokeObjectURL(viewerURL);
    viewerURL = URL.createObjectURL(blob);
    $('#viewer-img').src = viewerURL;
    const v = $('#viewer'); v.hidden = false; requestAnimationFrame(() => v.classList.add('show'));
  }
  function closeViewer() {
    const v = $('#viewer'); v.classList.remove('show');
    setTimeout(() => { v.hidden = true; $('#viewer-img').removeAttribute('src'); if (viewerURL) { URL.revokeObjectURL(viewerURL); viewerURL = null; } }, 200);
  }

  // ---------- add / edit sheet ----------
  let formPhotoURL = null;
  function openSheet(entry) {
    const now = Date.now();
    form = {
      editing: entry || null,
      type: entry ? entry.type : 'expense',
      category: entry ? entry.category : null,
      photo: entry ? entry.photo || null : null,
      thumb: entry ? entry.thumb || null : null
    };
    $('#sheet-title').textContent = entry ? 'Edit Entry' : 'New Entry';
    $('#f-amount').value = entry ? (entry.amount / 100).toFixed(2).replace(/\.00$/, '') : '';
    const li = L.toLocalInputs(entry ? entry.ts : now);
    $('#f-date').value = li.date; $('#f-time').value = li.time;
    $('#f-note').value = entry ? entry.note || '' : '';
    $('#f-err').hidden = true;
    $('#f-delete').hidden = !entry;
    $('#f-meta').textContent = entry ? 'Created ' + new Date(entry.created || entry.ts).toLocaleString('en-GB') + (entry.updated && entry.updated !== entry.created ? ' · Edited ' + new Date(entry.updated).toLocaleString('en-GB') : '') : '';
    $('#amount-sym').textContent = state.settings.symbol;
    setType(form.type, true);
    renderPhoto();
    const sh = $('#sheet'), sc = $('#scrim');
    sh.hidden = false; sc.hidden = false; sh.style.transform = '';
    $('.sheet-body', sh).scrollTop = 0;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { sh.classList.add('show'); sc.classList.add('show'); });
    if (!entry) $('#f-amount').focus({ preventScroll: true });
  }
  function closeSheet() {
    const sh = $('#sheet'), sc = $('#scrim');
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    sh.classList.remove('show'); sc.classList.remove('show'); sh.style.transform = '';
    document.body.style.overflow = '';
    setTimeout(() => { if (!sh.classList.contains('show')) { sh.hidden = true; sc.hidden = true; } }, 340);
    if (formPhotoURL) { URL.revokeObjectURL(formPhotoURL); formPhotoURL = null; }
    form = null;
  }
  function setType(type, initial) {
    form.type = type;
    $('#seg-type').classList.toggle('income', type === 'income');
    $$('#seg-type button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
    $('#sheet').classList.toggle('income', type === 'income');
    const list = cats()[type];
    if (!form.category || !list.find(c => c.id === form.category)) {
      if (!(initial && form.editing)) form.category = list[0].id;
    }
    renderCatGrid();
  }
  function renderCatGrid() {
    const list = cats()[form.type].slice();
    if (form.category && !list.find(c => c.id === form.category)) list.push(cat(form.category));
    $('#f-cats').innerHTML = list.map(c => `<button type="button" class="catbtn ${c.id === form.category ? 'on' : ''}" data-cat="${esc(c.id)}"><span class="e">${c.icon}</span><span class="n">${esc(c.name)}</span></button>`).join('') +
      `<button type="button" class="catbtn add" id="f-newcat"><span class="e">＋</span><span class="n">New</span></button>`;
  }
  function renderPhoto() {
    if (formPhotoURL) { URL.revokeObjectURL(formPhotoURL); formPhotoURL = null; }
    const has = !!(form && form.photo);
    $('#photo-add').hidden = has; $('#photo-prev').hidden = !has;
    if (has) { formPhotoURL = URL.createObjectURL(form.photo); $('#photo-img').src = formPhotoURL; } else $('#photo-img').removeAttribute('src');
  }
  async function saveForm() {
    if (!form) return;
    const err = $('#f-err');
    const amount = L.toCents($('#f-amount').value);
    if (!isFinite(amount) || amount <= 0) { err.textContent = 'Enter an amount greater than 0'; err.hidden = false; $('#f-amount').focus(); haptic(); return; }
    if (amount > 1e13) { err.textContent = 'That amount looks too large'; err.hidden = false; return; }
    const date = $('#f-date').value, time = $('#f-time').value;
    if (!date) { err.textContent = 'Pick a date'; err.hidden = false; return; }
    const ts = L.fromLocalInputs(date, time || '00:00');
    const now = Date.now();
    const base = form.editing || { id: L.uid(), created: now };
    const entry = Object.assign({}, base, {
      type: form.type, amount, category: form.category, ts,
      note: $('#f-note').value.trim(), photo: form.photo || null, thumb: form.thumb || null, updated: now
    });
    const btn = $('#sheet-save'); btn.disabled = true;
    try {
      await DB.putEntry(entry);
      const i = state.entries.findIndex(e => e.id === entry.id);
      if (i >= 0) state.entries[i] = entry; else state.entries.push(entry);
      dropThumb(entry.id);
      const wasEdit = !!form.editing;
      closeSheet();
      haptic();
      toast(wasEdit ? 'Saved' : (entry.type === 'income' ? 'Money added' : 'Expense logged'));
      if (!wasEdit) requestPersist();
      render();
    } catch (e) {
      console.error(e);
      err.textContent = 'Could not save: ' + (e && e.message || e); err.hidden = false;
    } finally { btn.disabled = false; }
  }
  async function deleteCurrent() {
    if (!form || !form.editing) return;
    const e = form.editing;
    const ok = await confirmDlg('Delete this entry?', `${e.type === 'income' ? '+' : '−'}${money(e.amount)} · ${cat(e.category).name}\nThis can't be undone.`, 'Delete', true);
    if (!ok) return;
    await DB.deleteEntry(e.id);
    state.entries = state.entries.filter(x => x.id !== e.id);
    dropThumb(e.id);
    closeSheet(); toast('Deleted'); render();
  }

  // sheet drag-to-dismiss
  function enableSheetDrag() {
    const sh = $('#sheet'); const handle = [$('.grabber', sh), $('.sheet-head', sh)];
    let y0 = null, dy = 0;
    handle.forEach(h => {
      h.addEventListener('touchstart', ev => { if (ev.target.closest('button')) return; y0 = ev.touches[0].clientY; dy = 0; sh.style.transition = 'none'; }, { passive: true });
    });
    window.addEventListener('touchmove', ev => { if (y0 == null) return; dy = Math.max(0, ev.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
    window.addEventListener('touchend', () => {
      if (y0 == null) return; y0 = null; sh.style.transition = '';
      if (dy > 120) closeSheet(); else sh.style.transform = '';
    });
  }

  // ---------- custom categories ----------
  const EMOJIS = ['☕', '🍺', '🛒', '⛽', '🏠', '👶', '🐶', '✈️', '🎁', '📚', '💇', '🏋️', '📱', '🚗', '🧾', '🎓', '🍰', '🧴', '🏥', '💸', '🏦', '🎮', '🙏', '🌱'];
  async function addCategoryDialog(defaultType) {
    const box = document.createElement('div');
    let type = defaultType || 'expense', emoji = EMOJIS[0];
    box.innerHTML = `<input class="dlg-input" maxlength="24" placeholder="Category name">
      <div class="typepick"><button type="button" data-t="expense">Expense</button><button type="button" data-t="income">Income</button></div>
      <div class="emoji-pick">${EMOJIS.map((e, i) => `<button type="button" class="${i ? '' : 'on'}" data-e="${e}">${e}</button>`).join('')}</div>`;
    const syncType = () => $$('.typepick button', box).forEach(b => b.classList.toggle('on', b.dataset.t === type));
    syncType();
    box.addEventListener('click', ev => {
      const t = ev.target.closest('[data-t]'); if (t) { type = t.dataset.t; syncType(); }
      const e = ev.target.closest('[data-e]'); if (e) { emoji = e.dataset.e; $$('.emoji-pick button', box).forEach(b => b.classList.toggle('on', b === e)); }
    });
    const ok = await dialog({ title: 'New category', msg: 'Pick a name and an icon.', extra: box, buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, bold: true }] });
    const name = $('input', box).value.trim();
    if (!ok || !name) return null;
    const all = cats(); const exist = all[type].find(c => c.name.toLowerCase() === name.toLowerCase());
    if (exist) { toast('That category already exists'); return exist; }
    const used = state.settings.customCats.length;
    const c = { id: L.slug(name), name, icon: emoji, color: L.PALETTE[used % L.PALETTE.length], type };
    state.settings.customCats = state.settings.customCats.concat([c]);
    await DB.setKV('customCats', state.settings.customCats);
    toast('Category added');
    return c;
  }
  async function deleteCategory(id) {
    const c = state.settings.customCats.find(x => x.id === id); if (!c) return;
    const n = state.entries.filter(e => e.category === id).length;
    const fallback = c.type === 'income' ? 'other-in' : 'other';
    const ok = await confirmDlg(`Delete “${c.name}”?`, n ? `${n} ${n === 1 ? 'entry' : 'entries'} will move to “${cat(fallback).name}”.` : 'No entries use it.', 'Delete', true);
    if (!ok) return;
    const moved = state.entries.filter(e => e.category === id).map(e => Object.assign({}, e, { category: fallback, updated: Date.now() }));
    if (moved.length) await DB.putEntries(moved);
    state.entries = state.entries.map(e => moved.find(m => m.id === e.id) || e);
    state.settings.customCats = state.settings.customCats.filter(x => x.id !== id);
    await DB.setKV('customCats', state.settings.customCats);
    if (state.filter.category === id) state.filter.category = 'all';
    render();
  }

  // ---------- backup ----------
  function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
  function dataURLToBlob(u) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u || ''); if (!m) throw new Error('Bad image data');
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'image/jpeg' });
  }
  async function buildBackup() {
    const entries = [];
    for (const e of L.sortNewest(state.entries)) {
      const o = Object.assign({}, e);
      o.photo = e.photo ? await blobToDataURL(e.photo) : null;
      o.thumb = e.thumb ? await blobToDataURL(e.thumb) : null;
      entries.push(o);
    }
    return { app: 'my-expenses', format: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      settings: { start: state.settings.start, symbol: state.settings.symbol, customCats: state.settings.customCats }, entries };
  }
  async function exportBackup() {
    toast('Preparing backup…');
    const data = await buildBackup();
    const d = new Date(); const stamp = L.dayKey(d.getTime()) + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const name = `my-expenses-backup-${stamp}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = (typeof File === 'function') ? new File([blob], name, { type: 'application/json' }) : null;
    const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    const download = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    };
    const choice = await dialog({ title: 'Backup ready', msg: `${data.entries.length} entries · ${fmtBytes(blob.size)}\nSave it to Files or iCloud Drive.`,
      buttons: (canShare ? [{ label: 'Share / Save to Files', value: 'share', bold: true }] : []).concat([{ label: 'Download', value: 'dl', bold: !canShare }, { label: 'Cancel', value: null }]) });
    if (choice === 'share') {
      try { await navigator.share({ files: [file], title: name }); await DB.setKV('lastBackup', Date.now()); }
      catch (e) { if (e && e.name !== 'AbortError') { download(); } }
    } else if (choice === 'dl') { download(); await DB.setKV('lastBackup', Date.now()); }
  }
  function parseBackup(text) {
    let data; try { data = JSON.parse(text); } catch (_) { throw new Error('This file is not valid JSON.'); }
    if (!data || data.app !== 'my-expenses' || !Array.isArray(data.entries)) throw new Error('This is not a My Expenses backup file.');
    const entries = []; let bad = 0;
    for (const raw of data.entries) {
      const e = { id: String(raw.id || ''), type: raw.type, amount: Number(raw.amount), category: String(raw.category || (raw.type === 'income' ? 'other-in' : 'other')),
        ts: Number(raw.ts), note: String(raw.note || ''), created: Number(raw.created) || Number(raw.ts), updated: Number(raw.updated) || Number(raw.ts), photo: null, thumb: null };
      if (L.validateEntry(e).length) { bad++; continue; }
      try { if (raw.photo) e.photo = dataURLToBlob(raw.photo); if (raw.thumb) e.thumb = dataURLToBlob(raw.thumb); } catch (_) { e.photo = e.photo || null; }
      entries.push(e);
    }
    const s = data.settings || {};
    return { entries, bad, settings: { start: Number.isInteger(s.start) ? s.start : 0, symbol: typeof s.symbol === 'string' && s.symbol ? s.symbol.slice(0, 4) : '฿', customCats: Array.isArray(s.customCats) ? s.customCats.filter(c => c && c.id && c.name) : [] }, exportedAt: data.exportedAt };
  }
  async function importBackup(file) {
    let parsed;
    try { parsed = parseBackup(await file.text()); } catch (e) { await dialog({ title: 'Can’t restore', msg: e.message }); return; }
    // regenerate missing thumbnails
    for (const e of parsed.entries) if (e.photo && !e.thumb) { try { e.thumb = (await processPhoto(e.photo, 1600, 192)).thumb; } catch (_) {} }
    const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('en-GB') : 'unknown date';
    const mode = await dialog({ title: 'Restore backup?', msg: `${parsed.entries.length} entries from ${when}.${parsed.bad ? `\n${parsed.bad} invalid entries will be skipped.` : ''}\n\nMerge keeps your current entries. Replace erases them first.`,
      buttons: [{ label: 'Merge', value: 'merge', bold: true }, { label: 'Replace everything', value: 'replace', danger: true }, { label: 'Cancel', value: null }] });
    if (!mode) return;
    if (mode === 'replace') {
      if (!(await confirmDlg('Replace all data?', `Your current ${state.entries.length} entries will be erased.`, 'Replace', true))) return;
      await DB.clearEntries();
      thumbURLs.forEach(v => URL.revokeObjectURL(v.url)); thumbURLs.clear();
      state.settings = parsed.settings;
    } else if (!state.entries.length && !state.settings.start && !state.settings.customCats.length) {
      state.settings = parsed.settings; // fresh device: adopt the backup's settings too
    } else {
      const ids = new Set(state.settings.customCats.map(c => c.id));
      state.settings.customCats = state.settings.customCats.concat(parsed.settings.customCats.filter(c => !ids.has(c.id)));
    }
    await DB.putEntries(parsed.entries);
    await Promise.all([DB.setKV('start', state.settings.start), DB.setKV('symbol', state.settings.symbol), DB.setKV('customCats', state.settings.customCats)]);
    await loadAll();
    thumbURLs.forEach(v => URL.revokeObjectURL(v.url)); thumbURLs.clear();
    toast(`Restored ${parsed.entries.length} entries`);
    requestPersist();
    render();
  }

  // ---------- storage persistence ----------
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!already) await navigator.storage.persist();
      }
    } catch (_) {}
  }

  // ---------- events ----------
  function bind() {
    $('#tabbar').addEventListener('click', ev => { const t = ev.target.closest('.tab'); if (t) setView(t.dataset.view); });
    $('#fab').addEventListener('click', () => openSheet(null));
    $('#btn-search-toggle').addEventListener('click', () => {
      const w = $('#searchwrap'); w.hidden = !w.hidden;
      if (!w.hidden) $('#search').focus(); else if (state.filter.query) { state.filter.query = ''; $('#search').value = ''; renderHome(); }
    });
    let st; $('#search').addEventListener('input', ev => { clearTimeout(st); st = setTimeout(() => { state.filter.query = ev.target.value; state.listLimit = 200; renderHome(); }, 120); });
    $('#month-chips').addEventListener('click', ev => { const c = ev.target.closest('[data-month]'); if (!c) return; state.filter.month = c.dataset.month; state.listLimit = 200; renderHome(); });
    $('#cat-chips').addEventListener('click', ev => { const c = ev.target.closest('[data-cat]'); if (!c) return; state.filter.category = c.dataset.cat; state.listLimit = 200; renderHome(); });
    $('#view-home').addEventListener('click', ev => {
      if (ev.target.closest('#clear-filters')) { state.filter = { month: 'all', category: 'all', query: '' }; $('#search').value = ''; $('#searchwrap').hidden = true; renderHome(); return; }
      if (ev.target.closest('#show-more')) { state.listLimit += 200; renderHome(); return; }
      const it = ev.target.closest('.item'); if (!it) return;
      const e = state.entries.find(x => x.id === it.dataset.id); if (e) openSheet(e);
    });
    // summary
    $('#sum-prev').addEventListener('click', () => { state.sumMonth = L.addMonths(state.sumMonth, -1); renderSummary(); });
    $('#sum-next').addEventListener('click', () => { if (state.sumMonth < L.monthKey(Date.now())) { state.sumMonth = L.addMonths(state.sumMonth, 1); renderSummary(); } });
    $('#catlist').addEventListener('click', ev => { const r = ev.target.closest('[data-cat]'); if (!r) return; state.filter = { month: state.sumMonth, category: r.dataset.cat, query: '' }; setView('home'); });
    // sheet
    $('#sheet-cancel').addEventListener('click', closeSheet);
    $('#scrim').addEventListener('click', closeSheet);
    $('#sheet-save').addEventListener('click', saveForm);
    $('#form').addEventListener('submit', ev => { ev.preventDefault(); saveForm(); });
    $('#f-amount').addEventListener('input', ev => {
      let v = ev.target.value.replace(/,/g, '').replace(/[^\d.]/g, '');
      const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
      if (v !== ev.target.value) ev.target.value = v;
      $('#f-err').hidden = true;
    });
    $('#f-amount').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.target.blur(); } });
    $('#seg-type').addEventListener('click', ev => { const b = ev.target.closest('[data-type]'); if (b && form) { setType(b.dataset.type); haptic(); } });
    $('#f-cats').addEventListener('click', async ev => {
      if (!form) return;
      if (ev.target.closest('#f-newcat')) { const c = await addCategoryDialog(form.type); if (c && form) { if (c.type !== form.type) setType(c.type === 'income' ? 'income' : 'expense'); form.category = c.id; renderCatGrid(); } return; }
      const b = ev.target.closest('[data-cat]'); if (!b) return;
      form.category = b.dataset.cat; renderCatGrid(); haptic();
    });
    $('#f-now').addEventListener('click', () => { const li = L.toLocalInputs(Date.now()); $('#f-date').value = li.date; $('#f-time').value = li.time; });
    $('#f-photo').addEventListener('change', async ev => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f || !form) return;
      const add = $('#photo-add span'); const old = add.textContent; add.textContent = 'Processing…';
      try { const p = await processPhoto(f); if (form) { form.photo = p.photo; form.thumb = p.thumb; renderPhoto(); toast('Photo attached · ' + fmtBytes(p.photo.size)); } }
      catch (e) { dialog({ title: 'Photo problem', msg: (e && e.message) || 'Could not use that photo.' }); }
      finally { add.textContent = old; }
    });
    $('#photo-remove').addEventListener('click', () => { if (form) { form.photo = null; form.thumb = null; renderPhoto(); } });
    $('#photo-view').addEventListener('click', () => { if (form && form.photo) openViewer(form.photo); });
    $('#photo-img').addEventListener('click', () => { if (form && form.photo) openViewer(form.photo); });
    $('#f-delete').addEventListener('click', deleteCurrent);
    $('#viewer').addEventListener('click', closeViewer);
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if (!$('#viewer').hidden) closeViewer(); else if (form && $('#dlg').hidden) closeSheet();
    });
    // settings
    $('#set-start').addEventListener('change', async ev => {
      const raw = ev.target.value.trim(); const v = raw === '' ? 0 : L.toCents(raw);
      if (!isFinite(v)) { toast('Invalid amount'); renderSettings(); return; }
      state.settings.start = v; await DB.setKV('start', v); toast('Starting balance saved'); renderSettings();
    });
    $('#set-symbol').addEventListener('change', async ev => {
      const v = ev.target.value.trim() || '฿'; state.settings.symbol = v; await DB.setKV('symbol', v); toast('Saved'); renderSettings();
    });
    $('#btn-add-cat').addEventListener('click', async () => { await addCategoryDialog('expense'); renderSettings(); });
    $('#custom-cats').addEventListener('click', ev => { const b = ev.target.closest('[data-delcat]'); if (b) deleteCategory(b.dataset.delcat); });
    $('#btn-export').addEventListener('click', () => exportBackup().catch(e => dialog({ title: 'Export failed', msg: String(e && e.message || e) })));
    $('#import-file').addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) importBackup(f).catch(e => dialog({ title: 'Restore failed', msg: String(e && e.message || e) })); });
    $('#btn-wipe').addEventListener('click', async () => {
      if (!(await confirmDlg('Erase all data?', 'Every entry, photo and setting on this device will be deleted. Export a backup first if you might need it.', 'Erase', true))) return;
      if (!(await confirmDlg('Are you sure?', 'This cannot be undone.', 'Erase everything', true))) return;
      await DB.clearAll(); thumbURLs.forEach(v => URL.revokeObjectURL(v.url)); thumbURLs.clear();
      await loadAll(); state.filter = { month: 'all', category: 'all', query: '' }; toast('All data erased'); render();
    });
    // install hint
    $('#installhint-x').addEventListener('click', () => { $('#installhint').hidden = true; DB.setKV('hintDismissed', true); });
    enableSheetDrag();
    // refresh "Today"/"This month" labels when returning to the app
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  }

  async function maybeShowInstallHint() {
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (iOS && !standalone && !(await DB.getKV('hintDismissed', false))) $('#installhint').hidden = false;
  }

  async function init() {
    bind();
    try { await loadAll(); }
    catch (e) { console.error(e); await dialog({ title: 'Storage unavailable', msg: 'This browser blocked local storage (Private Browsing?). Open the app normally in Safari to save entries.\n\n' + (e && e.message || e) }); }
    render();
    requestPersist();
    maybeShowInstallHint().catch(() => {});
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
    }
  }

  // exposed for automated tests only
  window.__app = { state, processPhoto, parseBackup, buildBackup, importBackup, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
