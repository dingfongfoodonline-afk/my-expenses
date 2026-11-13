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
    // ---- sections of entry cards ----
    for (const sec of m.sections || []) {
      if (draw) { ctx.font = f(700, 13); ctx.fillStyle = '#6B7280'; ctx.fillText(sec.title.toUpperCase(), PAD + 4, y + 12); }
      if (draw && sec.total) { ctx.textAlign = 'right'; ctx.fillStyle = th.accent; ctx.fillText(sec.total, W - PAD - 4, y + 12); ctx.textAlign = 'left'; }
      y += 24;
      if (!sec.cards.length) {
        if (draw) { rr(ctx, PAD, y, W - PAD * 2, 54, CARD_R); ctx.fillStyle = '#fff'; ctx.fill(); ctx.font = f(400, 14); ctx.fillStyle = '#9CA3AF'; ctx.fillText(sec.empty || 'No items', PAD + 18, y + 33); }
        y += 54 + 14; continue;
      }
      for (const c of sec.cards) y = card(ctx, c, y, th, draw) + 12;
      y += 10;
    }
    // ---- footer ----
    if (draw) { ctx.font = f(500, 12); ctx.fillStyle = '#9CA3AF'; ctx.textAlign = 'center'; ctx.fillText(m.footer, W / 2, y + 14); ctx.textAlign = 'left'; }
    return y + 14 + PAD;
  }
  function fit(ctx, s, w) { s = String(s); if (ctx.measureText(s).width <= w) return s; while (s && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
  function card(ctx, c, y, th, draw) {
    const x = PAD, w = W - PAD * 2, ix = x + 16, iw = w - 32;
    const portrait = c.img && c.img.height > c.img.width * 1.1;
    const photoH = c.img ? Math.round(portrait ? 340 : Math.min(260, Math.max(150, w * c.img.height / c.img.width))) : 0;
    ctx.font = f(700, 17); const amtW = ctx.measureText(c.amount).width;
    const nameLines = wrap(ctx, c.name, iw - amtW - 14, 2);
    ctx.font = f(400, 13); const noteLines = c.note ? wrap(ctx, c.note, iw, 3) : [];
    const h = (photoH ? photoH + 14 : 16) + nameLines.length * 22 + 22 + (noteLines.length ? 6 + noteLines.length * 18 : 0) + 16;
    if (draw) {
      ctx.save(); ctx.shadowColor = 'rgba(17,24,39,.08)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; rr(ctx, x, y, w, h, CARD_R); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
      if (c.img) { ctx.save(); rr(ctx, x, y, w, photoH, CARD_R); ctx.rect(x, y + CARD_R, w, photoH - CARD_R); ctx.clip();
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
  async function render(model) {
    for (const s of model.sections || []) for (const c of s.cards) if (c.photo) c.img = await loadImage(c.photo);
    const probe = document.createElement('canvas').getContext('2d');
    const H = Math.ceil(paint(probe, model, false));
    const MAXPX = 16e6; // iOS canvas area limit is ~16.7M pixels
    let scale = 2; while (scale > 0.75 && W * scale * H * scale > MAXPX) scale -= 0.25;
    const cv = document.createElement('canvas'); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale); paint(ctx, model, true);
    for (const s of model.sections || []) for (const c of s.cards) { if (c.img && c.img.close) c.img.close(); c.img = null; }
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return { blob, width: cv.width, height: cv.height, scale };
  }
  root.Report = { render, wrap, THEMES };
})(self);
