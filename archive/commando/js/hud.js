'use strict';
// ---------- Интерфейс поверх игры ----------

function hudText(text, x, y, size, color, align = 'left', blur = 10) {
  ctx.font = `${size}px 'Russo One', Consolas, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  glow(color, blur);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  noGlow();
}
function monoText(text, x, y, color = '#b9b0d6', align = 'left', size = 11) {
  ctx.font = `${size}px Consolas, monospace`; ctx.textAlign = align; ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
function drawBar(x, y, w, h, k, color, label) {
  ctx.strokeStyle = rgba(color, 0.6); ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = color; glow(color, 8);
  ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 3) * clamp(k, 0, 1)), h - 3);
  noGlow();
  if (label) monoText(label, x, y - 4);
}
function panel(x, y, w, h, color = '#33ccff', a = 0.85) {
  ctx.fillStyle = `rgba(6,4,14,${a})`; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(color, 0.7); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}
// Перенос текста по ширине
function wrap(text, maxW, font) {
  ctx.font = font;
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawHUD() {
  const p = me();
  const obj = objectives(p);
  hudText(map.name, 20, 32, 17, map.color);

  if (map.hub) {
    hudText('ВЫБЕРИТЕ ЗАДАНИЕ — ВСТАНЬТЕ НА ПЛОЩАДКУ', 20, 58, 13, '#ffffff', 'left', 6);
  } else if (obj.main) {
    hudText('▸ ' + obj.main, 20, 58, 15, '#ffffff', 'left', 6);
    obj.sub.forEach((s, i) => monoText('· ' + s, 24, 78 + i * 16, '#b9b0d6', 'left', 12));
  }

  // сеть, рация, микрофон
  let net = 'ОДИНОЧНАЯ ИГРА';
  if (G.role === 'host') net = `КОМНАТА ${Net.code} · ЛЮДЕЙ ${1 + Net.conns.size}/4`;
  if (G.role === 'guest') net = `КОМНАТА ${Net.code}`;
  hudText(net, VW - 20, 30, 12, '#7d74a0', 'right', 4);
  if (p && !map.hub) {
    const ok = radioAt(p.x, p.y);
    hudText(ok ? 'РАЦИЯ: СВЯЗЬ ЕСТЬ' : 'РАЦИЯ: НЕТ СВЯЗИ', VW - 20, 50, 12, ok ? '#3dff8a' : '#ff3344', 'right', 6);
  }
  if (G.role !== 'solo') {
    const mic = !Voice.stream ? 'МИКРОФОН ОТКЛЮЧЁН' : Voice.muted ? 'МИКРОФОН: ВЫКЛ (M)' : `МИКРОФОН ВКЛ (M) · B — РАЦИЯ`;
    hudText(mic, VW - 20, 68, 11, Voice.stream && !Voice.muted ? '#9dff3a' : '#7d74a0', 'right', 4);
  }

  drawTeam(p);
  drawBossBar();
  drawAlarmWarn();
  drawMarkers(p, obj);
  if (p) drawSelf(p);
  drawDebrisGame(p);
  drawSubs();
  drawUi(p);

  if (G.titleT > 0 && !G.brief && !G.ui) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.titleT);
    hudText(map.hub ? 'БАЗА' : LEVELS[G.lv].name, VW / 2, VH / 2 - 70, 18, '#ffffff', 'center', 6);
    hudText(map.hub ? LEVELS[0].name : LEVELS[G.lv].stageNames[G.stage], VW / 2, VH / 2 - 28, 40, map.color, 'center', 24);
    ctx.restore();
  }
  if (G.toast) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.toast.t * 2);
    hudText(G.toast.text, VW / 2, 128, 19, '#3dff8a', 'center', 14);
    ctx.restore();
  }
  if (G.hurtFlash > 0) { ctx.fillStyle = `rgba(255,30,50,${G.hurtFlash * 0.5})`; ctx.fillRect(0, 0, VW, VH); }
  if (G.whiteT > 0) { ctx.fillStyle = `rgba(255,255,255,${G.whiteT * 1.6})`; ctx.fillRect(0, 0, VW, VH); }
  if (G.fadeT > 0) { ctx.fillStyle = `rgba(0,0,0,${clamp(G.fadeT / 1.4, 0, 1)})`; ctx.fillRect(0, 0, VW, VH); hudText('В ПУТИ…', VW / 2, VH / 2, 28, '#ffb000', 'center', 16); }
  if (G.brief) drawBriefing();

  if (G.state === 'over') {
    ctx.fillStyle = 'rgba(5,3,10,0.6)';
    ctx.fillRect(0, 0, VW, VH);
    hudText('ОТРЯД УНИЧТОЖЕН', VW / 2, VH / 2, 50, '#ff3344', 'center', 30);
    if (G.overT > 0.6 || G.role === 'guest') {
      hudText('R — С КОНТРОЛЬНОЙ ТОЧКИ   ·   H — НА БАЗУ   ·   ESC — В МЕНЮ', VW / 2, VH / 2 + 60, 15, '#b9b0d6', 'center', 4);
    }
  } else if (p && p.down) {
    hudText('ВЫ РАНЕНЫ — НАПАРНИК МОЖЕТ ПОДНЯТЬ, ЕСЛИ ПОСТОИТ РЯДОМ', VW / 2, VH - 110, 15, '#ff3344', 'center', 10);
  }
}

// Состав отряда (слева)
function drawTeam(p) {
  const y0 = 150;
  for (let i = 0; i < G.players.length; i++) {
    const q = [...G.players].sort((a, b) => a.ch - b.ch)[i];
    const c = charColor(q.ch);
    const y = y0 + i * 34;
    const linked = !p || q === p || Math.hypot(q.x - p.x, q.y - p.y) < 900 || (radioAt(q.x, q.y) && radioAt(p.x, p.y)) || map.hub;
    ctx.globalAlpha = linked ? 1 : 0.45;
    hudText(CHARS[q.ch].letter, 20, y + 12, 18, c, 'left', 8);
    monoText(`${CHARS[q.ch].role} · ${q.bot ? 'бот' : q.name}${q.idx === G.myIdx ? ' (вы)' : ''}`, 42, y + 2, '#cfc6ff');
    if (!linked) monoText('нет связи', 42, y + 16, '#ff3344');
    else if (q.down) monoText('РАНЕН', 42, y + 16, '#ff3344');
    else for (let k = 0; k < PLAYER_HP; k++) { ctx.fillStyle = k < q.hp ? c : 'rgba(255,255,255,0.15)'; ctx.fillRect(42 + k * 12, y + 9, 10, 5); }
    ctx.globalAlpha = 1;
  }
}

function drawSelf(p) {
  const y = VH - 30;
  const C = CHARS[p.ch], c = C.color;
  hudText(`${C.letter} · ${C.role}`, 20, y - 58, 16, c, 'left', 8);
  monoText(WEAPONS[C.weapon].name, 20, y - 42, '#cfc6ff', 'left', 12);
  for (let k = 0; k < PLAYER_HP; k++) {
    ctx.fillStyle = k < p.hp ? c : 'rgba(255,255,255,0.12)'; glow(c, k < p.hp ? 8 : 0);
    ctx.fillRect(170 + k * 22, y - 56, 18, 9);
  }
  noGlow();
  drawBar(20, y, 100, 10, 1 - p.dashCd / 0.9, '#33ccff', 'РЫВОК');
  drawBar(135, y, 100, 10, p.stam, p.exh ? '#ff3344' : '#3dff8a', p.exh ? 'ОДЫШКА' : 'ВЫНОСЛИВОСТЬ');
  const SP = SPECIALS[C.special];
  drawBar(250, y, 100, 10, 1 - p.spCd / SP.cd, '#ffb000', 'ПКМ ' + SP.name);
  drawBar(365, y, 70, 10, 1 - p.melCd / 0.6, '#ffffff', 'Q УДАР');
  const nz = p.down || p.ride >= 0 ? null : [
    ['ТИШИНА', '#7d74a0'], ['КРАДЁШЬСЯ — БЕСШУМНО', '#3dff8a'], ['ШАГИ — СЛЫШНО РЯДОМ', '#ffd000'], ['БЕГ — ГРОМКО', '#ff3344'],
  ][p.mv];
  if (nz) hudText(nz[0], 460, y + 9, 12, nz[1], 'left', 6);
  if (p.ride >= 0) {
    const s = G.speeders.find((q) => q.id === p.ride);
    hudText(s && s.seats[0] === p.idx ? 'ЗА РУЛЁМ СПИДЕРА · E — СОЙТИ · ДВИГАТЕЛЬ ШУМИТ' : 'ПАССАЖИР · МОЖНО СТРЕЛЯТЬ · E — СОЙТИ', 460, y + 9, 12, '#33ccff', 'left', 6);
  }
  if (!p.down && darkAt(p.x, p.y)) {
    const lit = p.lamp || p.flashT > 0;
    hudText(lit ? 'ФОНАРЬ ВКЛ — ТЕБЯ ВИДНО ИЗДАЛЕКА (F)' : 'ФОНАРЬ ВЫКЛ — ЗАМЕТЯТ ТОЛЬКО ВБЛИЗИ (F)', 20, y - 76, 11, lit ? '#ffb000' : '#9d8cff', 'left', 6);
  }
  if (canOrderClones(p)) hudText('C (держать) — приказ клонам: ШТУРМ', VW - 20, VH - 22, 13, '#4da6ff', 'right', 8);
}

function drawBossBar() {
  if (!G.m || G.m.boss !== 1) return;
  const b = G.enemies.find((e) => ETYPES[e.t].boss);
  if (!b) return;
  const w = Math.min(520, VW - 80), x = VW / 2 - w / 2, y = 26;
  hudText('ЭКСПЕРИМЕНТАЛЬНЫЙ СУПЕР-B2', VW / 2, y - 6 + 2, 14, '#ff5a5a', 'center', 10);
  drawBar(x, y + 4, w, 12, b.hp / b.maxHp, '#ff5a5a');
  const heat = clamp((b.heat || 0) / BOSS_HEAT_MAX, 0, 1);
  drawBar(x, y + 22, w * 0.5 - 6, 7, b.bst === 'jam' ? 1 : heat, b.bst === 'jam' ? '#ff8800' : '#ffd000');
  monoText(b.armless ? 'ОРУЖИЕ УНИЧТОЖЕНО' : b.bst === 'jam' ? 'ОРУЖИЕ ЗАКЛИНИЛО — БЛИЖНИЙ БОЙ' : `НАГРЕВ · ПЕРЕГРЕВОВ ${b.over || 0}/3`, x, y + 42, '#ffd000');
  monoText(`РАЗРЯДИТСЯ ЧЕРЕЗ ${fmtTime(G.m.bossT)}`, x + w, y + 42, '#b9b0d6', 'right');
}

function drawAlarmWarn() {
  if (G.alarmFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, G.alarmFlash);
    hudText(G.alarmText || 'ТРЕВОГА', VW / 2, 96, 26, '#ff3344', 'center', 20);
    ctx.restore();
    return;
  }
  if (!G.m) return;
  let worst = 0;
  for (const e of G.enemies) {
    if (e.dead || e.st !== 2 || !(e.alarmT > 0)) continue;
    if ((e.zone === 'out' && !G.m.alarm) || (e.zone === 'cen' && !G.m.cenAlarm)) worst = Math.max(worst, e.alarmT);
  }
  if (worst > 0) {
    const left = Math.max(0, ALARM_DELAY - worst);
    hudText(`ВАС ЗАМЕТИЛИ — ТРЕВОГА ЧЕРЕЗ ${left.toFixed(1)} С`, VW / 2, 96, 18, '#ff3344', 'center', 12);
  }
}

// Метки целей: ромб в мире или стрелка у края экрана
function drawMarkers(p, obj) {
  if (!p) return;
  const list = obj.markers.slice();
  if (obj.target) list.push({ x: obj.target.x, y: obj.target.y, label: '', color: '#3dff8a', main: true });
  // напарники за краем экрана
  for (const q of G.players) {
    if (q === p) continue;
    const linked = Math.hypot(q.x - p.x, q.y - p.y) < 900 || (radioAt(q.x, q.y) && radioAt(p.x, p.y));
    if (linked) list.push({ x: q.rx, y: q.ry, label: CHARS[q.ch].letter, color: charColor(q.ch), mate: true, down: q.down });
  }
  for (const m of list) {
    const sx = m.x - G.cam.x + VW / 2, sy = m.y - G.cam.y + VH / 2;
    const inside = sx > 30 && sx < VW - 30 && sy > 30 && sy < VH - 30;
    ctx.save();
    if (inside) {
      if (m.mate) { ctx.restore(); continue; }
      glow(m.color, 10); ctx.strokeStyle = m.color; ctx.lineWidth = 2;
      const r = 8 + Math.sin(G.time * 4) * 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - 26 - r); ctx.lineTo(sx + r, sy - 26); ctx.lineTo(sx, sy - 26 + r); ctx.lineTo(sx - r, sy - 26); ctx.closePath(); ctx.stroke();
      if (m.label) { noGlow(); monoText(m.label, sx, sy - 42, m.color, 'center', 11); }
    } else {
      const a = Math.atan2(sy - VH / 2, sx - VW / 2);
      const ex = clamp(VW / 2 + Math.cos(a) * VW, 30, VW - 30), ey = clamp(VH / 2 + Math.sin(a) * VH, 96, VH - 100);
      ctx.translate(ex, ey); ctx.rotate(a);
      glow(m.color, 10); ctx.fillStyle = m.down ? '#ff3344' : m.color;
      ctx.globalAlpha = m.main ? 0.95 : 0.7;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.rotate(-a); noGlow();
      if (m.label) monoText(m.label, -Math.cos(a) * 18, -Math.sin(a) * 18 + 4, m.color, 'center', 11);
    }
    ctx.restore();
  }
}

// Мини-игра завала: полоска с бегущим маркером и зелёной зоной
function drawDebrisGame(p) {
  if (!p) return;
  const o = G.objs.find((q) => q.k === 'debris' && !q.done && q.eng && q.eng.includes(p.idx));
  if (!o) return;
  const w = 320, x = VW / 2 - w / 2, y = VH - 150;
  panel(x - 12, y - 34, w + 24, 76, '#ffb000');
  hudText(`ЗАВАЛ: ${o.prog}/${DG_NEED}`, VW / 2, y - 14, 14, '#ffb000', 'center', 8);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, 16);
  ctx.fillStyle = 'rgba(61,255,138,0.35)'; ctx.fillRect(x + w * DG_WIN[0], y, w * (DG_WIN[1] - DG_WIN[0]), 16);
  if (o.eng.length >= 2) {
    const ph = debrisPhase(o);
    ctx.fillStyle = '#ffffff'; glow('#ffffff', 10);
    ctx.fillRect(x + w * ph - 2, y - 4, 4, 24); noGlow();
    monoText('Жмите E, когда маркер в зелёной зоне — оба в один заход', VW / 2, y + 34, '#cfc6ff', 'center');
  } else monoText('Нужен второй боец: пусть тоже нажмёт E у завала', VW / 2, y + 34, '#ffb000', 'center');
  if (G.dgFlash && G.dgFlash.t > 0) {
    hudText(G.dgFlash.ok ? 'ЕСТЬ!' : 'МИМО', VW / 2 + w / 2 + 40, y + 14, 16, G.dgFlash.ok ? '#3dff8a' : '#ff3344', 'center', 8);
  }
}

function drawSubs() {
  const list = G.subs.filter((s) => s.t > 0).slice(-3);
  let y = VH - 190;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.t * 2, (s.max - s.t) * 6 + 0.2);
    const lines = wrap(s.text, Math.min(760, VW - 80), "15px 'Russo One', sans-serif");
    for (let k = lines.length - 1; k >= 0; k--) {
      hudText(lines[k], VW / 2, y, 15, '#ffffff', 'center', 6);
      y -= 20;
    }
    hudText(s.who, VW / 2, y, 12, s.who === 'ПЕРЕХВАТ' || s.who === 'СУПЕР-B2' ? '#ff3344' : '#ffb000', 'center', 6);
    y -= 26;
    ctx.restore();
  }
}

// Диалог и мини-игра сканера
function drawUi(p) {
  const u = G.ui;
  if (!u) return;
  if (u.kind === 'dialog') {
    const w = Math.min(620, VW - 40), x = VW / 2 - w / 2;
    const lines = [];
    for (const l of u.lines) lines.push(...wrap(l, w - 40, '14px Consolas, monospace'));
    const h = 70 + lines.length * 20 + u.opts.length * 24;
    const y = VH / 2 - h / 2;
    panel(x, y, w, h, '#ffb000', 0.92);
    hudText(u.who, x + 20, y + 30, 16, '#ffb000', 'left', 8);
    lines.forEach((l, i) => monoText(l, x + 20, y + 56 + i * 20, '#e9e6ff', 'left', 14));
    u.opts.forEach((o, i) => hudText(`${i + 1} — ${o.text}`, x + 20, y + 66 + lines.length * 20 + i * 24, 14, '#3dff8a', 'left', 6));
    return;
  }
  if (u.kind === 'scan') {
    const w = Math.min(560, VW - 40), h = 230, x = VW / 2 - w / 2, y = VH / 2 - h / 2;
    panel(x, y, w, h, '#4da6ff', 0.94);
    hudText(`СКАНЕР ТОННЕЛЕЙ · СЕГМЕНТ ${u.stage + 1}/3`, x + 20, y + 30, 16, '#4da6ff', 'left', 8);
    monoText('Двигайте мышь влево-вправо: совместите свою волну с отражённым сигналом и держите', x + 20, y + 52, '#cfc6ff');
    const gx = x + 20, gy = y + 120, gw = w - 40;
    const wave = (freq, col, amp) => {
      ctx.strokeStyle = col; ctx.lineWidth = 2; glow(col, 8);
      ctx.beginPath();
      for (let i = 0; i <= gw; i += 3) {
        const v = Math.sin(i * (0.02 + freq * 0.12) + G.time * 4) * amp;
        if (i === 0) ctx.moveTo(gx + i, gy + v); else ctx.lineTo(gx + i, gy + v);
      }
      ctx.stroke(); noGlow();
    };
    wave(u.tgt || u.target, '#ff9f1a', 34);
    wave(u.cur, '#4da6ff', 30);
    drawBar(gx, y + h - 40, gw, 10, u.lock, '#3dff8a', 'СИНХРОНИЗАЦИЯ');
    monoText('ESC — отмена', x + w - 20, y + 30, '#7d74a0', 'right');
  }
}

function drawBriefing() {
  const b = G.brief;
  const L = LEVELS[b.lv];
  ctx.fillStyle = `rgba(3,2,8,${clamp(1.2 - Math.max(0, b.t - 11) * 1.2, 0, 0.92)})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.globalAlpha = clamp(1.2 - Math.max(0, b.t - 11) * 1.2, 0, 1);
  hudText('БРИФИНГ', VW / 2, VH / 2 - 120, 16, '#7d74a0', 'center', 4);
  hudText(L.name, VW / 2, VH / 2 - 80, 34, L.color, 'center', 20);
  L.briefing.forEach((line, i) => {
    const k = clamp((b.t - 0.6 - i * 1.4) * 2, 0, 1);
    ctx.globalAlpha = k * clamp(1.2 - Math.max(0, b.t - 11) * 1.2, 0, 1);
    wrap(line, Math.min(720, VW - 60), "15px 'Russo One', sans-serif").forEach((l, j) => hudText(l, VW / 2, VH / 2 - 30 + i * 46 + j * 20, 15, '#e9e6ff', 'center', 4));
  });
  ctx.globalAlpha = 0.7;
  monoText('ENTER — пропустить', VW / 2, VH - 40, '#7d74a0', 'center', 12);
  ctx.restore();
}

