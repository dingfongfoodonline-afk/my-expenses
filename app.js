/* My Expenses — app UI. Plain JS, no dependencies, no network. */
(function () {
  'use strict';
  const L = window.Logic;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const APP_VERSION = '1.1.0';

  const state = {
    entries: [],
    settings: { start: 0, symbol: '฿', customCats: [] },
    filter: { month: 'all', category: 'all', query: '' },
    view: 'home',
    sumMonth: L.monthKey(Date.now()),
    listLimit: 200,
    ml: { bank: 0, bankUpdated: null, groups: [], items: [], snaps: [] }
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
    const [mlBank, mlGroups, mlItems, mlSnaps] = await Promise.all([DB.getKV('mlBank', null), DB.getKV('mlGroups', []), DB.allML(), DB.allSnaps()]);
    state.ml = { bank: mlBank ? mlBank.amount || 0 : 0, bankUpdated: mlBank ? mlBank.updated || null : null, groups: mlGroups || [], items: mlItems || [], snaps: mlSnaps || [] };
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
    $('#st-mlcount').textContent = state.ml.items.length + (state.ml.snaps.length ? ' · ' + state.ml.snaps.length + ' snapshots' : '');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $('#st-used').textContent = fmtBytes(e.usage); }).catch(() => {});
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { $('#st-persist').textContent = p ? 'On ✓' : 'Not granted'; }).catch(() => { $('#st-persist').textContent = 'Unknown'; });
    else $('#st-persist').textContent = 'Not supported';
    $('#ver').textContent = 'My Expenses ' + APP_VERSION + ' · data stored on this device only';
  }

  function render() {
    if (state.view === 'home') renderHome();
    else if (state.view === 'summary') renderSummary();
    else if (state.view === 'moneyleft') renderMoneyLeft();
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
    showSheetEl($('#sheet'));
    if (!entry) $('#f-amount').focus({ preventScroll: true });
  }
  function closeSheet() {
    hideSheetEl($('#sheet'));
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
  function enableSheetDrag(sh, close) {
    const handle = [$('.grabber', sh), $('.sheet-head', sh)];
    let y0 = null, dy = 0;
    handle.forEach(h => {
      h.addEventListener('touchstart', ev => { if (ev.target.closest('button')) return; y0 = ev.touches[0].clientY; dy = 0; sh.style.transition = 'none'; }, { passive: true });
    });
    window.addEventListener('touchmove', ev => { if (y0 == null) return; dy = Math.max(0, ev.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
    window.addEventListener('touchend', () => {
      if (y0 == null) return; y0 = null; sh.style.transition = '';
      if (dy > 120) close(); else sh.style.transform = '';
    });
  }

  // ---------- generic sheet helpers ----------
  function showSheetEl(sh) {
    const sc = $('#scrim');
    sh.hidden = false; sc.hidden = false; sh.style.transform = '';
    $('.sheet-body', sh).scrollTop = 0;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { sh.classList.add('show'); sc.classList.add('show'); });
  }
  function hideSheetEl(sh) {
    const sc = $('#scrim');
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    sh.classList.remove('show'); sc.classList.remove('show'); sh.style.transform = '';
    document.body.style.overflow = '';
    setTimeout(() => { if (!sh.classList.contains('show')) { sh.hidden = true; if (!$$('.sheet.show').length) sc.hidden = true; } }, 340);
  }

  // ---------- Money Left · เงินคงเหลือ ----------
  let mlform = null; let mlPhotoURL = null;
  function mlm(c, o) { return money(c, Object.assign({ auto: true }, o || {})); }
  function fmtStamp(ts) {
    const d = new Date(ts); const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function mlGroupsSorted() { return L.sortGroups(state.ml.groups); }
  function mlGroupName(id) { const g = state.ml.groups.find(x => x.id === id); return g ? g.name : 'Other'; }
  async function mlSaveGroups() {
    state.ml.groups = L.sortGroups(state.ml.groups).map((g, i) => Object.assign({}, g, { order: i }));
    await DB.setKV('mlGroups', state.ml.groups);
  }
  async function mlSetBank(cents, ts) {
    state.ml.bank = cents; state.ml.bankUpdated = ts || Date.now();
    await DB.setKV('mlBank', { amount: state.ml.bank, updated: state.ml.bankUpdated });
  }
  async function mlPutItem(it) {
    await DB.putML(it);
    const i = state.ml.items.findIndex(x => x.id === it.id);
    if (i >= 0) state.ml.items[i] = it; else state.ml.items.push(it);
    dropThumb(it.id);
  }
  function mlItemHTML(it, rec) {
    const url = thumbURL(it);
    const ico = url ? `<div class="ico"><img src="${url}" alt="" loading="lazy"></div>` : '';
    const sub = rec ? [esc(mlGroupName(it.groupId)), it.receivedAt ? 'received ' + esc(fmtStamp(it.receivedAt)) : null, it.addedToBank ? 'added to bank' : null].filter(Boolean).join(' · ')
      : [it.note ? esc(it.note.split('\n')[0]) : null, it.photo ? '📷' : null].filter(Boolean).join(' · ');
    return `<div class="mlitem ${rec ? 'rec' : ''}">
      <button class="mlcheck ${rec ? 'done' : ''}" data-${rec ? 'unrecv' : 'recv'}="${esc(it.id)}" aria-label="${rec ? 'Move back to pending' : 'Mark received'}"><i></i></button>
      <button class="mlbody" data-mlitem="${esc(it.id)}">${ico}<div class="it-main"><div class="it-title"><span class="t">${esc(it.name)}</span>${it.tag ? `<span class="tagpill">${esc(it.tag)}</span>` : ''}</div>${sub ? `<div class="it-sub">${sub}</div>` : ''}</div>
      <div class="it-amt">${mlm(it.amount)}</div></button></div>`;
  }
  function renderMoneyLeft() {
    const ml = state.ml;
    const t = L.mlTotals(ml.bank, ml.groups, ml.items);
    $('#ml-total').textContent = mlm(t.total);
    $('#ml-bank').textContent = mlm(t.bank);
    $('#ml-bank-upd').textContent = ml.bankUpdated ? 'Updated ' + fmtStamp(ml.bankUpdated) : 'Tap to set · แตะเพื่อใส่ยอด';
    $('#ml-pending').textContent = mlm(t.pending);
    const pc = ml.items.filter(i => i.status !== 'received').length;
    $('#ml-pending-n').textContent = pc + (pc === 1 ? ' item' : ' items') + ' · ' + t.groups.filter(g => g.pendingCount).length + ' groups';

    const pend = L.sortItems(ml.items.filter(i => i.status !== 'received'));
    const known = new Set(ml.groups.map(g => g.id));
    const html = [];
    for (const g of t.groups) {
      const its = pend.filter(i => (g.id == null ? !known.has(i.groupId) : i.groupId === g.id));
      if (g.id == null && !its.length) continue;
      html.push(`<div class="mlgroup"><div class="mlg-head"><div class="mlg-name">${esc(g.name)}</div><div class="mlg-right"><span class="mlg-sub">${mlm(g.pending)}</span>${g.id ? `<button class="mlg-more" data-gmore="${esc(g.id)}" aria-label="Group options">•••</button>` : ''}</div></div><div class="items">`);
      for (const it of its) html.push(mlItemHTML(it, false));
      html.push(`<button class="mladd" data-additem="${esc(g.id || '')}">＋ Add item · เพิ่มรายการ</button></div></div>`);
    }
    $('#ml-groups').innerHTML = html.join('');
    $('#ml-empty').hidden = !!(ml.groups.length || ml.items.length || ml.bankUpdated);

    const rec = ml.items.filter(i => i.status === 'received').sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
    $('#ml-rec-h').hidden = $('#ml-received').hidden = !rec.length;
    $('#ml-received').innerHTML = rec.slice(0, 100).map(it => mlItemHTML(it, true)).join('');

    const snaps = ml.snaps.slice().sort((a, b) => b.ts - a.ts);
    $('#ml-snap-h').hidden = $('#ml-snaps').hidden = !snaps.length;
    $('#ml-snaps').innerHTML = snaps.map((s, i) => {
      const prev = snaps[i + 1]; const dlt = prev ? s.total - prev.total : 0;
      return `<button class="snaprow" data-snap="${esc(s.id)}"><div class="it-main"><div class="it-title">${esc(fmtStamp(s.ts))}</div><div class="it-sub">Bank ${mlm(s.bank)} · Pending ${mlm(s.pending)}</div></div>
        <div style="text-align:right"><div class="it-amt">${mlm(s.total)}</div>${prev && dlt ? `<div class="delta ${dlt > 0 ? 'up' : 'down'}">${mlm(dlt, { sign: true })}</div>` : ''}</div></button>`;
    }).join('');
  }
  function amountInput(val) {
    const box = document.createElement('div');
    box.innerHTML = `<input class="dlg-input dlg-amount" inputmode="decimal" placeholder="0" value="${val}">`;
    const inp = $('input', box);
    inp.addEventListener('input', () => { let v = inp.value.replace(/,/g, '').replace(/[^\d.]/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2); if (v !== inp.value) inp.value = v; });
    return { box, inp };
  }
  async function editBank() {
    const { box, inp } = amountInput(state.ml.bankUpdated || state.ml.bank ? (state.ml.bank / 100).toFixed(2).replace(/\.00$/, '') : '');
    const sub = document.createElement('div'); sub.className = 'dlg-sub';
    sub.textContent = state.ml.bankUpdated ? 'Last updated ' + fmtStamp(state.ml.bankUpdated) : 'The stamp is set to now when you save.';
    box.appendChild(sub);
    const ok = await dialog({ title: 'Bank balance · เงินในธนาคาร', msg: 'Your current balance in the bank.', extra: box, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, bold: true }] });
    if (!ok) return;
    const v = inp.value.trim() === '' ? 0 : L.toCents(inp.value);
    if (!isFinite(v)) { toast('Invalid amount'); return; }
    await mlSetBank(v); toast('Bank balance updated'); renderMoneyLeft();
  }
  async function groupNameDialog(title, current) {
    const box = document.createElement('div');
    box.innerHTML = `<input class="dlg-input" maxlength="40" placeholder="e.g. Savings Acc, เงินเดือน 11/2026">`;
    $('input', box).value = current || '';
    const ok = await dialog({ title, extra: box, buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, bold: true }] });
    const name = $('input', box).value.trim();
    return ok && name ? name : null;
  }
  async function addGroup() {
    const name = await groupNameDialog('New group · กลุ่มใหม่');
    if (!name) return null;
    const g = { id: 'g-' + L.uid(), name, order: state.ml.groups.length };
    state.ml.groups = state.ml.groups.concat([g]); await mlSaveGroups(); renderMoneyLeft();
    return g;
  }
  async function groupMenu(id) {
    const gs = mlGroupsSorted(); const idx = gs.findIndex(g => g.id === id); const g = gs[idx]; if (!g) return;
    const n = state.ml.items.filter(i => i.groupId === id).length;
    const btns = [{ label: 'Add item · เพิ่มรายการ', value: 'add', bold: true }, { label: 'Rename · เปลี่ยนชื่อ', value: 'rename' }];
    if (idx > 0) btns.push({ label: 'Move up ↑', value: 'up' });
    if (idx < gs.length - 1) btns.push({ label: 'Move down ↓', value: 'down' });
    btns.push({ label: 'Delete group · ลบกลุ่ม', value: 'delete', danger: true }, { label: 'Cancel', value: null });
    const a = await dialog({ title: g.name, msg: `${n} ${n === 1 ? 'item' : 'items'}`, buttons: btns, stack: true });
    if (a === 'add') openMLSheet(null, id);
    else if (a === 'rename') { const name = await groupNameDialog('Rename group', g.name); if (name) { g.name = name; state.ml.groups = state.ml.groups.map(x => (x.id === id ? Object.assign({}, x, { name }) : x)); await mlSaveGroups(); renderMoneyLeft(); } }
    else if (a === 'up' || a === 'down') {
      const j = a === 'up' ? idx - 1 : idx + 1; const order = gs.map(x => x.id); [order[idx], order[j]] = [order[j], order[idx]];
      state.ml.groups = gs.map(x => Object.assign({}, x, { order: order.indexOf(x.id) })); await mlSaveGroups(); renderMoneyLeft();
    } else if (a === 'delete') {
      if (!(await confirmDlg(`Delete “${g.name}”?`, n ? `Its ${n} ${n === 1 ? 'item' : 'items'} (pending and received) will be deleted too.` : 'The group is empty.', 'Delete', true))) return;
      const ids = state.ml.items.filter(i => i.groupId === id).map(i => i.id);
      for (const iid of ids) { await DB.deleteML(iid); dropThumb(iid); }
      state.ml.items = state.ml.items.filter(i => i.groupId !== id);
      state.ml.groups = state.ml.groups.filter(x => x.id !== id); await mlSaveGroups(); toast('Group deleted'); renderMoneyLeft();
    }
  }
  async function markReceived(it) {
    const a = await dialog({ title: 'Mark as received? · ได้รับแล้ว', msg: `${it.name} · ${mlm(it.amount)}\n\nAdd it to your bank balance so the total stays the same?`,
      buttons: [{ label: `Received + add ${mlm(it.amount)} to bank`, value: 'bank', bold: true }, { label: 'Received only', value: 'only' }, { label: 'Cancel', value: null }] });
    if (!a) return;
    const now = Date.now();
    const upd = Object.assign({}, it, { status: 'received', receivedAt: now, addedToBank: a === 'bank', updated: now });
    if (a === 'bank') await mlSetBank(state.ml.bank + it.amount, now);
    await mlPutItem(upd); haptic();
    toast(a === 'bank' ? 'Received · added to bank' : 'Marked received'); renderMoneyLeft();
  }
  async function markPending(it) {
    const btns = [];
    if (it.addedToBank) btns.push({ label: `Pending + subtract ${mlm(it.amount)} from bank`, value: 'bank', bold: true });
    btns.push({ label: 'Back to pending', value: 'only', bold: !it.addedToBank }, { label: 'Cancel', value: null });
    const a = await dialog({ title: 'Move back to pending?', msg: `${it.name} · ${mlm(it.amount)}`, buttons: btns, stack: true });
    if (!a) return;
    const now = Date.now();
    if (a === 'bank') await mlSetBank(state.ml.bank - it.amount, now);
    await mlPutItem(Object.assign({}, it, { status: 'pending', receivedAt: null, addedToBank: false, updated: now }));
    toast('Moved to pending'); renderMoneyLeft();
  }
  function mlCurrentText(ts) { return L.mlText(state.ml.bank, state.ml.groups, state.ml.items, ts == null ? Date.now() : ts); }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok;
    }
  }
  async function showTextDialog(title, text, extraBtns) {
    const pre = document.createElement('div'); pre.className = 'dlg-pre'; pre.id = 'ml-text-preview'; pre.textContent = text;
    const btns = [{ label: 'Copy · คัดลอก', value: 'copy', bold: true }];
    if (navigator.share) btns.push({ label: 'Share…', value: 'share' });
    const a = await dialog({ title, extra: pre, buttons: btns.concat(extraBtns || []).concat([{ label: 'Close', value: null }]), stack: true });
    if (a === 'copy') toast((await copyText(text)) ? 'Copied · วางใน Notes หรือ LINE ได้เลย' : 'Copy failed — select the text and copy');
    else if (a === 'share') { try { await navigator.share({ text }); } catch (_) {} }
    return a;
  }
  async function saveSnapshot() {
    const now = Date.now(); const t = L.mlTotals(state.ml.bank, state.ml.groups, state.ml.items);
    const snap = { id: 's-' + L.uid(), ts: now, bank: t.bank, pending: t.pending, total: t.total,
      groups: t.groups.filter(g => g.pendingCount).map(g => ({ name: g.name, pending: g.pending })), text: mlCurrentText(now) };
    await DB.putSnap(snap); state.ml.snaps.push(snap); haptic(); toast('Snapshot saved · ' + mlm(t.total)); renderMoneyLeft();
  }
  async function openSnapshot(id) {
    const s = state.ml.snaps.find(x => x.id === id); if (!s) return;
    const a = await showTextDialog('Snapshot · ' + fmtStamp(s.ts), s.text || '', [{ label: 'Delete snapshot', value: 'del', danger: true }]);
    if (a === 'del' && (await confirmDlg('Delete this snapshot?', fmtStamp(s.ts) + ' · ' + mlm(s.total), 'Delete', true))) {
      await DB.deleteSnap(id); state.ml.snaps = state.ml.snaps.filter(x => x.id !== id); renderMoneyLeft();
    }
  }
  // item sheet
  function openMLSheet(item, groupId) {
    mlform = { editing: item || null, status: item ? item.status || 'pending' : 'pending', groupId: item ? item.groupId : (groupId || (mlGroupsSorted()[0] || {}).id || null),
      photo: item ? item.photo || null : null, thumb: item ? item.thumb || null : null };
    $('#ml-sheet-title').textContent = item ? 'Edit Item' : 'New Item';
    $('#ml-amount').value = item ? (item.amount / 100).toFixed(2).replace(/\.00$/, '') : '';
    $('#ml-name').value = item ? item.name : '';
    $('#ml-tag').value = item ? item.tag || '' : '';
    $('#ml-note').value = item ? item.note || '' : '';
    $('#ml-err').hidden = true; $('#ml-delete').hidden = !item;
    $('#ml-meta').textContent = item ? 'Added ' + fmtStamp(item.created || Date.now()) + (item.receivedAt ? ' · Received ' + fmtStamp(item.receivedAt) : '') : '';
    $('.ml-sym').textContent = state.settings.symbol;
    mlSetStatus(mlform.status); mlRenderGroupChips(); mlRenderTagChips(); mlRenderPhoto();
    showSheetEl($('#mlsheet'));
    if (!item) $('#ml-amount').focus({ preventScroll: true });
  }
  function closeMLSheet() {
    hideSheetEl($('#mlsheet'));
    if (mlPhotoURL) { URL.revokeObjectURL(mlPhotoURL); mlPhotoURL = null; }
    mlform = null;
  }
  function mlSetStatus(s) {
    mlform.status = s;
    $('#ml-seg').classList.toggle('income', s === 'received');
    $$('#ml-seg button').forEach(b => b.classList.toggle('on', b.dataset.status === s));
    $('#mlsheet').classList.toggle('mlrec', s === 'received');
  }
  function mlRenderGroupChips() {
    $('#ml-groupchips').innerHTML = mlGroupsSorted().map(g => `<button type="button" class="chip ${g.id === mlform.groupId ? 'on' : ''}" data-g="${esc(g.id)}">${esc(g.name)}</button>`).join('') +
      `<button type="button" class="chip" data-g="__new">＋ New group</button>`;
  }
  function mlRenderTagChips() {
    const tags = new Set(['etax']); state.ml.items.forEach(i => i.tag && tags.add(i.tag));
    const cur = $('#ml-tag').value.trim();
    $('#ml-tagchips').innerHTML = [...tags].map(t => `<button type="button" class="chip ${t === cur ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  }
  function mlRenderPhoto() {
    if (mlPhotoURL) { URL.revokeObjectURL(mlPhotoURL); mlPhotoURL = null; }
    const has = !!(mlform && mlform.photo);
    $('#ml-photo-add').hidden = has; $('#ml-photo-prev').hidden = !has;
    if (has) { mlPhotoURL = URL.createObjectURL(mlform.photo); $('#ml-photo-img').src = mlPhotoURL; } else $('#ml-photo-img').removeAttribute('src');
  }
  async function saveMLForm() {
    if (!mlform) return;
    const err = $('#ml-err'); const show = m => { err.textContent = m; err.hidden = false; haptic(); };
    const amount = L.toCents($('#ml-amount').value);
    if (!isFinite(amount) || amount <= 0) { show('Enter an amount greater than 0'); $('#ml-amount').focus(); return; }
    const name = $('#ml-name').value.trim();
    if (!name) { show('Enter a name · ใส่ชื่อรายการ'); $('#ml-name').focus(); return; }
    let groupId = mlform.groupId;
    if (!groupId || !state.ml.groups.find(g => g.id === groupId)) {
      let g = state.ml.groups.find(x => x.name === 'Other');
      if (!g) { g = { id: 'g-' + L.uid(), name: 'Other', order: state.ml.groups.length }; state.ml.groups = state.ml.groups.concat([g]); await mlSaveGroups(); }
      groupId = g.id;
    }
    const now = Date.now(); const prev = mlform.editing;
    const sameGroup = state.ml.items.filter(i => i.groupId === groupId);
    const base = prev || { id: 'i-' + L.uid(), created: now, order: sameGroup.length ? Math.max(...sameGroup.map(i => i.order || 0)) + 1 : 0 };
    const it = Object.assign({}, base, { name, amount, groupId, tag: $('#ml-tag').value.trim(), note: $('#ml-note').value.trim(), status: mlform.status,
      photo: mlform.photo || null, thumb: mlform.thumb || null, updated: now });
    const wasRec = prev && prev.status === 'received';
    if (it.status === 'received' && !wasRec) { it.receivedAt = now; it.addedToBank = false; }
    if (it.status !== 'received') { it.receivedAt = null; }
    const btn = $('#ml-save'); btn.disabled = true;
    try {
      // keep the bank consistent when status changes inside the sheet
      if (it.status === 'received' && !wasRec) {
        const add = await confirmDlg('Add to bank balance?', `${name} · ${mlm(amount)} received.\nAdd it to เงินในธนาคาร so the total stays the same?`, 'Add to bank');
        if (add) { await mlSetBank(state.ml.bank + amount, now); it.addedToBank = true; }
      } else if (wasRec && it.status !== 'received' && prev.addedToBank) {
        const sub = await confirmDlg('Subtract from bank?', `${name} was added to the bank when received. Subtract ${mlm(prev.amount)} again?`, 'Subtract');
        if (sub) await mlSetBank(state.ml.bank - prev.amount, now);
        it.addedToBank = false;
      }
      await mlPutItem(it);
      closeMLSheet(); haptic(); toast(prev ? 'Saved' : 'Item added'); requestPersist(); renderMoneyLeft();
    } catch (e) { console.error(e); show('Could not save: ' + (e && e.message || e)); }
    finally { btn.disabled = false; }
  }
  async function deleteMLItem() {
    if (!mlform || !mlform.editing) return; const it = mlform.editing;
    if (!(await confirmDlg('Delete this item?', `${it.name} · ${mlm(it.amount)}\nThis can't be undone.`, 'Delete', true))) return;
    await DB.deleteML(it.id); state.ml.items = state.ml.items.filter(x => x.id !== it.id); dropThumb(it.id);
    closeMLSheet(); toast('Deleted'); renderMoneyLeft();
  }
  function bindMoneyLeft() {
    $('#ml-bank-btn').addEventListener('click', editBank);
    $('#ml-snap').addEventListener('click', saveSnapshot);
    const doCopy = () => showTextDialog('Copy as text · คัดลอก', mlCurrentText());
    $('#ml-copy').addEventListener('click', doCopy); $('#ml-copy-top').addEventListener('click', doCopy);
    $('#ml-addgroup').addEventListener('click', addGroup);
    $('#view-moneyleft').addEventListener('click', ev => {
      const t = ev.target;
      let b;
      if ((b = t.closest('[data-recv]'))) { const it = state.ml.items.find(i => i.id === b.dataset.recv); if (it) markReceived(it); return; }
      if ((b = t.closest('[data-unrecv]'))) { const it = state.ml.items.find(i => i.id === b.dataset.unrecv); if (it) markPending(it); return; }
      if ((b = t.closest('[data-mlitem]'))) { const it = state.ml.items.find(i => i.id === b.dataset.mlitem); if (it) openMLSheet(it); return; }
      if ((b = t.closest('[data-additem]'))) { openMLSheet(null, b.dataset.additem || null); return; }
      if ((b = t.closest('[data-gmore]'))) { groupMenu(b.dataset.gmore); return; }
      if ((b = t.closest('[data-snap]'))) { openSnapshot(b.dataset.snap); return; }
    });
    $('#ml-cancel').addEventListener('click', closeMLSheet);
    $('#ml-save').addEventListener('click', saveMLForm);
    $('#mlform').addEventListener('submit', ev => { ev.preventDefault(); saveMLForm(); });
    $('#ml-amount').addEventListener('input', ev => {
      let v = ev.target.value.replace(/,/g, '').replace(/[^\d.]/g, '');
      const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
      if (v !== ev.target.value) ev.target.value = v; $('#ml-err').hidden = true;
    });
    $('#ml-seg').addEventListener('click', ev => { const b = ev.target.closest('[data-status]'); if (b && mlform) { mlSetStatus(b.dataset.status); haptic(); } });
    $('#ml-groupchips').addEventListener('click', async ev => {
      const b = ev.target.closest('[data-g]'); if (!b || !mlform) return;
      if (b.dataset.g === '__new') { const g = await addGroup(); if (g && mlform) { mlform.groupId = g.id; } }
      else mlform.groupId = b.dataset.g;
      if (mlform) mlRenderGroupChips();
    });
    $('#ml-tagchips').addEventListener('click', ev => { const b = ev.target.closest('[data-tag]'); if (!b) return; const inp = $('#ml-tag'); inp.value = inp.value.trim() === b.dataset.tag ? '' : b.dataset.tag; mlRenderTagChips(); });
    $('#ml-tag').addEventListener('input', mlRenderTagChips);
    $('#ml-photo').addEventListener('change', async ev => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f || !mlform) return;
      const add = $('#ml-photo-add span'); const old = add.textContent; add.textContent = 'Processing…';
      try { const p = await processPhoto(f); if (mlform) { mlform.photo = p.photo; mlform.thumb = p.thumb; mlRenderPhoto(); toast('Photo attached · ' + fmtBytes(p.photo.size)); } }
      catch (e) { dialog({ title: 'Photo problem', msg: (e && e.message) || 'Could not use that photo.' }); }
      finally { add.textContent = old; }
    });
    $('#ml-photo-remove').addEventListener('click', () => { if (mlform) { mlform.photo = null; mlform.thumb = null; mlRenderPhoto(); } });
    $('#ml-photo-view').addEventListener('click', () => { if (mlform && mlform.photo) openViewer(mlform.photo); });
    $('#ml-photo-img').addEventListener('click', () => { if (mlform && mlform.photo) openViewer(mlform.photo); });
    $('#ml-delete').addEventListener('click', deleteMLItem);
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
    const items = [];
    for (const it of L.sortItems(state.ml.items)) {
      const o = Object.assign({}, it);
      o.photo = it.photo ? await blobToDataURL(it.photo) : null;
      o.thumb = it.thumb ? await blobToDataURL(it.thumb) : null;
      items.push(o);
    }
    return { app: 'my-expenses', format: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      settings: { start: state.settings.start, symbol: state.settings.symbol, customCats: state.settings.customCats }, entries,
      moneyLeft: { bank: state.ml.bank, bankUpdated: state.ml.bankUpdated, groups: L.sortGroups(state.ml.groups), items, snapshots: state.ml.snaps.slice().sort((a, b) => a.ts - b.ts) } };
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
    const choice = await dialog({ title: 'Backup ready', msg: `${data.entries.length} entries · ${data.moneyLeft.items.length} Money Left items · ${fmtBytes(blob.size)}\nSave it to Files or iCloud Drive.`,
      buttons: (canShare ? [{ label: 'Share / Save to Files', value: 'share', bold: true }] : []).concat([{ label: 'Download', value: 'dl', bold: !canShare }, { label: 'Cancel', value: null }]) });
    if (choice === 'share') {
      try { await navigator.share({ files: [file], title: name }); await DB.setKV('lastBackup', Date.now()); }
      catch (e) { if (e && e.name !== 'AbortError') { download(); } }
    } else if (choice === 'dl') { download(); await DB.setKV('lastBackup', Date.now()); }
  }
  function parseMoneyLeft(m) {
    if (!m || typeof m !== 'object') return null;
    const groups = (Array.isArray(m.groups) ? m.groups : []).filter(g => g && g.id && g.name).map((g, i) => ({ id: String(g.id), name: String(g.name).slice(0, 60), order: Number.isFinite(+g.order) ? +g.order : i }));
    const items = []; let bad = 0;
    for (const r of Array.isArray(m.items) ? m.items : []) {
      const it = { id: String(r.id || ''), groupId: r.groupId == null ? null : String(r.groupId), name: String(r.name || '').trim(), amount: Number(r.amount), tag: String(r.tag || ''), note: String(r.note || ''),
        status: r.status === 'received' ? 'received' : 'pending', receivedAt: Number(r.receivedAt) || null, addedToBank: !!r.addedToBank,
        order: Number(r.order) || 0, created: Number(r.created) || Date.now(), updated: Number(r.updated) || Number(r.created) || Date.now(), photo: null, thumb: null };
      if (!it.id || !it.name || !Number.isInteger(it.amount) || it.amount <= 0) { bad++; continue; }
      try { if (r.photo) it.photo = dataURLToBlob(r.photo); if (r.thumb) it.thumb = dataURLToBlob(r.thumb); } catch (_) {}
      items.push(it);
    }
    const snaps = (Array.isArray(m.snapshots) ? m.snapshots : []).filter(x => x && x.id && Number.isFinite(+x.ts)).map(x => ({ id: String(x.id), ts: +x.ts, bank: Number(x.bank) || 0, pending: Number(x.pending) || 0, total: Number(x.total) || 0,
      groups: Array.isArray(x.groups) ? x.groups : [], text: String(x.text || '') }));
    return { bank: Number.isInteger(m.bank) ? m.bank : 0, bankUpdated: Number(m.bankUpdated) || null, groups, items, snaps, bad };
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
    const ml = parseMoneyLeft(data.moneyLeft);
    const partial = Array.isArray(data.partial) ? data.partial : null;
    return { entries, bad, ml, mlOnly: !!(partial && partial.length === 1 && partial[0] === 'moneyLeft'),
      settings: { start: Number.isInteger(s.start) ? s.start : 0, symbol: typeof s.symbol === 'string' && s.symbol ? s.symbol.slice(0, 4) : '฿', customCats: Array.isArray(s.customCats) ? s.customCats.filter(c => c && c.id && c.name) : [] }, exportedAt: data.exportedAt };
  }
  async function applyMoneyLeft(ml, replace) {
    if (!ml) return;
    for (const it of ml.items) if (it.photo && !it.thumb) { try { it.thumb = (await processPhoto(it.photo, 1600, 192)).thumb; } catch (_) {} }
    if (replace) {
      await DB.clearML();
      await DB.setKV('mlBank', ml.bankUpdated || ml.bank ? { amount: ml.bank, updated: ml.bankUpdated } : null);
      await DB.setKV('mlGroups', ml.groups);
    } else {
      const cur = state.ml;
      if (ml.bankUpdated && (!cur.bankUpdated || ml.bankUpdated > cur.bankUpdated)) await DB.setKV('mlBank', { amount: ml.bank, updated: ml.bankUpdated });
      const ids = new Set(cur.groups.map(g => g.id)); const base = cur.groups.length;
      await DB.setKV('mlGroups', cur.groups.concat(ml.groups.filter(g => !ids.has(g.id)).map((g, i) => Object.assign({}, g, { order: base + i }))));
    }
    await DB.putMLs(ml.items); await DB.putSnaps(ml.snaps);
  }
  async function importBackup(file) {
    let parsed;
    try { parsed = parseBackup(await file.text()); } catch (e) { await dialog({ title: 'Can’t restore', msg: e.message }); return; }
    for (const e of parsed.entries) if (e.photo && !e.thumb) { try { e.thumb = (await processPhoto(e.photo, 1600, 192)).thumb; } catch (_) {} }
    const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('en-GB') : 'unknown date';
    const mlDesc = parsed.ml ? `Money Left: bank ${money(parsed.ml.bank, { auto: true })}, ${parsed.ml.groups.length} groups, ${parsed.ml.items.length} items, ${parsed.ml.snaps.length} snapshots.` : '';
    const resetThumbs = () => { thumbURLs.forEach(v => URL.revokeObjectURL(v.url)); thumbURLs.clear(); };

    if (parsed.mlOnly) {
      if (!parsed.ml) { await dialog({ title: 'Can’t restore', msg: 'This file has no Money Left data.' }); return; }
      const mode = await dialog({ title: 'Restore Money Left?', msg: `${mlDesc}\nFrom ${when}. Your expense entries are not touched.\n\nMerge keeps your current Money Left data. Replace erases it first.`,
        buttons: [{ label: 'Merge', value: 'merge', bold: true }, { label: 'Replace Money Left', value: 'replace', danger: true }, { label: 'Cancel', value: null }] });
      if (!mode) return;
      if (mode === 'replace' && (state.ml.items.length || state.ml.groups.length || state.ml.bankUpdated) &&
        !(await confirmDlg('Replace Money Left?', `Your current bank balance, ${state.ml.groups.length} groups, ${state.ml.items.length} items and ${state.ml.snaps.length} snapshots will be erased.`, 'Replace', true))) return;
      await applyMoneyLeft(parsed.ml, mode === 'replace');
      await loadAll(); resetThumbs(); toast('Money Left restored'); requestPersist(); render(); return;
    }

    const mode = await dialog({ title: 'Restore backup?', msg: `${parsed.entries.length} entries from ${when}.${parsed.bad ? `\n${parsed.bad} invalid entries will be skipped.` : ''}${mlDesc ? '\n' + mlDesc : ''}\n\nMerge keeps your current data. Replace erases it first.`,
      buttons: [{ label: 'Merge', value: 'merge', bold: true }, { label: 'Replace everything', value: 'replace', danger: true }, { label: 'Cancel', value: null }] });
    if (!mode) return;
    if (mode === 'replace') {
      if (!(await confirmDlg('Replace all data?', `Your current ${state.entries.length} entries${parsed.ml ? ' and Money Left data' : ''} will be erased.`, 'Replace', true))) return;
      await DB.clearEntries(); resetThumbs();
      state.settings = parsed.settings;
    } else if (!state.entries.length && !state.settings.start && !state.settings.customCats.length) {
      state.settings = parsed.settings; // fresh device: adopt the backup's settings too
    } else {
      const ids = new Set(state.settings.customCats.map(c => c.id));
      state.settings.customCats = state.settings.customCats.concat(parsed.settings.customCats.filter(c => !ids.has(c.id)));
    }
    await DB.putEntries(parsed.entries);
    await Promise.all([DB.setKV('start', state.settings.start), DB.setKV('symbol', state.settings.symbol), DB.setKV('customCats', state.settings.customCats)]);
    await applyMoneyLeft(parsed.ml, mode === 'replace');
    await loadAll(); resetThumbs();
    toast(`Restored ${parsed.entries.length} entries${parsed.ml ? ' + Money Left' : ''}`);
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
    $('#fab').addEventListener('click', () => { if (state.view === 'moneyleft') openMLSheet(null); else openSheet(null); });
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
    $('#scrim').addEventListener('click', () => { if (mlform) closeMLSheet(); else closeSheet(); });
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
      if (!$('#viewer').hidden) closeViewer(); else if (!$('#dlg').hidden) return; else if (mlform) closeMLSheet(); else if (form) closeSheet();
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
      if (!(await confirmDlg('Erase all data?', 'Every entry, photo, setting and all Money Left data (bank, groups, items, snapshots) on this device will be deleted. Export a backup first if you might need it.', 'Erase', true))) return;
      if (!(await confirmDlg('Are you sure?', 'This cannot be undone.', 'Erase everything', true))) return;
      await DB.clearAll(); thumbURLs.forEach(v => URL.revokeObjectURL(v.url)); thumbURLs.clear();
      await loadAll(); state.filter = { month: 'all', category: 'all', query: '' }; toast('All data erased'); render();
    });
    // install hint
    $('#installhint-x').addEventListener('click', () => { $('#installhint').hidden = true; DB.setKV('hintDismissed', true); });
    enableSheetDrag($('#sheet'), closeSheet);
    enableSheetDrag($('#mlsheet'), closeMLSheet);
    bindMoneyLeft();
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
  window.__app = { state, processPhoto, parseBackup, buildBackup, importBackup, render, mlCurrentText };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
