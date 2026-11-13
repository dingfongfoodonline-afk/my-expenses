/* My Money: designed report image (PNG), rendered fully on-device with <canvas>.
   No network and no external fonts: system fonts render Thai (Thonburi / Sukhumvit on iOS, Noto Sans Thai elsewhere). */
(function (root) {
  'use strict';
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Sukhumvit Set", Thonburi, "Noto Sans Thai", "Noto Sans", "Helvetica Neue", Arial, sans-serif';
  const W = 540, PAD = 22, CARD_R = 18;
  const THEMES = {
    main: { g: ['#4C3BCF', '#2F5BEA', '#1E88E5'], accent: '#2F5BEA', soft: '#EEF2FF' },
    mother: { g: ['#C2185B', '#E0567A', '#F08A5D'], accent: '#D2416A', soft: '#FFF0F3' }
  };
  const f = (w, s) => `${w} ${s}px ${FONT}`;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Thai has no spaces between words: break with Intl.Segmenter (word), else by grapheme, so tone marks never split
  function segments(text) {
    try { if (Intl.Segmenter) return Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), s => s.segment); } catch (_) {}
    try { if (Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => s.segment); } catch (_) {}
    return text.split(/(\s+)/);
  }
  function wrap(ctx, text, maxW, maxLines) {
    const out = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const seg of segments(para)) {
        const t = line + seg;
        if (ctx.measureText(t).width <= maxW || !line) {
          if (ctx.measureText(t).width > maxW && !line) { // single very long segment: hard-split by grapheme
            let cur = ''; for (const ch of Array.from(seg)) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; } line = cur;
          } else line = t;
        } else { out.push(line.trimEnd()); line = seg.trimStart(); }
      }
      out.push(line.trimEnd());
    }
    if (maxLines && out.length > maxLines) { const cut = out.slice(0, maxLines); let l = cut[maxLines - 1]; while (l && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); cut[maxLines - 1] = l + '…'; return cut; }
    return out;
  }
  function cover(ctx, img, x, y, w, h) {
    const iw = img.width, ih = img.height, s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }
  async function loadImage(blob) {
    if (!blob) return null;
    try { if (root.createImageBitmap) return await createImageBitmap(blob); } catch (_) {}
    return new Promise(res => { const u = URL.createObjectURL(blob); const im = new Image(); im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => { URL.revokeObjectURL(u); res(null); }; im.src = u; });
  }

  // model: { theme, title, subtitle, stamp, hero: {label, value}, stats: [{label, value, sub}], rows: [{icon,label,sub,value}], sections: [{title, cards:[{name, amount, when, tag, note, badge, badgeColor, img, muted}]}], footer }
  function paint(ctx, m, draw) {
    const th = THEMES[m.theme] || THEMES.main; let y = PAD;
    if (draw) { ctx.fillStyle = '#F4F5FA'; ctx.fillRect(0, 0, W, 1e6); }
    // ---- header card ----
    const hx = PAD, hw = W - PAD * 2, inner = hw - 40;
    ctx.font = f(700, 15); const rowsH = (m.rows || []).length ? 14 + m.rows.length * 46 + 8 : 0;
    const statsH = (m.stats || []).length ? 86 : 0;
    const hh = 24 + 22 + 20 + 22 + 50 + 12 + statsH + rowsH + 18;
    if (draw) {
      const g = ctx.createLinearGradient(hx, y, hx + hw, y + hh); g.addColorStop(0, th.g[0]); g.addColorStop(0.55, th.g[1]); g.addColorStop(1, th.g[2]);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8; rr(ctx, hx, y, hw, hh, 26); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.save(); rr(ctx, hx, y, hw, hh, 26); ctx.clip();
      const rg = ctx.createRadialGradient(hx + hw - 40, y + 10, 0, hx + hw - 40, y + 10, 200); rg.addColorStop(0, 'rgba(255,255,255,.25)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(hx, y, hw, hh); ctx.restore();
    }
    let cy = y + 24 + 20; const cx = hx + 20;
    if (draw) {
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.font = f(800, 22); ctx.fillText(m.title, cx, cy);
      ctx.font = f(500, 13); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(m.subtitle + '  ·  ' + m.stamp, cx, cy + 20);
    }
    cy += 20 + 34;
    if (draw) { ctx.font = f(600, 14); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(m.hero.label, cx, cy); ctx.font = f(800, 42); ctx.fillStyle = '#fff'; ctx.fillText(m.hero.value, cx, cy + 46); }
    cy += 46 + 16;
    if (statsH) {
      const n = m.stats.length, gap = 10, sw = (inner - gap * (n - 1)) / n;
      m.stats.forEach((s, i) => {
        const sx = cx + i * (sw + gap);
        if (draw) {
          rr(ctx, sx, cy, sw, 72, 14); ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = f(500, 12); ctx.fillText(fit(ctx, s.label, sw - 24), sx + 12, cy + 22);
          ctx.fillStyle = '#fff'; ctx.font = f(700, 19); ctx.fillText(fit(ctx, s.value, sw - 24), sx + 12, cy + 46);
          ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = f(400, 11); ctx.fillText(fit(ctx, s.sub || '', sw - 24), sx + 12, cy + 63);
        }
      });
      cy += statsH;
    }
    if (rowsH) {
      if (draw) { rr(ctx, cx, cy, inner, rowsH - 8, 14); ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fill(); }
      let ry = cy + 8;
      m.rows.forEach((r, i) => {
        if (draw) {
          if (i) { ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(cx + 44, ry, inner - 56, 1); }
          ctx.font = f(400, 20); ctx.fillStyle = '#fff'; ctx.fillText(r.icon || '', cx + 12, ry + 30);
          ctx.textAlign = 'right'; ctx.font = f(700, 16); ctx.fillText(r.value, cx + inner - 12, ry + 28); const vw = ctx.measureText(r.value).width; ctx.textAlign = 'left';
          ctx.font = f(r.bold ? 700 : 600, 15); ctx.fillText(fit(ctx, r.label, inner - 70 - vw), cx + 44, ry + 21);
          ctx.font = f(400, 11); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(fit(ctx, r.sub || '', inner - 70 - vw), cx + 44, ry + 37);
        }
        ry += 46;
      });
    }
    y += hh + 22;
    const breaks = m._breaks = [y - 10];
    // ---- sections of entry cards ----
    for (const sec of m.sections || []) {
      breaks.push(y - 4);
      if (draw) { ctx.font = f(700, 13); ctx.fillStyle = '#6B7280'; ctx.fillText(sec.title.toUpperCase(), PAD + 4, y + 12); }
      if (draw && sec.total) { ctx.textAlign = 'right'; ctx.fillStyle = th.accent; ctx.fillText(sec.total, W - PAD - 4, y + 12); ctx.textAlign = 'left'; }
      y += 24;
      if (!sec.cards.length) {
        if (draw) { rr(ctx, PAD, y, W - PAD * 2, 54, CARD_R); ctx.fillStyle = '#fff'; ctx.fill(); ctx.font = f(400, 14); ctx.fillStyle = '#9CA3AF'; ctx.fillText(sec.empty || 'No items', PAD + 18, y + 33); }
        y += 54 + 14; continue;
      }
      for (const c of sec.cards) { y = card(ctx, c, y, th, draw) + 12; c._bottom = y; breaks.push(y - 6); }
      y += 10;
    }
    // ---- footer ----
    if (draw) { ctx.font = f(500, 12); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center'; ctx.fillText(m.footer, W / 2, y + 14); ctx.textAlign = 'left'; }
    return y + 14 + PAD;
  }
  function fit(ctx, s, w) { s = String(s); if (ctx.measureText(s).width <= w) return s; while (s && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
  function card(ctx, c, y, th, draw) {
    const x = PAD, w = W - PAD * 2, ix = x + 16, iw = w - 32;
    const hasPhoto = !!(c.iw && c.ih), portrait = hasPhoto && c.ih > c.iw * 1.1;
    const photoH = hasPhoto ? Math.round(portrait ? 340 : Math.min(260, Math.max(150, w * c.ih / c.iw))) : 0;
    c._top = y;
    ctx.font = f(700, 17); const amtW = ctx.measureText(c.amount).width;
    const nameLines = wrap(ctx, c.name, iw - amtW - 14, 2);
    ctx.font = f(400, 13); const noteLines = c.note ? wrap(ctx, c.note, iw, 3) : [];
    const h = (photoH ? photoH + 14 : 16) + nameLines.length * 22 + 22 + (noteLines.length ? 6 + noteLines.length * 18 : 0) + 16;
    if (draw) {
      ctx.save(); ctx.shadowColor = 'rgba(17,24,39,.08)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; rr(ctx, x, y, w, h, CARD_R); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
      if (hasPhoto && !c.img) { ctx.save(); rr(ctx, x, y, w, photoH, CARD_R); ctx.fillStyle = '#EEF0F4'; ctx.fill(); ctx.restore(); }
      if (hasPhoto && c.img) { ctx.save(); rr(ctx, x, y, w, photoH, CARD_R); ctx.rect(x, y + CARD_R, w, photoH - CARD_R); ctx.clip();
        if (portrait) { ctx.fillStyle = '#EEF0F4'; ctx.fillRect(x, y, w, photoH); const s = Math.min((photoH - 20) / c.img.height, (w - 20) / c.img.width), dw = c.img.width * s, dh = c.img.height * s;
          ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 10; ctx.drawImage(c.img, x + (w - dw) / 2, y + (photoH - dh) / 2, dw, dh); ctx.restore(); } // receipts: show the whole photo
        else cover(ctx, c.img, x, y, w, photoH);
        ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(x, y + photoH - 1, w, 1); ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fill(); ctx.restore(); }
      let ty = y + (photoH ? photoH + 14 : 16);
      ctx.textAlign = 'right'; ctx.font = f(700, 17); ctx.fillStyle = c.muted ? '#9CA3AF' : '#111827'; ctx.fillText(c.amount, ix + iw, ty + 17); ctx.textAlign = 'left';
      ctx.font = f(600, 16); ctx.fillStyle = c.muted ? '#6B7280' : '#111827';
      nameLines.forEach((l, i) => ctx.fillText(l, ix, ty + 17 + i * 22)); ty += nameLines.length * 22;
      // meta line: date/time, tag pill, badge
      ctx.font = f(400, 12.5); ctx.fillStyle = '#6B7280'; ctx.fillText(c.when, ix, ty + 14); let mx = ix + ctx.measureText(c.when).width + 8;
      for (const p of [c.tag ? { t: c.tag, bg: th.soft, fg: th.accent } : null, c.badge ? { t: c.badge, bg: c.badgeBg || '#ECFDF5', fg: c.badgeColor || '#059669' } : null].filter(Boolean)) {
        ctx.font = f(600, 11); const pw = ctx.measureText(p.t).width + 14; rr(ctx, mx, ty + 1, pw, 18, 9); ctx.fillStyle = p.bg; ctx.fill(); ctx.fillStyle = p.fg; ctx.fillText(p.t, mx + 7, ty + 14); mx += pw + 6;
      }
      ty += 22;
      if (noteLines.length) { ctx.font = f(400, 13); ctx.fillStyle = '#4B5563'; noteLines.forEach((l, i) => ctx.fillText(l, ix, ty + 16 + i * 18)); }
    }
    return y + h;
  }
  // iOS WebKit limits: one canvas <= 16,777,216 px and ~384 MB of canvas memory in total, and decoded photos are big.
  // So: measure first (photo sizes only), cut the report into pages at card boundaries, decode photos lazily per page,
  // free every canvas right after toBlob, and never fail silently.
  const MAX_PAGE_H = 3200;          // logical px per page (x2 scale -> 1080 x 6400 = 6.9 M px)
  const MAX_CANVAS_PX = 16000000;
  function toBlobSafe(cv) {
    return new Promise((res, rej) => {
      const fallback = () => { try { const d = cv.toDataURL('image/png'); if (!d || d.length < 100) throw new Error('empty'); const bin = atob(d.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); res(new Blob([u8], { type: 'image/png' })); } catch (e) { rej(new Error('This phone could not create the image (canvas too large or out of memory).')); } };
      try { if (!cv.toBlob) return fallback(); cv.toBlob(b => (b && b.size ? res(b) : fallback()), 'image/png'); } catch (_) { fallback(); }
    });
  }
  function planPages(H, breaks) {
    const cuts = []; let start = 0;
    while (H - start > MAX_PAGE_H) {
      const cand = breaks.filter(b => b > start + 200 && b <= start + MAX_PAGE_H);
      const cut = cand.length ? cand[cand.length - 1] : start + MAX_PAGE_H;
      cuts.push([start, cut]); start = cut;
    }
    cuts.push([start, H]); return cuts;
  }
  async function render(model, onProgress) {
    const cards = []; for (const s of model.sections || []) for (const c of s.cards) cards.push(c);
    let n = 0;
    for (const c of cards) { // photo sizes only; bitmaps are released immediately
      if (!c.photo) continue;
      const im = await loadImage(c.photo); if (im) { c.iw = im.width; c.ih = im.height; if (im.close) im.close(); }
      if (onProgress) onProgress(`Reading photos ${++n}…`);
    }
    const probe = document.createElement('canvas').getContext('2d');
    const H = Math.ceil(paint(probe, model, false));
    const pages = planPages(H, model._breaks || []);
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const [top, bot] = pages[i], ph = bot - top;
      let scale = 2; while (scale > 0.5 && W * scale * ph * scale > MAX_CANVAS_PX) scale -= 0.25;
      if (onProgress) onProgress(pages.length > 1 ? `Drawing page ${i + 1} of ${pages.length}…` : 'Drawing…');
      const onPage = cards.filter(c => c.photo && c.iw && c._bottom > top && c._top < bot);
      for (const c of onPage) c.img = await loadImage(c.photo);
      const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(ph * scale);
      const ctx = cv.getContext('2d'); if (!ctx) throw new Error('Canvas is not available on this device.');
      ctx.scale(scale, scale); ctx.translate(0, -top); paint(ctx, model, true);
      if (pages.length > 1) { ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.font = f(600, 11); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'right'; ctx.fillText(`${i + 1} / ${pages.length}`, W - 12, ph - 8); ctx.textAlign = 'left'; }
      for (const c of onPage) { if (c.img && c.img.close) c.img.close(); c.img = null; }
      const blob = await toBlobSafe(cv);
      out.push({ blob, width: cv.width, height: cv.height, scale });
      cv.width = cv.height = 0; // free canvas memory now (WebKit keeps it until GC otherwise)
    }
    return { pages: out, blob: out[0].blob, width: out[0].width, height: out.reduce((s, p) => s + p.height, 0) };
  }
  root.Report = { VERSION: '1.6.1', render, wrap, planPages, THEMES };
})(self);