function drawCrosshair() {
  const p = me();
  const c = p ? charColor(p.ch) : '#fff';
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  glow(c, 10);
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.moveTo(-14, 0); ctx.lineTo(-5, 0); ctx.moveTo(5, 0); ctx.lineTo(14, 0);
  ctx.moveTo(0, -14); ctx.lineTo(0, -5); ctx.moveTo(0, 5); ctx.lineTo(0, 14);
  ctx.stroke();
  // хитмаркер: белый — попал, красный — убил, серый — броня
  if (G.hitmark && G.hitmark.t > 0) {
    const k = G.hitmark.k;
    const hc = k === 1 ? '#ff3344' : k === 2 ? '#8a8aa0' : '#ffffff';
    ctx.strokeStyle = hc; glow(hc, 8); ctx.lineWidth = k === 1 ? 3 : 2;
    const s = 6 + (0.25 - G.hitmark.t) * 20;
    ctx.beginPath();
    ctx.moveTo(-s - 6, -s - 6); ctx.lineTo(-s, -s); ctx.moveTo(s + 6, -s - 6); ctx.lineTo(s, -s);
    ctx.moveTo(-s - 6, s + 6); ctx.lineTo(-s, s); ctx.moveTo(s + 6, s + 6); ctx.lineTo(s, s);
    ctx.stroke();
  }
  ctx.restore();
}
