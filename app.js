/* My Expenses — app UI. Plain JS, no dependencies, no network. */
(function () {
  'use strict';
  const L = window.Logic;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const APP_VERSION = '1.5.0';

  const state = {
    entries: [],
    settings: { start: 0, symbol: '฿', customCats: [] },
    filter: { month: 'all', category: 'all', query: '' },
    view: 'moneyleft',
    sumMonth: L.monthKey(Date.now()),
    listLimit: 200,
    ml: { bank: 0, bankUpdated: null, accounts: [], groups: [], items: [], snaps: [] }
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

  const revokeLater = url => setTimeout(() => URL.revokeObjectURL(url), 2000); // let the DOM re-render before freeing
  function thumbURL(e) {
    if (!e.thumb) return null;
    const c = thumbURLs.get(e.id);
    if (c && c.blob === e.thumb) return c.url;
    if (c) revokeLater(c.url);
    const url = URL.createObjectURL(e.thumb);
    thumbURLs.set(e.id, { blob: e.thumb, url });
    return url;
  }
  function dropThumb(id) { const c = thumbURLs.get(id); if (c) { revokeLater(c.url); thumbURLs.delete(id); } }

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
    const [mlBank, mlAccts, mlGroups, mlItems, mlSnaps] = await Promise.all([DB.getKV('mlBank', null), DB.getKV('mlAccounts', null), DB.getKV('mlGroups', []), DB.allML(), DB.allSnaps()]);
    let items = mlItems || [];
    if ((mlGroups && mlGroups.length) || items.some(i => i.groupId)) { // v1.2.2: groups removed -> flatten into one entry list
      items = L.flattenML(mlGroups || [], items); await DB.putMLs(items); await DB.setKV('mlGroups', []);
    }
    let accounts = L.normAccounts(mlAccts);
    if (!accounts.length) { // v1.4.0: single bank balance -> first account (keeps its timestamp); stored in kv, encrypted like other records
      accounts = [L.legacyAccount(mlBank ? mlBank.amount || 0 : 0, mlBank ? mlBank.updated : null)];
      await DB.setKV('mlAccounts', accounts); if (mlBank) await DB.setKV('mlBank', null);
    }
    state.ml = { bank: 0, bankUpdated: null, accounts, groups: [], items, snaps: mlSnaps || [] }; syncBank();
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
    renderSecurity();
    $('#st-count').textContent = state.entries.length;
    $('#st-count-row').hidden = !state.entries.length; // expense entries are kept (and backed up) but their screens are hidden
    $('#st-mlcount').textContent = state.ml.items.length + (state.ml.snaps.length ? ' · ' + state.ml.snaps.length + ' snapshots' : '');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $('#st-used').textContent = fmtBytes(e.usage); }).catch(() => {});
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { $('#st-persist').textContent = p ? 'On ✓' : 'Not granted'; }).catch(() => { $('#st-persist').textContent = 'Unknown'; });
    else $('#st-persist').textContent = 'Not supported';
    $('#ver').textContent = 'My Money ' + APP_VERSION + ' · data stored on this device only';
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
    $('#fab').hidden = v !== 'moneyleft';
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
  function fmtDate(d) { const [y, m, dd] = String(d).split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function mlm(c, o) { return money(c, Object.assign({ auto: true }, o || {})); }
  function fmtStamp(ts) {
    const d = new Date(ts); const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function syncBank() {
    const ac = state.ml.accounts = L.sortAccounts(state.ml.accounts);
    state.ml.bank = L.acctTotal(ac);
    state.ml.bankUpdated = ac.reduce((m, x) => Math.max(m, x.updated || 0), 0) || null;
  }
  async function saveAccounts() { syncBank(); await DB.setKV('mlAccounts', state.ml.accounts); }
  function primaryAccount() { const ac = state.ml.accounts; return ac.find(x => x.type === 'bank') || ac[0]; }
  // "add to bank" when an entry is received goes to the first Bank account
  async function mlAdjustPrimary(delta, ts) {
    const p = primaryAccount(); if (!p) return;
    p.balance += delta; p.updated = ts || Date.now(); await saveAccounts();
  }
  const ACCT_ICON = { bank: '🏦', cash: '💵' };
  function acctTypeLabel(t) { return t === 'cash' ? 'Cash' : 'Bank'; }
  function acctRowHTML(x) {
    return `<div class="mlitem acct" data-id="${esc(x.id)}" data-peek="">
      <button class="mldel" data-delacct="${esc(x.id)}" aria-label="Delete ${esc(x.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span>Delete · ลบ</span></button>
      <div class="mlslide"><button class="acctbody" data-acct="${esc(x.id)}"><span class="acct-ic">${ACCT_ICON[x.type]}</span><div class="it-main"><div class="it-title"><span class="t">${esc(x.name)}</span></div>
      <div class="it-sub">${acctTypeLabel(x.type)} · ${x.updated ? 'Updated ' + esc(fmtStamp(x.updated)) : 'Tap to set'}</div></div><div class="it-amt">${mlm(x.balance)}</div></button></div></div>`;
  }
  async function mlPutItem(it) {
    await DB.putML(it);
    const i = state.ml.items.findIndex(x => x.id === it.id);
    if (i >= 0) state.ml.items[i] = it; else state.ml.items.push(it);
    dropThumb(it.id);
  }
  function mlItemHTML(it, rec) {
    const url = thumbURL(it);
    const ico = url ? `<div class="ico"><img src="${url}" alt="" loading="lazy" draggable="false"><span class="badge">📷</span></div>` : '';
    const sub = rec ? [it.receivedAt ? 'received ' + esc(fmtStamp(it.receivedAt)) : null, it.addedToBank ? 'added to bank' : null].filter(Boolean).join(' · ')
      : [it.date ? esc(fmtDate(it.date)) : null, it.note ? esc(it.note.split('\n')[0]) : null, it.photo ? '📷' : null].filter(Boolean).join(' · ');
    return `<div class="mlitem ${rec ? 'rec' : ''}" data-id="${esc(it.id)}" data-peek="${it.photo ? esc(it.id) : ''}">
      <button class="mldel" data-del="${esc(it.id)}" aria-label="Delete ${esc(it.name)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span>Delete · ลบ</span></button>
      <div class="mlslide"><button class="mlcheck ${rec ? 'done' : ''}" data-${rec ? 'unrecv' : 'recv'}="${esc(it.id)}" aria-label="${rec ? 'Move back to pending' : 'Mark received'}"><i></i></button>
      <button class="mlbody" data-mlitem="${esc(it.id)}">${ico}<div class="it-main"><div class="it-title"><span class="t">${esc(it.name)}</span>${it.tag ? `<span class="tagpill">${esc(it.tag)}</span>` : ''}</div>${sub ? `<div class="it-sub">${sub}</div>` : ''}</div>
      <div class="it-amt">${mlm(it.amount)}</div></button></div></div>`;
  }
  function renderMoneyLeft() {
    const ml = state.ml;
    const t = L.mlTotals(ml.accounts, ml.items);
    $('#ml-total').textContent = mlm(t.total);
    const ac = ml.accounts, one = ac.length === 1 ? ac[0] : null;
    $('#ml-bank').textContent = mlm(t.bank);
    $('#ml-bank-lbl').textContent = one ? `${ACCT_ICON[one.type]} ${acctTypeLabel(one.type)} · ${one.name}` : '🏦 Accounts · บัญชี';
    $('#ml-bank-upd').textContent = one ? (one.updated ? 'Updated ' + fmtStamp(one.updated) : 'Tap to set · แตะเพื่อใส่ยอด') : `${ac.length} accounts`;
    $('#ml-accts').hidden = !!one;
    $('#ml-accts').innerHTML = one ? '' : ac.map(acctRowHTML).join('') + `<div class="acct-sub"><span>Accounts subtotal · รวมบัญชี</span><b id="ml-acct-sub">${mlm(t.bank)}</b></div>`;
    $('#ml-pending').textContent = mlm(t.pending);
    $('#ml-pending-n').textContent = t.pendingCount + (t.pendingCount === 1 ? ' entry' : ' entries');
    const pend = L.sortItems(ml.items.filter(i => i.status !== 'received'));
    $('#ml-groups').innerHTML = `<div class="flabel">Entries · รายการ</div><div class="items">${pend.map(it => mlItemHTML(it, false)).join('')}<button class="mladd" data-additem="1">＋ Add entry · เพิ่มรายการ</button></div>
      <div class="mltotal"><div><div class="mlt-l">รวม · Total</div><div class="mlt-s">${ac.length === 1 ? esc(ac[0].name) : 'บัญชี'} ${mlm(t.bank)} + รายการ ${mlm(t.pending)}</div></div><div class="mlt-v" id="ml-total-foot">${mlm(t.total)}</div></div>`;
    $('#ml-empty').hidden = !!(ml.items.length || ml.bankUpdated);

    const rec = ml.items.filter(i => i.status === 'received').sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
    $('#ml-rec-h').hidden = $('#ml-received').hidden = !rec.length;
    $('#ml-received').innerHTML = rec.slice(0, 100).map(it => mlItemHTML(it, true)).join('');

    const snaps = ml.snaps.slice().sort((a, b) => b.ts - a.ts);
    $('#ml-snap-h').hidden = $('#ml-snaps').hidden = !snaps.length;
    $('#ml-snaps').innerHTML = snaps.map((s, i) => {
      const prev = snaps[i + 1]; const dlt = prev ? s.total - prev.total : 0;
      return `<button class="snaprow" data-snap="${esc(s.id)}"><div class="it-main"><div class="it-title">${esc(fmtStamp(s.ts))}</div><div class="it-sub">${s.accounts && s.accounts.length > 1 ? 'Accounts' : 'Bank'} ${mlm(s.bank)} · Pending ${mlm(s.pending)}</div></div>
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
  // ---------- KBank SMS balance updates (v1.5.0) ----------
  // ?setbal=1234.56&acct=<name>&src=kbank-sms  or  ?sms=<full SMS text>. Queued until data is unlocked; never applied without confirm.
  let pendingSMS = (() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('setbal') && !q.has('sms')) return null;
    return { setbal: q.get('setbal'), sms: q.get('sms'), acct: q.get('acct') || '', src: q.get('src') || '' };
  })();
  function clearQuery() { try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {} }
  function findAccount(name) { const n = String(name || '').trim().toLowerCase(); return n ? state.ml.accounts.find(x => x.name.trim().toLowerCase() === n) || null : null; }
  async function processPendingSMS() {
    const p = pendingSMS; if (!p) return; pendingSMS = null;
    if (state.view !== 'moneyleft') setView('moneyleft');
    const r = p.setbal != null ? (v => (v == null ? null : { balance: v, time: null }))(L.parseBaht(p.setbal)) : L.parseKBankSMS(p.sms);
    if (!r) { clearQuery(); toast('Couldn’t read a balance from the SMS · ไม่พบยอดเงิน'); return; }
    await confirmBalanceUpdate(r, p.acct, p.src === 'kbank-sms' || p.sms != null ? 'KBank SMS' : 'link');
    clearQuery();
  }
  async function confirmBalanceUpdate(r, acctName, srcLabel) {
    let acct = findAccount(acctName), note = '';
    if (!acct) { acct = primaryAccount(); if (acctName && acct) note = `\n“${acctName}” not found, so ${acct.name} is used.`; }
    if (!acct) return false;
    const ok = await dialog({ title: `Update ${acct.name} to ${mlm(r.balance)}?`,
      msg: `(from ${srcLabel}${r.time ? ' ' + r.time : ''})\nNow ${mlm(acct.balance)}${acct.updated ? ' · updated ' + fmtStamp(acct.updated) : ''}${note}`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Update', value: true, bold: true }] });
    if (!ok) return false;
    const x = state.ml.accounts.find(a => a.id === acct.id); if (!x) return false;
    x.balance = r.balance; x.updated = Date.now(); await saveAccounts(); haptic(); toast(`${x.name} updated · ${mlm(r.balance)}`); renderMoneyLeft();
    return true;
  }
  async function readClipboard() { try { return await navigator.clipboard.readText(); } catch (_) { return null; } }
  async function pasteFromSMS() {
    const t = await readClipboard();
    if (t == null) { toast('Couldn’t read the clipboard. Tap Paste when iOS asks.'); return; }
    const r = L.parseBalanceText(t);
    if (!r) { toast('No balance in clipboard (needs “เหลือ …บ”)'); return; }
    await confirmBalanceUpdate(r, '', 'KBank SMS');
  }
  async function pasteIntoAcctSheet() {
    const t = await readClipboard(); const r = t == null ? null : L.parseBalanceText(t);
    if (!r) { toast(t == null ? 'Couldn’t read the clipboard' : 'No balance in clipboard (needs “เหลือ …บ”)'); return; }
    $('#ac-amount').value = (r.balance / 100).toFixed(2).replace(/\.00$/, ''); toast('Pasted ' + mlm(r.balance) + (r.time ? ' · SMS ' + r.time : '') + '. Tap Save.');
  }
  function appBaseURL() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function smsPrefix(name) { return `${appBaseURL()}?src=kbank-sms&acct=${encodeURIComponent(name)}&setbal=`; }
  async function openSMSHelper() {
    const box = document.createElement('div'); box.className = 'smshelp';
    const ac = state.ml.accounts, def = primaryAccount();
    box.innerHTML = `<label class="dlg-sub">Account · บัญชี</label><select class="dlg-input" id="sms-acct">${ac.map(x => `<option value="${esc(x.id)}"${def && x.id === def.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="dlg-sub">URL template</div><div class="dlg-pre" id="sms-tpl"></div>
      <div class="dlg-sub">Copy this prefix and add the balance number to the end:</div><div class="dlg-pre" id="sms-url"></div>
      <div class="dlg-sub">Recommended on iPhone: the Shortcut copies the SMS, then you tap 📋 Paste KBank SMS on the balance card. The Safari URL only updates the Safari copy of the app, because the home-screen app keeps separate storage. See SHORTCUT.md.</div>`;
    const sel = $('#sms-acct', box);
    const upd = () => { const x = ac.find(a => a.id === sel.value) || def; $('#sms-url', box).textContent = smsPrefix(x.name); $('#sms-tpl', box).textContent = `${appBaseURL()}?setbal=<amount>&acct=${x.name}&src=kbank-sms`; };
    sel.addEventListener('change', upd); upd();
    const a = await dialog({ title: 'SMS auto-update · อัปเดตจาก SMS', msg: 'Update a balance from a KBank SMS (“… เหลือ 12,345.67บ”).', extra: box, stack: true,
      buttons: [{ label: 'Copy URL prefix', value: 'copy', bold: true }, { label: 'Close', value: null }] });
    if (a === 'copy') { const x = ac.find(q => q.id === sel.value) || def; toast((await copyText(smsPrefix(x.name))) ? 'URL prefix copied' : 'Copy failed'); }
  }

  // account sheet
  let acform = null;
  function openAcctSheet(acct) {
    acform = { editing: acct || null, type: acct ? acct.type : 'bank' };
    $('#ac-sheet-title').textContent = acct ? 'Edit Account' : 'New Account';
    $('#ac-amount').value = acct && (acct.updated || acct.balance) ? (acct.balance / 100).toFixed(2).replace(/\.00$/, '') : '';
    $('#ac-name').value = acct ? acct.name : '';
    const canDel = !!acct && state.ml.accounts.length > 1;
    $('#ac-delete-top').hidden = !canDel; $('#ac-err').hidden = true;
    $('#ac-meta').textContent = acct ? (acct.updated ? 'Balance updated ' + fmtStamp(acct.updated) : 'Not set yet') + (state.ml.accounts.length === 1 ? ' · The last account can’t be deleted.' : '') : 'The updated time is set to now when you save.';
    $('.ac-sym').textContent = state.settings.symbol;
    acSetType(acform.type); showSheetEl($('#acctsheet'));
    if (!acct) $('#ac-name').focus({ preventScroll: true });
  }
  function closeAcctSheet() { hideSheetEl($('#acctsheet')); acform = null; }
  function acSetType(t) { if (acform) acform.type = t; $$('#ac-seg button').forEach(b => b.classList.toggle('on', b.dataset.type === t)); $('#ac-seg').classList.toggle('income', t === 'cash'); }
  async function saveAcct() {
    if (!acform) return;
    const raw = $('#ac-amount').value.trim(); const v = raw === '' ? 0 : L.toCents(raw);
    const name = $('#ac-name').value.trim();
    const err = m => { $('#ac-err').textContent = m; $('#ac-err').hidden = false; };
    if (!isFinite(v) || !Number.isInteger(v)) return err('Enter a valid balance.');
    if (!name) return err('Enter a name · ใส่ชื่อบัญชี');
    const now = Date.now(); const ed = acform.editing;
    if (ed) {
      const x = state.ml.accounts.find(a => a.id === ed.id); if (!x) return closeAcctSheet();
      const changed = x.balance !== v || (!x.updated && raw !== '');
      Object.assign(x, { name, type: acform.type, balance: v }); if (changed) x.updated = now;
    } else {
      const order = state.ml.accounts.reduce((m, a) => Math.max(m, a.order || 0), -1) + 1;
      state.ml.accounts.push({ id: 'acct-' + L.uid(), name, type: acform.type, balance: v, updated: now, order, created: now });
    }
    await saveAccounts(); closeAcctSheet(); haptic(); toast(ed ? 'Account saved' : 'Account added · เพิ่มบัญชีแล้ว'); renderMoneyLeft();
  }
  async function deleteAcctById(id) {
    const x = state.ml.accounts.find(a => a.id === id); if (!x) return;
    if (state.ml.accounts.length <= 1) { closeOpenRow(); await dialog({ title: 'Keep one account', msg: 'You need at least one account. Set its balance to 0 instead.' }); return; }
    if (!(await confirmDlg('Delete this account? · ลบบัญชี', `${x.name} · ${mlm(x.balance)}\nIts balance is removed from รวม. This can't be undone.`, 'Delete', true))) { closeOpenRow(); return; }
    state.ml.accounts = state.ml.accounts.filter(a => a.id !== id); await saveAccounts();
    openRow = null; if (acform) closeAcctSheet(); haptic(); toast('Account deleted'); renderMoneyLeft();
  }
  async function markReceived(it) {
    const a = await dialog({ title: 'Mark as received? · ได้รับแล้ว', msg: `${it.name} · ${mlm(it.amount)}\n\nAdd it to ${primaryAccount().name} so the total stays the same?`,
      buttons: [{ label: `Received + add ${mlm(it.amount)} to bank`, value: 'bank', bold: true }, { label: 'Received only', value: 'only' }, { label: 'Cancel', value: null }] });
    if (!a) return;
    const now = Date.now();
    const upd = Object.assign({}, it, { status: 'received', receivedAt: now, addedToBank: a === 'bank', updated: now });
    if (a === 'bank') await mlAdjustPrimary(it.amount, now);
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
    if (a === 'bank') await mlAdjustPrimary(-it.amount, now);
    await mlPutItem(Object.assign({}, it, { status: 'pending', receivedAt: null, addedToBank: false, updated: now }));
    toast('Moved to pending'); renderMoneyLeft();
  }
  function mlCurrentText(ts) { return L.mlText(state.ml.accounts, state.ml.items, ts == null ? Date.now() : ts); }
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
    const now = Date.now(); const t = L.mlTotals(state.ml.accounts, state.ml.items);
    const snap = { id: 's-' + L.uid(), ts: now, bank: t.bank, pending: t.pending, total: t.total, accounts: state.ml.accounts.map(x => ({ name: x.name, type: x.type, balance: x.balance })),
      text: mlCurrentText(now) };
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
  function openMLSheet(item) {
    mlform = { editing: item || null, status: item ? item.status || 'pending' : 'pending', photo: item ? item.photo || null : null, thumb: item ? item.thumb || null : null };
    $('#ml-sheet-title').textContent = item ? 'Edit Item' : 'New Item';
    $('#ml-amount').value = item ? (item.amount / 100).toFixed(2).replace(/\.00$/, '') : '';
    $('#ml-name').value = item ? item.name : '';
    $('#ml-tag').value = item ? item.tag || '' : '';
    $('#ml-note').value = item ? item.note || '' : '';
    $('#ml-date').value = item ? item.date || '' : '';
    $('#ml-err').hidden = true; $('#ml-delete').hidden = !item; $('#ml-delete-top').hidden = !item;
    $('#ml-meta').textContent = item ? 'Added ' + fmtStamp(item.created || Date.now()) + (item.receivedAt ? ' · Received ' + fmtStamp(item.receivedAt) : '') : '';
    $('.ml-sym').textContent = state.settings.symbol;
    mlSetStatus(mlform.status); mlRenderTagChips(); mlRenderPhoto();
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
    const now = Date.now(); const prev = mlform.editing;
    const base = prev || { id: 'i-' + L.uid(), created: now, order: state.ml.items.length ? Math.max(...state.ml.items.map(i => i.order || 0)) + 1 : 0 };
    const it = Object.assign({}, base, { name, amount, groupId: null, date: $('#ml-date').value || '', tag: $('#ml-tag').value.trim(), note: $('#ml-note').value.trim(), status: mlform.status,
      photo: mlform.photo || null, thumb: mlform.thumb || null, updated: now });
    const wasRec = prev && prev.status === 'received';
    if (it.status === 'received' && !wasRec) { it.receivedAt = now; it.addedToBank = false; }
    if (it.status !== 'received') { it.receivedAt = null; }
    const btn = $('#ml-save'); btn.disabled = true;
    try {
      // keep the bank consistent when status changes inside the sheet
      if (it.status === 'received' && !wasRec) {
        const add = await confirmDlg('Add to bank balance?', `${name} · ${mlm(amount)} received.\nAdd it to ${primaryAccount().name} so the total stays the same?`, 'Add to bank');
        if (add) { await mlAdjustPrimary(amount, now); it.addedToBank = true; }
      } else if (wasRec && it.status !== 'received' && prev.addedToBank) {
        const sub = await confirmDlg('Subtract from bank?', `${name} was added to the bank when received. Subtract ${mlm(prev.amount)} again?`, 'Subtract');
        if (sub) await mlAdjustPrimary(-prev.amount, now);
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

  // ---------- long-press photo peek ----------
  let peekURL = null;
  function openPeek(it) {
    if (!it || !it.photo) return;
    if (peekURL) URL.revokeObjectURL(peekURL);
    peekURL = URL.createObjectURL(it.photo);
    $('#peek-img').src = peekURL;
    $('#peek-name').textContent = it.name + (it.tag ? ' · ' + it.tag : '');
    $('#peek-amt').textContent = mlm(it.amount);
    const p = $('#peek'); p.hidden = false; p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
    haptic(); // navigator.vibrate is unsupported on iOS: silently skipped
  }
  function closePeek() {
    const p = $('#peek'); if (p.hidden) return;
    p.classList.remove('show');
    setTimeout(() => { if (!p.classList.contains('show')) { p.hidden = true; $('#peek-img').removeAttribute('src'); if (peekURL) { URL.revokeObjectURL(peekURL); peekURL = null; } } }, 180);
  }
  // row gestures: tap = edit, hold 400ms = photo peek, swipe left = reveal Delete
  const DEL_W = 96;
  let openRow = null;
  function setSlide(row, x, animate) { const s = $('.mlslide', row); if (!s) return; s.style.transition = animate ? '' : 'none'; s.style.transform = x ? `translateX(${x}px)` : ''; row.style.setProperty('--sw', Math.max(0, -x) + 'px'); row.classList.toggle('open', x < 0); }
  function closeOpenRow() { if (openRow) { setSlide(openRow, 0, true); openRow = null; } }
  async function deleteMLById(id) {
    const it = state.ml.items.find(x => x.id === id); if (!it) return;
    if (!(await confirmDlg('Delete this item? · ลบรายการ', `${it.name} · ${mlm(it.amount)}\nThis can't be undone.`, 'Delete', true))) { closeOpenRow(); return; }
    await DB.deleteML(it.id); state.ml.items = state.ml.items.filter(x => x.id !== it.id); dropThumb(it.id);
    openRow = null; haptic(); toast('Deleted · ลบแล้ว'); renderMoneyLeft();
  }
  function bindPeek() {
    const root = $('#view-moneyleft');
    let timer = null, g = null, suppressClick = false, peeking = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const suppress = () => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 400); };
    document.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (ev.target.closest('#dlg, .sheet, #peek, #viewer, #lock')) return;
      const inRoot = root.contains(ev.target);
      const row = inRoot ? ev.target.closest('.mlitem') : null;
      if (openRow && row !== openRow) { closeOpenRow(); if (inRoot) suppress(); g = null; return; } // tap elsewhere just closes the open row
      if (!row || ev.target.closest('.mldel')) { g = null; return; }
      const base = row === openRow ? -DEL_W : 0;
      g = { row, x0: ev.clientX, y0: ev.clientY, base, x: base, mode: null };
      cancel();
      if (row.dataset.peek && !ev.target.closest('.mlcheck') && !base) {
        timer = setTimeout(() => { timer = null; if (!g || g.mode) return; g.mode = 'peek'; peeking = true; suppress(); openPeek(state.ml.items.find(i => i.id === row.dataset.peek)); }, 400);
      }
    });
    window.addEventListener('pointermove', ev => {
      if (!g || g.mode === 'peek') return;
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
      if (!g.mode) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { g.mode = 'swipe'; cancel(); }
        else if (Math.abs(dy) > 10) { g.mode = 'scroll'; cancel(); return; }
        else return;
      }
      if (g.mode === 'swipe') { g.x = Math.max(-DEL_W - 30, Math.min(0, g.base + dx)); setSlide(g.row, g.x, false); }
    }, { passive: true });
    const end = cancelled => {
      cancel(); if (!g) return;
      if (g.mode === 'swipe') {
        const open = g.x < -DEL_W / 2;
        setSlide(g.row, open ? -DEL_W : 0, true); openRow = open ? g.row : null; suppress(); haptic();
      } else if (g.mode === 'peek') { if (!cancelled) closePeek(); peeking = false; }
      else if (!g.mode && g.row === openRow) { closeOpenRow(); suppress(); }
      g = null;
    };
    window.addEventListener('pointerup', () => end(false));
    window.addEventListener('pointercancel', () => end(true)); // peek stays; tap outside closes
    document.addEventListener('click', ev => {
      const d = root.contains(ev.target) && ev.target.closest('[data-del]');
      if (d) { ev.stopPropagation(); ev.preventDefault(); deleteMLById(d.dataset.del); return; }
      const da = root.contains(ev.target) && ev.target.closest('[data-delacct]');
      if (da) { ev.stopPropagation(); ev.preventDefault(); deleteAcctById(da.dataset.delacct); return; }
      if (suppressClick && root.contains(ev.target)) { suppressClick = false; ev.stopPropagation(); ev.preventDefault(); }
    }, true);
    root.addEventListener('contextmenu', ev => { if (ev.target.closest('.mlitem')) ev.preventDefault(); });
    $('#peek').addEventListener('click', closePeek);
  }
  function bindMoneyLeft() {
    bindPeek();
    $('#ml-bank-btn').addEventListener('click', () => { if (state.ml.accounts.length === 1) openAcctSheet(state.ml.accounts[0]); else $('#ml-accts').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    $('#ml-add-acct').addEventListener('click', () => openAcctSheet(null));
    $('#ml-paste-sms').addEventListener('click', pasteFromSMS);
    $('#ac-paste').addEventListener('click', pasteIntoAcctSheet);
    $('#btn-sms').addEventListener('click', openSMSHelper);
    $('#ac-cancel').addEventListener('click', closeAcctSheet);
    $('#ac-save').addEventListener('click', saveAcct);
    $('#acform').addEventListener('submit', ev => { ev.preventDefault(); saveAcct(); });
    $('#ac-delete-top').addEventListener('click', () => { if (acform && acform.editing) deleteAcctById(acform.editing.id); });
    $('#ac-seg').addEventListener('click', ev => { const b = ev.target.closest('[data-type]'); if (b) acSetType(b.dataset.type); });
    $('#ac-amount').addEventListener('input', () => { const inp = $('#ac-amount'); let v = inp.value.replace(/,/g, '').replace(/[^\d.-]/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2); if (v !== inp.value) inp.value = v; });
    $('#ml-snap').addEventListener('click', saveSnapshot);
    const doCopy = () => showTextDialog('Copy as text · คัดลอก', mlCurrentText());
    $('#ml-copy').addEventListener('click', doCopy); $('#ml-copy-top').addEventListener('click', doCopy);
    $('#view-moneyleft').addEventListener('click', ev => {
      const t = ev.target;
      let b;
      if ((b = t.closest('[data-acct]'))) { const x = state.ml.accounts.find(a => a.id === b.dataset.acct); if (x) openAcctSheet(x); return; }
      if ((b = t.closest('[data-recv]'))) { const it = state.ml.items.find(i => i.id === b.dataset.recv); if (it) markReceived(it); return; }
      if ((b = t.closest('[data-unrecv]'))) { const it = state.ml.items.find(i => i.id === b.dataset.unrecv); if (it) markPending(it); return; }
      if ((b = t.closest('[data-mlitem]'))) { const it = state.ml.items.find(i => i.id === b.dataset.mlitem); if (it) openMLSheet(it); return; }
      if ((b = t.closest('[data-additem]'))) { openMLSheet(null); return; }
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
    $('#ml-delete-top').addEventListener('click', deleteMLItem);
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
    return { app: 'my-expenses', format: 4, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
      settings: { start: state.settings.start, symbol: state.settings.symbol, customCats: state.settings.customCats }, entries,
      moneyLeft: { accounts: state.ml.accounts.map(x => Object.assign({}, x)), bank: state.ml.bank, bankUpdated: state.ml.bankUpdated, groups: [], items, snapshots: state.ml.snaps.slice().sort((a, b) => a.ts - b.ts) } };
  }
  async function exportBackup(mode) {
    if (!mode) mode = await dialog({ title: 'Export backup · สำรองข้อมูล', msg: 'An encrypted backup is protected by a passcode you choose (you need it to restore).',
      buttons: [{ label: '🔐 Encrypted backup (recommended)', value: 'enc', bold: true }, { label: 'Plain JSON (not protected)', value: 'plain' }, { label: 'Cancel', value: null }] });
    if (!mode) return;
    let bpass = null;
    if (mode === 'enc') { bpass = await passDialog({ title: 'Backup passcode', msg: 'Choose a passcode for this backup file (min 6). Without it the backup can’t be restored.', confirm: true, ok: 'Encrypt' }); if (!bpass) return; }
    else if (!(await confirmDlg('Export unprotected backup?', 'Anyone who gets this file can read all your amounts, notes and photos.', 'Export plain JSON', true))) return;
    toast('Preparing backup…');
    let data = await buildBackup();
    const counts = { items: data.moneyLeft.items.length, snaps: data.moneyLeft.snapshots.length, entries: data.entries.length };
    if (bpass) data = await Vault.encryptBackup(JSON.stringify(data), bpass);
    const d = new Date(); const stamp = L.dayKey(d.getTime()) + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const name = `my-money-backup-${stamp}${bpass ? '-encrypted' : ''}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = (typeof File === 'function') ? new File([blob], name, { type: 'application/json' }) : null;
    const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    const download = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    };
    const choice = await dialog({ title: 'Backup ready', msg: `${bpass ? '🔐 Encrypted · ' : '⚠️ Not encrypted · '}${counts.items} entries · ${counts.snaps} snapshots${counts.entries ? ` · ${counts.entries} older expense entries` : ''} · ${fmtBytes(blob.size)}\nSave it to Files or iCloud Drive.`,
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
      const it = { id: String(r.id || ''), groupId: r.groupId == null ? null : String(r.groupId), name: String(r.name || '').trim(), amount: Number(r.amount), date: /^\d{4}-\d\d-\d\d$/.test(r.date || '') ? r.date : '', tag: String(r.tag || ''), note: String(r.note || ''),
        status: r.status === 'received' ? 'received' : 'pending', receivedAt: Number(r.receivedAt) || null, addedToBank: !!r.addedToBank,
        order: Number(r.order) || 0, created: Number(r.created) || Date.now(), updated: Number(r.updated) || Number(r.created) || Date.now(), photo: null, thumb: null };
      if (!it.id || !it.name || !Number.isInteger(it.amount) || it.amount <= 0) { bad++; continue; }
      try { if (r.photo) it.photo = dataURLToBlob(r.photo); if (r.thumb) it.thumb = dataURLToBlob(r.thumb); } catch (_) {}
      items.push(it);
    }
    const snaps = (Array.isArray(m.snapshots) ? m.snapshots : []).filter(x => x && x.id && Number.isFinite(+x.ts)).map(x => ({ id: String(x.id), ts: +x.ts, bank: Number(x.bank) || 0, pending: Number(x.pending) || 0, total: Number(x.total) || 0,
      text: String(x.text || ''), accounts: Array.isArray(x.accounts) ? x.accounts : undefined }));
    let accounts = L.normAccounts(m.accounts); // v1.4.0 format; older files have a single bank balance
    if (!accounts.length) accounts = [L.legacyAccount(Number.isInteger(m.bank) ? m.bank : 0, m.bankUpdated)];
    const legacyBank = !Array.isArray(m.accounts) || !m.accounts.length;
    return { accounts, legacyBank, bank: L.acctTotal(accounts), bankUpdated: accounts.reduce((x, a) => Math.max(x, a.updated || 0), 0) || null, items: L.flattenML(groups, items), snaps, bad }; // old grouped format is flattened
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
      await DB.setKV('mlAccounts', ml.accounts); await DB.setKV('mlBank', null);
    } else {
      const cur = state.ml;
      // merge accounts by id: newer balance wins, new accounts are added (an old file's bank merges into the main account)
      const accts = cur.accounts.map(x => Object.assign({}, x));
      for (const inc of ml.accounts) {
        if (ml.legacyBank && !inc.updated && !inc.balance) continue;
        const x = accts.find(a => a.id === inc.id);
        if (!x) accts.push(Object.assign({}, inc, { order: accts.reduce((m, a) => Math.max(m, a.order || 0), -1) + 1 }));
        else if (inc.updated && (!x.updated || inc.updated > x.updated)) Object.assign(x, ml.legacyBank ? { balance: inc.balance, updated: inc.updated } : inc);
      }
      await DB.setKV('mlAccounts', accts);
      const base = cur.items.length ? Math.max(...cur.items.map(i => i.order || 0)) + 1 : 0;
      const have = new Set(cur.items.map(i => i.id));
      ml.items = ml.items.map((it, k) => (have.has(it.id) ? it : Object.assign({}, it, { order: base + k })));
    }
    await DB.putMLs(ml.items); await DB.putSnaps(ml.snaps);
  }
  async function importBackup(file) {
    let parsed;
    let text = await file.text();
    try {
      const obj = JSON.parse(text);
      if (obj && obj.encrypted && obj.format === 'enc1') {
        for (;;) {
          const p = await passDialog({ title: 'Encrypted backup', msg: 'Enter the passcode used for this backup.', ok: 'Decrypt' }); if (!p) return;
          try { toast('Decrypting…'); text = await Vault.decryptBackup(obj, p); break; }
          catch (e) { if (e.code !== 'BADKEY') throw e; await dialog({ title: 'Wrong passcode', msg: 'That passcode doesn’t open this backup.' }); }
        }
      }
    } catch (e) { if (!(e instanceof SyntaxError)) { await dialog({ title: 'Can’t restore', msg: e.message }); return; } }
    try { parsed = parseBackup(text); } catch (e) { await dialog({ title: 'Can’t restore', msg: e.message }); return; }
    for (const e of parsed.entries) if (e.photo && !e.thumb) { try { e.thumb = (await processPhoto(e.photo, 1600, 192)).thumb; } catch (_) {} }
    const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('en-GB') : 'unknown date';
    const mlDesc = parsed.ml ? `Main Money: ${parsed.ml.accounts.length > 1 ? parsed.ml.accounts.length + ' accounts' : 'bank'} ${money(parsed.ml.bank, { auto: true })}, ${parsed.ml.items.length} entries, ${parsed.ml.snaps.length} snapshots.` : '';
    const resetThumbs = () => { thumbURLs.forEach(v => revokeLater(v.url)); thumbURLs.clear(); };

    if (parsed.mlOnly) {
      if (!parsed.ml) { await dialog({ title: 'Can’t restore', msg: 'This file has no Main Money data.' }); return; }
      const mode = await dialog({ title: 'Restore Main Money?', msg: `${mlDesc}\nFrom ${when}. Older expense entries are not touched.\n\nMerge keeps your current data. Replace erases it first.`,
        buttons: [{ label: 'Merge', value: 'merge', bold: true }, { label: 'Replace Main Money', value: 'replace', danger: true }, { label: 'Cancel', value: null }] });
      if (!mode) return;
      if (mode === 'replace' && (state.ml.items.length || state.ml.bankUpdated) &&
        !(await confirmDlg('Replace Main Money?', `Your current bank balance, ${state.ml.items.length} entries and ${state.ml.snaps.length} snapshots will be erased.`, 'Replace', true))) return;
      await applyMoneyLeft(parsed.ml, mode === 'replace');
      await loadAll(); resetThumbs(); toast('Main Money restored'); requestPersist(); render(); return;
    }

    const mode = await dialog({ title: 'Restore backup?', msg: `Backup from ${when}.${mlDesc ? '\n' + mlDesc : ''}${parsed.entries.length ? `\nAlso ${parsed.entries.length} older expense entries (kept, not shown).` : ''}${parsed.bad ? `\n${parsed.bad} invalid entries will be skipped.` : ''}\n\nMerge keeps your current data. Replace erases it first.`,
      buttons: [{ label: 'Merge', value: 'merge', bold: true }, { label: 'Replace everything', value: 'replace', danger: true }, { label: 'Cancel', value: null }] });
    if (!mode) return;
    if (mode === 'replace') {
      if (!(await confirmDlg('Replace all data?', `All current data on this device will be replaced.`, 'Replace', true))) return;
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
    toast('Backup restored');
    requestPersist();
    render();
  }

  // ---------- Security: encryption + lock ----------
  let cryptoMeta = null; let currentDEK = null; let hiddenAt = 0;
  function passDialog(o) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.innerHTML = (o.current ? `<input class="dlg-input" type="password" data-f="cur" placeholder="Current passcode" autocomplete="current-password">` : '') +
        `<input class="dlg-input" type="password" data-f="p1" placeholder="${o.current ? 'New passcode' : 'Passcode'} (min 6)" autocomplete="${o.confirm ? 'new-password' : 'current-password'}">` +
        (o.confirm ? `<input class="dlg-input" type="password" data-f="p2" placeholder="Repeat passcode" autocomplete="new-password">` : '') + `<div class="dlg-err" hidden></div>`;
      box.addEventListener('input', () => { const e = box.querySelector('.dlg-err'); e.hidden = true; e.textContent = ''; });
      const run = async () => {
        const v = await dialog({ title: o.title, msg: o.msg || '', extra: box, buttons: [{ label: 'Cancel', value: false }, { label: o.ok || 'Continue', value: true, bold: true }] });
        if (!v) return resolve(null);
        const g = f => { const i = box.querySelector(`[data-f="${f}"]`); return i ? i.value : ''; };
        const err = m => { const e = box.querySelector('.dlg-err'); e.textContent = m; e.hidden = false; run(); };
        if (g('p1').length < 6) return err('Passcode must be at least 6 characters.');
        if (o.confirm && g('p1') !== g('p2')) return err('Passcodes don’t match.');
        resolve(o.current ? { current: g('cur'), passcode: g('p1') } : g('p1'));
      };
      run();
    });
  }
  function showLock(autoFace) {
    const L_ = $('#lock'); L_.hidden = false; document.body.classList.add('locked');
    $('#lock-err').textContent = ''; $('#lock-pass').value = '';
    const hasFace = !!(cryptoMeta && cryptoMeta.prf);
    $('#lock-face').hidden = !hasFace;
    $('#lock-passform').hidden = hasFace; $('#lock-usepass').hidden = !hasFace;
    $('#lock-note').textContent = hasFace ? '' : (cryptoMeta && cryptoMeta.prfUnsupported ? 'Face ID unlock isn’t supported on this device — use your passcode.' : '');
    if (hasFace && autoFace) setTimeout(() => tryFaceUnlock(true), 250); else if (!hasFace) setTimeout(() => $('#lock-pass').focus(), 100);
  }
  async function unlockWith(dek) {
    currentDEK = dek; DB.setKey(dek);
    $('#lock').hidden = true; document.body.classList.remove('locked');
    await loadAll(); render(); processPendingSMS();
  }
  async function tryFaceUnlock(auto) {
    if (!cryptoMeta || !cryptoMeta.prf) return;
    $('#lock-err').textContent = '';
    try { await unlockWith(await Vault.unwrapWithFaceID(cryptoMeta.prf)); }
    catch (e) {
      if (e && e.name === 'NotAllowedError') { if (!auto) $('#lock-err').textContent = 'Face ID was cancelled. Try again or use your passcode.'; }
      else $('#lock-err').textContent = (e && e.message) || 'Face ID failed';
      if (e && e.code === 'NOPRF') { $('#lock-passform').hidden = false; $('#lock-usepass').hidden = true; }
    }
  }
  async function passUnlock(ev) {
    ev.preventDefault();
    const btn = $('#lock-passform button'); btn.disabled = true; $('#lock-err').textContent = 'Checking…';
    try { await unlockWith(await Vault.unwrapWithPasscode(cryptoMeta.passcode, $('#lock-pass').value)); }
    catch (e) { $('#lock-err').textContent = e && e.code === 'BADKEY' ? 'Wrong passcode · รหัสไม่ถูกต้อง' : String(e && e.message || e); $('#lock-pass').select(); }
    finally { btn.disabled = false; }
  }
  function lockNow() {
    if (!DB.isEncrypted()) return;
    if (form) closeSheet(); if (mlform) closeMLSheet(); if (acform) closeAcctSheet(); closePeek(); if (!$('#viewer').hidden) closeViewer();
    $('#dlg').hidden = true;
    currentDEK = null; DB.setKey(null);
    state.entries = []; state.ml = { bank: 0, bankUpdated: null, accounts: [], groups: [], items: [], snaps: [] };
    thumbURLs.forEach(v => revokeLater(v.url)); thumbURLs.clear();
    $('#ml-groups').innerHTML = ''; $('#ml-received').innerHTML = ''; $('#ml-snaps').innerHTML = ''; $('#ml-accts').innerHTML = ''; $('#list').innerHTML = '';
    showLock(true);
  }
  async function encryptSetup() {
    if (!Vault.available) { await dialog({ title: 'Not available', msg: 'This browser has no WebCrypto. Open the app in Safari over HTTPS.' }); return; }
    const go = await dialog({ title: 'Encrypt & Lock · เข้ารหัส', msg: 'All your data and photos will be encrypted on this phone (AES-256). You unlock with Face ID or a passcode.\n\n⚠️ If you forget the passcode AND lose Face ID (e.g. new phone), your data cannot be recovered by anyone. Keep an encrypted backup.',
      buttons: [{ label: 'Continue', value: true, bold: true }, { label: 'Cancel', value: false }] });
    if (!go) return;
    const passcode = await passDialog({ title: 'Set a passcode', msg: 'Used when Face ID isn’t available, and to restore backups. Min 6 characters.', confirm: true });
    if (!passcode) return;
    const dek = await Vault.genDEK();
    const meta = { v: 1, cipher: 'AES-256-GCM', created: Date.now(), passcode: null, prf: null, prfUnsupported: false };
    if (await Vault.platformAvailable()) {
      const useFace = await dialog({ title: 'Unlock with Face ID?', msg: 'Face ID derives a key on this device to unlock your data.', buttons: [{ label: 'Use Face ID', value: true, bold: true }, { label: 'Passcode only', value: false }] });
      if (useFace) {
        try { meta.prf = await Vault.enrollFaceID(dek); }
        catch (e) {
          if (e && e.code === 'NOPRF') { meta.prfUnsupported = true; await dialog({ title: 'Face ID not supported here', msg: 'This device/iOS version can’t derive an encryption key from Face ID (WebAuthn PRF). Your data will be unlocked with the passcode only.' }); }
          else toast('Face ID skipped');
        }
      }
    } else meta.prfUnsupported = true;
    toast('Encrypting…');
    meta.passcode = await Vault.wrapWithPasscode(dek, passcode);
    try {
      await DB.setCryptoMeta(meta); DB.setKey(dek);
      await DB.rewriteAll(dek);
    } catch (e) {
      console.error(e); DB.setKey(null); await DB.setCryptoMeta(null);
      await dialog({ title: 'Encryption failed', msg: 'Nothing was changed. ' + (e && e.message || e) }); return;
    }
    cryptoMeta = meta; currentDEK = dek;
    await loadAll(); render();
    const exp = await dialog({ title: '🔐 Encrypted', msg: 'Your data is now encrypted on this phone.\n\nStrongly recommended: export an encrypted backup now and save it to Files / iCloud Drive.',
      buttons: [{ label: 'Export encrypted backup', value: true, bold: true }, { label: 'Later', value: false }] });
    if (exp) exportBackup('enc');
  }
  async function verifyUnlock(title) {
    const hasFace = !!(cryptoMeta && cryptoMeta.prf);
    let how = 'pass';
    if (hasFace) { how = await dialog({ title, msg: 'Confirm it’s you.', buttons: [{ label: 'Use Face ID', value: 'face', bold: true }, { label: 'Use passcode', value: 'pass' }, { label: 'Cancel', value: null }] }); if (!how) return null; }
    try {
      if (how === 'face') return await Vault.unwrapWithFaceID(cryptoMeta.prf);
      const p = await passDialog({ title, msg: 'Enter your passcode.', ok: 'Confirm' }); if (!p) return null;
      return await Vault.unwrapWithPasscode(cryptoMeta.passcode, p);
    } catch (e) { await dialog({ title: 'Not confirmed', msg: e && e.code === 'BADKEY' ? 'Wrong passcode.' : String(e && e.message || e) }); return null; }
  }
  async function changePasscode() {
    const r = await passDialog({ title: 'Change passcode', current: true, confirm: true, ok: 'Change' }); if (!r) return;
    try { await Vault.unwrapWithPasscode(cryptoMeta.passcode, r.current); } catch (_) { await dialog({ title: 'Wrong passcode', msg: 'The current passcode is not correct.' }); return; }
    cryptoMeta = Object.assign({}, cryptoMeta, { passcode: await Vault.wrapWithPasscode(currentDEK, r.passcode) });
    await DB.setCryptoMeta(cryptoMeta); toast('Passcode changed'); renderSettings();
  }
  async function reenrollFace() {
    if (!(await Vault.platformAvailable())) { await dialog({ title: 'Face ID unavailable', msg: 'This device has no platform authenticator available to this app.' }); return; }
    try { cryptoMeta = Object.assign({}, cryptoMeta, { prf: await Vault.enrollFaceID(currentDEK), prfUnsupported: false }); await DB.setCryptoMeta(cryptoMeta); toast('Face ID set up'); }
    catch (e) {
      if (e && e.code === 'NOPRF') { cryptoMeta = Object.assign({}, cryptoMeta, { prfUnsupported: true }); await DB.setCryptoMeta(cryptoMeta); await dialog({ title: 'Face ID not supported here', msg: e.message + '\nKeep using your passcode.' }); }
      else toast('Face ID cancelled');
    }
    renderSettings();
  }
  async function disableEncryption() {
    const ok = await confirmDlg('Turn off encryption?', 'Your data will be stored unencrypted on this phone again.', 'Continue', true); if (!ok) return;
    const dek = await verifyUnlock('Turn off encryption'); if (!dek) return;
    toast('Decrypting…');
    try { await DB.rewriteAll(null); await DB.setCryptoMeta(null); DB.setKey(null); cryptoMeta = null; currentDEK = null; }
    catch (e) { await dialog({ title: 'Failed', msg: String(e && e.message || e) }); return; }
    await loadAll(); render(); toast('Encryption turned off');
  }
  function renderSecurity() {
    const on = DB.isEncrypted();
    $('#sec-off').hidden = on; $('#sec-on').hidden = !on;
    if (on) $('#sec-face').textContent = cryptoMeta && cryptoMeta.prf ? 'On ✓' : (cryptoMeta && cryptoMeta.prfUnsupported ? 'Not supported' : 'Off');
    $('#btn-face-enroll .row-l').textContent = cryptoMeta && cryptoMeta.prf ? 'Set up Face ID again' : 'Set up Face ID';
    $('#sec-note').textContent = on ? 'Data and photos are encrypted with AES-256-GCM. The key is only in memory while unlocked; the app locks after 60 s in the background. Forgetting the passcode and losing Face ID = data unrecoverable.'
      : 'Optional. Encrypts all data and photos on this phone; unlock with Face ID or a passcode.';
  }
  function bindSecurity() {
    $('#btn-encrypt').addEventListener('click', () => encryptSetup().catch(e => dialog({ title: 'Error', msg: String(e && e.message || e) })));
    $('#btn-lock-now').addEventListener('click', lockNow);
    $('#btn-change-pass').addEventListener('click', () => changePasscode().catch(e => dialog({ title: 'Error', msg: String(e && e.message || e) })));
    $('#btn-face-enroll').addEventListener('click', () => reenrollFace().catch(e => dialog({ title: 'Error', msg: String(e && e.message || e) })));
    $('#btn-decrypt').addEventListener('click', () => disableEncryption().catch(e => dialog({ title: 'Error', msg: String(e && e.message || e) })));
    $('#lock-face').addEventListener('click', () => tryFaceUnlock(false));
    $('#lock-usepass').addEventListener('click', () => { $('#lock-passform').hidden = false; $('#lock-usepass').hidden = true; $('#lock-pass').focus(); });
    $('#lock-passform').addEventListener('submit', passUnlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (DB.isEncrypted() && DB.isUnlocked() && hiddenAt && Date.now() - hiddenAt > 60000) lockNow();
      hiddenAt = 0;
    });
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
    $('#fab').addEventListener('click', () => openMLSheet(null));
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
    $('#catlist').addEventListener('click', ev => { const r = ev.target.closest('[data-cat]'); if (!r) return; state.filter = { month: state.sumMonth, category: r.dataset.cat, query: '' }; setView('moneyleft'); });
    // sheet
    $('#sheet-cancel').addEventListener('click', closeSheet);
    $('#scrim').addEventListener('click', () => { if (acform) closeAcctSheet(); else if (mlform) closeMLSheet(); else closeSheet(); });
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
      if (!$('#peek').hidden) closePeek(); else if (!$('#viewer').hidden) closeViewer(); else if (!$('#dlg').hidden) return; else if (mlform) closeMLSheet(); else if (form) closeSheet();
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
    $('#btn-export').addEventListener('click', () => exportBackup(null).catch(e => dialog({ title: 'Export failed', msg: String(e && e.message || e) })));
    $('#import-file').addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) importBackup(f).catch(e => dialog({ title: 'Restore failed', msg: String(e && e.message || e) })); });
    $('#btn-wipe').addEventListener('click', async () => {
      if (!(await confirmDlg('Erase all data?', 'Your bank balance, entries, photos, snapshots and settings on this device will be deleted. Export a backup first if you might need it.', 'Erase', true))) return;
      if (!(await confirmDlg('Are you sure?', 'This cannot be undone.', 'Erase everything', true))) return;
      await DB.clearAll(); cryptoMeta = null; currentDEK = null; thumbURLs.forEach(v => revokeLater(v.url)); thumbURLs.clear();
      await loadAll(); state.filter = { month: 'all', category: 'all', query: '' }; toast('All data erased'); render();
    });
    // install hint
    $('#installhint-x').addEventListener('click', () => { $('#installhint').hidden = true; DB.setKV('hintDismissed', true); });
    enableSheetDrag($('#sheet'), closeSheet);
    enableSheetDrag($('#mlsheet'), closeMLSheet);
    bindMoneyLeft();
    // refresh "Today"/"This month" labels when returning to the app
    document.addEventListener('visibilitychange', () => { if (!document.hidden && DB.isUnlocked()) render(); });
  }

  async function maybeShowInstallHint() {
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (iOS && !standalone && !(await DB.getKV('hintDismissed', false))) $('#installhint').hidden = false;
  }

  async function init() {
    bind(); bindSecurity();
    try { cryptoMeta = await DB.loadCryptoMeta(); } catch (e) { console.error(e); }
    if (cryptoMeta) { showLock(true); }
    else try { await loadAll(); }
    catch (e) { console.error(e); await dialog({ title: 'Storage unavailable', msg: 'This browser blocked local storage (Private Browsing?). Open the app normally in Safari to save entries.\n\n' + (e && e.message || e) }); }
    if (!cryptoMeta) { render(); processPendingSMS(); }
    requestPersist();
    maybeShowInstallHint().catch(() => {});
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
    }
  }

  // exposed for automated tests only
  window.__app = { state, processPhoto, parseBackup, buildBackup, importBackup, render, mlCurrentText, lockNow, DB: () => DB };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
