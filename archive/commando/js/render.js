'use strict';
// ---------- Отрисовка мира ----------

function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
function noGlow() { ctx.shadowBlur = 0; }

const fogC = document.createElement('canvas'), fogX = fogC.getContext('2d');
const visC = document.createElement('canvas'), visX = visC.getContext('2d');
const polyC = document.createElement('canvas'), polyX = polyC.getContext('2d');
const VIS_RAYS = 540;

// Чьими глазами видно: свой герой, напарники рядом и те, с кем есть связь по рации
function fogViewers() {
  const m = me();
  if (!m) return [];
  const diag = Math.hypot(VW, VH);
  const res = [];
  for (const p of G.players) {
    if (p !== m) {
      if (!FOG_SHARED) continue;
      const linked = Math.hypot(p.x - m.x, p.y - m.y) < 900 || (radioAt(p.x, p.y) && radioAt(m.x, m.y));
      if (!linked) continue;
      if (Math.hypot(p.rx - G.cam.x, p.ry - G.cam.y) > diag * 1.3) continue;
    }
    res.push({ x: p.rx, y: p.ry, a: p.a, lamp: p.lamp && !p.down, down: p.down });
  }
  return res;
}

// 0..1 — насколько видна точка. Нужна прямая видимость от кого-то из своих.
// Светлая зона: этого достаточно. Темнота: конус фонаря или маленький радиус вокруг героя.
function visibility(x, y, viewers, selfLit) {
  let seen = false;
  for (const v of viewers) if (los(v.x, v.y, x, y)) { seen = true; break; }
  if (!seen) return 0;
  if (!darkAt(x, y) || selfLit) return 1;
  let best = 0;
  for (const v of viewers) {
    const d = Math.hypot(x - v.x, y - v.y);
    best = Math.max(best, clamp((AMBIENT_R - d) / (AMBIENT_R * 0.4), 0, 1));
    if (v.lamp && d < FLASH_RANGE) {
      const off = Math.abs(angDiff(Math.atan2(y - v.y, x - v.x), v.a));
      const k = clamp((FLASH_HALF + 0.06 - off) / 0.12, 0, 1) * clamp((FLASH_RANGE - d) / (FLASH_RANGE * 0.3), 0, 1);
      best = Math.max(best, k);
    }
  }
  return best;
}

function drawVisPolygon(g, ox, oy, offX, offY, maxR) {
  g.beginPath();
  for (let i = 0; i < VIS_RAYS; i++) {
    const a = (i / VIS_RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const d = Math.min(maxR, castRay(ox, oy, dx, dy, maxR) + 8);
    const x = ox + dx * d + offX, y = oy + dy * d + offY;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

function drawFog(offX, offY, viewers) {
  for (const c of [fogC, visC, polyC]) if (c.width !== VW || c.height !== VH) { c.width = VW; c.height = VH; }
  fogX.globalCompositeOperation = 'source-over';
  fogX.clearRect(0, 0, VW, VH);
  fogX.fillStyle = 'rgba(2,1,6,0.93)';
  fogX.fillRect(0, 0, VW, VH);
  const sx = -offX, sy = -offY;

  polyX.clearRect(0, 0, VW, VH);
  polyX.fillStyle = '#fff';
  const maxR = Math.hypot(VW, VH);
  for (const v of viewers) drawVisPolygon(polyX, v.x, v.y, offX, offY, maxR);

  // 1) светлые зоны: прямая видимость ∩ маска светлых зон
  visX.globalCompositeOperation = 'source-over';
  visX.clearRect(0, 0, VW, VH);
  visX.drawImage(polyC, 0, 0);
  visX.globalCompositeOperation = 'destination-in';
  drawMask(visX, map.litMask, sx, sy);
  fogX.globalCompositeOperation = 'destination-out';
  fogX.drawImage(visC, 0, 0);

  // 2) темнота: конусы фонарей + малый радиус вокруг героев + вспышки выстрелов ∩ маска темноты ∩ видимость
  visX.globalCompositeOperation = 'source-over';
  visX.clearRect(0, 0, VW, VH);
  for (const v of viewers) {
    const x = v.x + offX, y = v.y + offY;
    radial(visX, x, y, AMBIENT_R, 0.6);
    if (v.lamp) {
      const g = visX.createRadialGradient(x, y, 10, x, y, FLASH_RANGE);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      visX.fillStyle = g;
      visX.globalAlpha = 0.55;
      wedge(visX, x, y, FLASH_RANGE, v.a, FLASH_HALF);
      visX.globalAlpha = 1;
      wedge(visX, x, y, FLASH_RANGE, v.a, FLASH_HALF * 0.75);
    }
  }
  // вспышки выстрелов освещают округу
  for (const e of G.enemies) if (!e.dead && e.flashT > 0 && darkAt(e.x, e.y)) radial(visX, e.x + offX, e.y + offY, 70, 0.5);
  for (const p of G.players) if (p.flashT > 0 && darkAt(p.x, p.y)) radial(visX, p.rx + offX, p.ry + offY, 90, 0.5);
  visX.globalCompositeOperation = 'destination-in';
  drawMask(visX, map.darkMask, sx, sy);
  visX.drawImage(polyC, 0, 0);
  fogX.drawImage(visC, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(fogC, 0, 0);
  ctx.restore();
}
function radial(g, x, y, r, inner) {
  const gr = g.createRadialGradient(x, y, r * inner, x, y, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}
function wedge(g, x, y, r, a, half) {
  g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a - half, a + half); g.closePath(); g.fill();
}
// Кусок большой маски/карты, попадающий на экран
function drawMask(g, img, sx, sy) {
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(img.width, sx + VW), y1 = Math.min(img.height, sy + VH);
  if (x1 <= x0 || y1 <= y0) return;
  g.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
}

const onScreen = (x, y, pad = 60) => Math.abs(x - G.cam.x) < VW / 2 + pad && Math.abs(y - G.cam.y) < VH / 2 + pad;

function render(dt = 1 / 60) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05030a';
  ctx.fillRect(0, 0, VW, VH);
  if (G.role === 'none' || !map || G.state === 'lobby') { renderMenuBackdrop(); return; }

  const shx = rand(-G.shake, G.shake), shy = rand(-G.shake, G.shake);
  const offX = Math.round(VW / 2 - G.cam.x + shx), offY = Math.round(VH / 2 - G.cam.y + shy);
  ctx.setTransform(1, 0, 0, 1, offX, offY);
  const viewers = fogViewers();

  {
    // видимый кусок заранее отрисованной карты (координаты мира)
    const wx = -offX, wy = -offY, mc = map.canvas;
    const x0 = Math.max(0, wx), y0 = Math.max(0, wy), x1 = Math.min(mc.width, wx + VW), y1 = Math.min(mc.height, wy + VH);
    if (x1 > x0 && y1 > y0) ctx.drawImage(mc, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  for (const d of G.decals) if (onScreen(d.x, d.y)) drawDecal(d);
  for (const o of G.objs) if (onScreen(o.x, o.y, 120)) drawObj(o);
  for (const s of G.speeders) if (onScreen(s.x, s.y)) drawSpeeder(s);
  for (const e of G.enemies) if (e.dead && onScreen(e.rx, e.ry)) drawCorpse(e);
  for (const a of G.allies) if (a.dead && onScreen(a.rx, a.ry)) drawAllyCorpse(a);
  for (const n of G.nades) drawNade(n);
  for (const e of G.enemies) {
    if (e.dead || !onScreen(e.rx, e.ry)) { e.va = 0; continue; }
    const target = visibility(e.rx, e.ry, viewers, e.flashT > 0);
    if (e.va === undefined) e.va = target;
    e.va += (target - e.va) * Math.min(1, dt * 14);
    if (e.va > 0.01) drawEnemy(e, e.va);
  }
  for (const a of G.allies) {
    if (a.dead || !onScreen(a.rx, a.ry)) continue;
    const v = visibility(a.rx, a.ry, viewers, true);
    if (a.va === undefined) a.va = v;
    a.va += (v - a.va) * Math.min(1, dt * 14);
    if (a.va > 0.01) drawAlly(a, a.va);
  }
  for (const p of G.players) drawPlayer(p);
  drawFog(offX, offY, viewers);

  // поверх тумана: свет фонарей, отметки, шум, выстрелы, частицы
  drawLampGlow();
  drawOverlayObjs();
  drawPatrols();
  drawMarked();
  drawRings();
  drawBullets();
  drawParticles();
  drawWorldPrompts();
  drawLaser();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();
  drawCrosshair();
}

function renderMenuBackdrop() {
  const t = G.time;
  for (let i = 0; i < 140; i++) {
    const x = ((i * 137.5 + t * (10 + (i % 7) * 6)) % (VW + 40)) - 20;
    const y = (i * 71.3) % VH;
    ctx.fillStyle = i % 9 === 0 ? '#ffb000' : i % 5 === 0 ? '#33ccff' : '#ffffff';
    ctx.globalAlpha = 0.3 + (i % 4) * 0.15;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawDecal(d) {
  const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
  g.addColorStop(0, rgba(d.color, d.kind === 2 ? 0.55 : 0.3));
  g.addColorStop(1, rgba(d.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
}

// ---------- Объекты ----------
function drawObj(o) {
  ctx.save();
  switch (o.k) {
    case 'debris': drawDebris(o); break;
    case 'gate': drawGate(o); break;
    case 'camera': drawCamera(o); break;
    case 'console': {
      ctx.translate(o.x, o.y);
      glow(o.done ? '#555' : '#ff3344', o.done ? 0 : 12);
      ctx.fillStyle = '#1a1022'; ctx.strokeStyle = o.done ? '#555' : '#ff3344'; ctx.lineWidth = 2;
      ctx.fillRect(-12, -9, 24, 18); ctx.strokeRect(-12, -9, 24, 18);
      ctx.fillStyle = o.done ? '#333' : (Math.sin(G.time * 6) > 0 ? '#ff3344' : '#ffb000');
      ctx.fillRect(-8, -5, 16, 6);
      break;
    }
    case 'table': {
      ctx.translate(o.x, o.y - 16);
      ctx.strokeStyle = o.done ? '#665' : '#ffb000'; glow('#ffb000', o.done ? 0 : 8);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-14, -8, 28, 14);
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-2, 2); ctx.lineTo(6, -5); ctx.lineTo(11, 3); ctx.stroke();
      break;
    }
    case 'item': {
      if (o.done) break;
      ctx.translate(o.x, o.y);
      const s = 1 + Math.sin(G.time * 4) * 0.12;
      glow('#c77dff', 18); ctx.fillStyle = '#c77dff';
      ctx.beginPath(); ctx.moveTo(0, -10 * s); ctx.lineTo(7 * s, 0); ctx.lineTo(0, 10 * s); ctx.lineTo(-7 * s, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'npc': drawNpc(o); break;
    case 'crate': {
      ctx.translate(o.x, o.y);
      glow('#4da6ff', o.done ? 0 : 12);
      ctx.strokeStyle = '#4da6ff'; ctx.fillStyle = '#0c1a26'; ctx.lineWidth = 2;
      ctx.fillRect(-13, -10, 26, 20); ctx.strokeRect(-13, -10, 26, 20);
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke();
      if (!o.done) { ctx.globalAlpha = 0.5 + Math.sin(G.time * 5) * 0.4; ctx.beginPath(); ctx.arc(0, 0, 9 + (G.time * 12) % 10, 0, Math.PI * 2); ctx.stroke(); }
      break;
    }
    case 'container': {
      ctx.translate(o.x, o.y);
      ctx.strokeStyle = o.done ? '#ff5a5a' : '#c0603a'; ctx.lineWidth = 2; glow('#ff5a5a', o.done ? 16 : 4);
      ctx.strokeRect(-48, -38, 96, 64);
      ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(-48, 26); ctx.lineTo(48, 26); ctx.stroke(); ctx.setLineDash([]);
      if (o.done) { ctx.globalAlpha = 0.25; ctx.fillStyle = '#ff5a5a'; ctx.fillRect(-30, 14, 60, 18); }
      break;
    }
    case 'fire': {
      ctx.translate(o.x, o.y);
      ctx.strokeStyle = '#6a4a30'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(10, 6); ctx.moveTo(-10, 6); ctx.lineTo(10, -6); ctx.stroke();
      ctx.fillStyle = 'rgba(120,120,120,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,90,30,0.35)'; ctx.beginPath(); ctx.arc(rand(-2, 2), rand(-2, 2), 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'bush': {
      ctx.translate(o.x, o.y);
      ctx.fillStyle = 'rgba(40,90,40,0.75)'; ctx.strokeStyle = '#3dff8a'; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + o.id;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 9, Math.sin(a) * 9, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'rv': {
      ctx.translate(o.x, o.y);
      ctx.strokeStyle = '#3dff8a'; ctx.globalAlpha = 0.25 + Math.sin(G.time * 2) * 0.1; ctx.setLineDash([8, 10]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, o.r * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      break;
    }
  }
  ctx.restore();
}

function drawDebris(o) {
  if (o.done) return;
  const rng = makeRng(o.id * 977);
  const shake = o.prog > 0 ? Math.sin(G.time * 40) * (o.eng && o.eng.length >= 2 ? 1 : 0) : 0;
  for (const [tx, ty] of o.tiles) {
    const X = tx * TILE + 16 + shake, Y = ty * TILE + 16;
    for (let k = 0; k < 2; k++) {
      const cx = X + (rng() - 0.5) * 16, cy = Y + (rng() - 0.5) * 16, r = 9 + rng() * 8;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rng(), rr = r * (0.7 + rng() * 0.4);
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = k ? '#3a2a24' : '#2c201c'; ctx.fill();
      ctx.strokeStyle = '#a07a5a'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // трещины по мере разбора
  ctx.strokeStyle = '#ffb000'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
  for (let i = 0; i < o.prog * 2; i++) {
    const a = rng() * 6, r = 20 + rng() * 30;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawGate(o) {
  const hatch = o.name === 'hatch' || o.name === 'tunnelIn';
  const c = o.open ? '#3dff8a' : hatch ? '#ffb000' : '#ff3344';
  glow(c, o.open ? 4 : 12);
  ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.globalAlpha = o.open ? 0.3 : 0.9;
  for (const [tx, ty] of o.tiles) {
    const X = tx * TILE, Y = ty * TILE;
    if (o.open) { ctx.strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6); continue; }
    ctx.fillStyle = rgba(c, 0.15); ctx.fillRect(X, Y, TILE, TILE);
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(X + k * 8, Y + 2); ctx.lineTo(X + k * 8, Y + TILE - 2); ctx.stroke(); }
  }
}

function drawCamera(o) {
  ctx.translate(o.x, o.y);
  const off = !o.on;
  if (!off) {
    const c = o.seen > 0 ? '#ff3344' : '#ffd000';
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, CAM_RANGE);
    g.addColorStop(0, rgba(c, 0.2 + o.seen * 0.25));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, CAM_RANGE, o.ang - CAM_HALF, o.ang + CAM_HALF); ctx.closePath(); ctx.fill();
  }
  ctx.rotate(o.ang);
  glow(off ? '#333' : '#ff3344', off ? 0 : 10);
  ctx.fillStyle = '#1a1a22'; ctx.strokeStyle = off ? '#555' : '#ff3344'; ctx.lineWidth = 2;
  ctx.fillRect(-7, -6, 16, 12); ctx.strokeRect(-7, -6, 16, 12);
  ctx.fillStyle = off ? '#333' : (Math.sin(G.time * 8) > 0 ? '#ff3344' : '#550000');
  ctx.beginPath(); ctx.arc(10, 0, 3, 0, Math.PI * 2); ctx.fill();
}

function drawNpc(o) {
  ctx.translate(o.x, o.y);
  const c = o.role === 'glasses' ? '#7dd8ff' : '#ffb04d';
  ctx.rotate(Math.sin(G.time * 0.7 + o.id) * 0.6 + Math.PI / 2);
  drawBugBody(c, 1, 0, false);
  if (o.role === 'glasses') {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(13, -3, 2.6, 0, Math.PI * 2); ctx.arc(13, 3, 2.6, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(22, 7); ctx.stroke();
  }
}

function drawSpeeder(s) {
  const x = s.rx !== undefined ? s.rx : s.x, y = s.ry !== undefined ? s.ry : s.y;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(s.a);
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > 40) {
    ctx.globalAlpha = Math.min(0.6, sp / 500);
    glow('#33ccff', 14);
    ctx.fillStyle = '#33ccff'; ctx.fillRect(-30, -3, 8, 6);
    ctx.globalAlpha = 1;
  }
  glow('#cfe8ff', 8);
  ctx.fillStyle = '#1b2230'; ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(34, 0); ctx.lineTo(20, -10); ctx.lineTo(-26, -10); ctx.lineTo(-32, 0); ctx.lineTo(-26, 10); ctx.lineTo(20, 10); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#33ccff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-26, -5); ctx.lineTo(16, -5); ctx.moveTo(-26, 5); ctx.lineTo(16, 5); ctx.stroke();
  ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(22, -14); ctx.lineTo(22, 14); ctx.stroke();      // рули
  noGlow();
  ctx.restore();
}

// ---------- Враги ----------
function drawCorpse(e) {
  if (!ETYPES[e.t]) return;
  const T = ETYPES[e.t];
  ctx.save();
  ctx.translate(e.rx, e.ry); ctx.rotate(e.a);
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = T.color; ctx.lineWidth = 2;
  const r = T.r;
  ctx.beginPath(); ctx.ellipse(0, 0, r + 3, r - 3, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
  ctx.restore();
}

function drawBugBody(c, frac, legs, armed) {
  // брюшко, грудь, голова с жвалами, 6 лап
  const lost = frac < 0.67;
  ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      if (lost && side === 1 && i === 1) continue;       // оторванная лапа
      const sw = Math.sin(legs + i * 2 + (side > 0 ? 0 : Math.PI)) * 0.35;
      const bx = -4 + i * 5;
      ctx.beginPath(); ctx.moveTo(bx, side * 5);
      ctx.lineTo(bx + 4 + sw * 6, side * 12); ctx.lineTo(bx + 1 + sw * 8, side * 16); ctx.stroke();
    }
  }
  glow(c, 10);
  ctx.fillStyle = '#121a0e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(-6, 0, 8, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(4, 0, 5.5, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  noGlow();
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(11, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(13, -2); ctx.lineTo(17, -4); ctx.moveTo(13, 2); ctx.lineTo(17, 4); ctx.stroke();
  if (frac < 0.34) {
    // трещины в хитине и капли
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha *= 0.7; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-5, 1); ctx.lineTo(-2, -2); ctx.stroke();
    ctx.fillStyle = BUG_GOO; ctx.beginPath(); ctx.arc(-8, 4, 2, 0, Math.PI * 2); ctx.fill();
  }
  if (armed) { ctx.strokeStyle = '#9aa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(18, 7); ctx.stroke(); }
}

function drawDroid(e, c, frac, T) {
  const k = e.t;
  if (k === 'K') {
    // B2: широкие плечи, руки-бластеры, броня спереди
    const armless = frac < 0.34;
    ctx.strokeStyle = '#8a8aa0'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(4, -13); ctx.lineTo(18, -13); ctx.stroke();
    if (!armless) { ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(18, 13); ctx.stroke(); }
    else { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(2, 13); ctx.lineTo(7, 13); ctx.stroke(); }
    glow(c, 12);
    ctx.fillStyle = '#141826'; ctx.strokeStyle = c; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(-11, -15, 20, 30, 6); ctx.fill(); ctx.stroke();
    noGlow();
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha *= 0.8; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, -12); ctx.lineTo(9, 12); ctx.stroke();    // лобовая броня
    ctx.globalAlpha /= 0.8;
    ctx.fillStyle = c; ctx.fillRect(-3, -4, 7, 8);
    if (frac < 0.6) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(-4, -7, 2.5, 0, 7); ctx.arc(-2, 8, 2, 0, 7); ctx.fill(); }
    return;
  }
  // B1 / связист: тонкое тело, вытянутая голова
  const armLost = frac <= 0.5;
  ctx.strokeStyle = '#9a8a6a'; ctx.lineWidth = 2.5;
  if (k !== 'C') { ctx.beginPath(); ctx.moveTo(2, 6); ctx.lineTo(17, 5); ctx.stroke(); }
  if (!armLost) { ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(10, -8); ctx.stroke(); }
  else { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(5, -7); ctx.stroke(); }
  if (k === 'C') {
    ctx.fillStyle = '#3a3020'; ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    ctx.fillRect(-14, -6, 7, 12); ctx.strokeRect(-14, -6, 7, 12);
    ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(-16, -15); ctx.stroke();
    if (e.st === 2 && Math.sin(G.time * 12) > 0) { ctx.fillStyle = '#ff3344'; ctx.beginPath(); ctx.arc(-16, -15, 2.5, 0, 7); ctx.fill(); }
  }
  glow(c, 10);
  ctx.fillStyle = '#1e1a12'; ctx.strokeStyle = c; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(-2, 0, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  noGlow();
  const tilt = armLost ? 0.25 : 0;
  ctx.save(); ctx.rotate(tilt);
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.ellipse(8, 0, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (armLost && Math.random() < 0.06) addPart(e.rx + rand(-4, 4), e.ry + rand(-4, 4), rand(-60, 60), rand(-60, 60), 0.2, '#ffd28a', 1.5);
}

function drawWorm(e, c) {
  const n = 5;
  ctx.fillStyle = '#1a0f22'; ctx.strokeStyle = c; ctx.lineWidth = 1.8;
  glow(c, 8);
  for (let i = n - 1; i >= 0; i--) {
    const w = Math.sin(G.time * 8 + i * 0.9 + e.id) * 3 * (i / n);
    const r = 7 - i * 0.9;
    ctx.beginPath(); ctx.arc(-i * 7, w, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  noGlow();
  ctx.fillStyle = e.wind > 0 ? '#fff' : c;
  ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(12, 0); ctx.lineTo(6, 4); ctx.closePath(); ctx.fill();
}

function drawBoss(e, c) {
  const T = ETYPES.X;
  const off = e.off;
  const heat = clamp((e.heat || 0) / BOSS_HEAT_MAX, 0, 1);
  const col = off ? '#666' : c;
  // правая рука — пушка (или обрубок)
  if (!e.armless) {
    const hc = e.bst === 'jam' ? '#ff8800' : heat > 0.6 ? '#ffb000' : '#aab';
    ctx.strokeStyle = hc; ctx.lineWidth = 10; glow(hc, heat * 25);
    ctx.beginPath(); ctx.moveTo(6, 22); ctx.lineTo(44, 22); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#222';
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(36 + Math.sin(G.time * 30 * e.spin + k) * 2, 18 + k * 4); ctx.lineTo(46, 18 + k * 4); ctx.stroke(); }
    noGlow();
  } else {
    ctx.strokeStyle = '#555'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(6, 22); ctx.lineTo(15, 23); ctx.stroke();
    if (Math.random() < 0.3) addPart(e.rx + Math.cos(e.a + 1.2) * 24, e.ry + Math.sin(e.a + 1.2) * 24, rand(-80, 80), rand(-80, 80), 0.3, '#ffb000', 2);
  }
  // левый кулак
  const punch = e.wind > 0 ? 8 : 0;
  ctx.fillStyle = '#2a2a36'; ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(14 + punch, -24, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // корпус
  glow(col, off ? 0 : 18);
  ctx.fillStyle = '#18141e'; ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(-20, -26, 36, 52, 10); ctx.fill(); ctx.stroke();
  noGlow();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.globalAlpha *= 0.85;
  ctx.beginPath(); ctx.moveTo(16, -22); ctx.lineTo(16, 22); ctx.stroke();      // лобовая броня
  ctx.globalAlpha /= 0.85;
  // спина: светящийся уязвимый блок
  ctx.fillStyle = off ? '#333' : (Math.sin(G.time * 6) > 0 ? '#ffb000' : '#ff6a00');
  ctx.fillRect(-20, -10, 6, 20);
  ctx.fillStyle = off ? '#300' : '#ff2020';
  ctx.fillRect(6, -6, 7, 12);    // визор
}

function drawEnemy(e, vis) {
  const T = ETYPES[e.t];
  const frac = e.hp / (e.maxHp || T.hp);
  const c = e.flash > 0 ? '#ffffff' : T.color;
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.translate(e.rx, e.ry);
  // конус обзора у спокойных — подсказка для скрытности
  if (e.st === 0 && T.fac === 'sep' && !T.boss) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 120, e.a - 1.05, e.a + 1.05); ctx.closePath(); ctx.fill();
  }
  ctx.rotate(e.a);
  if (T.kind === 'bug') drawBugBody(c, frac, G.time * 14 + e.id, true);
  else if (T.kind === 'worm') drawWorm(e, c);
  else if (T.kind === 'boss') { ctx.scale(1.3, 1.3); drawBoss(e, c); }
  else drawDroid(e, c, frac, T);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = vis;
  if (e.stun > 0) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const a = G.time * 6 + i * 2.1;
      ctx.fillRect(e.rx + Math.cos(a) * 14 - 1.5, e.ry - 18 + Math.sin(a) * 4 - 1.5, 3, 3);
    }
  }
  // «!» тревога, «?» насторожен; кольцо вокруг «!» — сколько осталось до тревоги в районе
  const mark = e.alertT > 0 || (e.st === 2 && T.fac === 'sep' && !T.boss) ? '!' : e.st === 1 ? '?' : '';
  if (mark && !T.boss) {
    const mc = mark === '!' ? '#ff3344' : '#ffd000';
    ctx.fillStyle = mc; glow(mc, 10);
    ctx.font = "18px 'Russo One', sans-serif"; ctx.textAlign = 'center';
    ctx.fillText(mark, e.rx, e.ry - T.r - 9);
    if (mark === '!' && e.alarmT > 0 && T.fac === 'sep' && G.m && !(e.zone === 'out' ? G.m.alarm : G.m.cenAlarm) && (e.zone === 'out' || e.zone === 'cen')) {
      ctx.strokeStyle = mc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.rx, e.ry - T.r - 15, 12, -Math.PI / 2, -Math.PI / 2 + (e.alarmT / ALARM_DELAY) * Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- Союзники ----------
function drawAlly(a, vis) {
  const A = ATYPES[a.t];
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.translate(a.rx, a.ry);
  ctx.rotate(a.a);
  if (a.t === 'merc') { drawBugBody(a.flash > 0 ? '#fff' : A.color, a.hp / a.maxHp, G.time * 14, true); ctx.restore(); return; }
  ctx.strokeStyle = '#c8c8d8'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(20, 4); ctx.stroke();
  const c = a.flash > 0 ? '#ff8888' : A.color;
  const stripe = a.captain ? '#ff9f1a' : a.tech ? '#ffd000' : A.mark;
  glow(stripe, 12);
  ctx.fillStyle = '#20222c'; ctx.strokeStyle = c; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, A.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  noGlow();
  ctx.strokeStyle = stripe; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, A.r - 4, -1.2, 1.2); ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.fillRect(4, -5, 3, 10); ctx.fillRect(4, -1.5, 7, 3);    // Т-образный визор
  ctx.restore();
  if (a.captain) {
    ctx.save(); ctx.globalAlpha = vis * 0.8;
    ctx.font = "10px 'Russo One', sans-serif"; ctx.textAlign = 'center'; ctx.fillStyle = '#ff9f1a';
    ctx.fillText('КАПИТАН', a.rx, a.ry - 18);
    ctx.restore();
  }
}
function drawAllyCorpse(a) {
  ctx.save();
  ctx.translate(a.rx, a.ry);
  ctx.globalAlpha = 0.35; ctx.strokeStyle = ATYPES[a.t].color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
  ctx.restore();
}

// ---------- Герои ----------
function drawPlayer(p) {
  const c = charColor(p.ch);
  ctx.save();
  ctx.translate(p.rx, p.ry);
  if (p.down) {
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
    ctx.globalAlpha = 0.35 + Math.sin(G.time * 5) * 0.2;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
    if (p.revive > 0) {
      ctx.globalAlpha = 1; glow(c, 12); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + (p.revive / REVIVE_TIME) * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  ctx.rotate(p.a);
  // оружие
  const w = CHARS[p.ch].weapon;
  ctx.strokeStyle = '#c8c8d8'; ctx.lineWidth = w === 'scatter' ? 6 : w === 'smg' ? 3.5 : 4;
  const L = w === 'sniper' ? 30 : w === 'smg' ? 17 : 22;
  ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(L, 4); ctx.stroke();
  if (p.mel > 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 22, -0.9, 0.9); ctx.stroke(); }
  // тело — броня коммандос, Т-визор
  glow(c, 16);
  ctx.fillStyle = rgba(c, 0.2);
  ctx.strokeStyle = c; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, PR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  noGlow();
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(3, -6, 3, 12); ctx.fillRect(3, -1.5, 8, 3);
  if (p.lamp) { ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(8, -6, 1.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();

  // имя, говорит, рация
  ctx.save();
  ctx.font = "10px 'Russo One', sans-serif"; ctx.textAlign = 'center';
  if (p.idx !== G.myIdx) {
    ctx.fillStyle = rgba(c, 0.85);
    ctx.fillText(`${CHARS[p.ch].letter}${p.bot ? ' · бот' : ' · ' + p.name}`, p.rx, p.ry - 18);
  }
  if (p.talk > 0 || p.rad) {
    ctx.fillStyle = p.rad ? '#ffb000' : '#3dff8a';
    ctx.fillText(p.rad ? '📻' : '🔊', p.rx + 16, p.ry - 10);
  }
  if (p.hp < PLAYER_HP) {
    for (let i = 0; i < PLAYER_HP; i++) {
      ctx.fillStyle = i < p.hp ? c : 'rgba(255,255,255,0.15)';
      ctx.fillRect(p.rx - 12 + i * 6.5, p.ry + 15, 5, 3);
    }
  }
  ctx.restore();
}

// Свет фонарей: тёплый конус поверх тумана, обрезанный стенами
function lampPath(x, y, a) {
  const n = 48;
  ctx.beginPath(); ctx.moveTo(x, y);
  for (let i = 0; i <= n; i++) {
    const aa = a - FLASH_HALF + (i / n) * FLASH_HALF * 2;
    const d = Math.min(FLASH_RANGE, castRay(x, y, Math.cos(aa), Math.sin(aa), FLASH_RANGE) + 4);
    ctx.lineTo(x + Math.cos(aa) * d, y + Math.sin(aa) * d);
  }
  ctx.closePath();
}
function drawLampGlow() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.players) {
    if (p.down || !p.lamp || !darkAt(p.rx, p.ry) || !onScreen(p.rx, p.ry, FLASH_RANGE)) continue;
    const g = ctx.createRadialGradient(p.rx, p.ry, 8, p.rx, p.ry, FLASH_RANGE);
    g.addColorStop(0, 'rgba(255,240,200,0.10)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g;
    lampPath(p.rx, p.ry, p.a);
    ctx.fill();
  }
  ctx.restore();
}

// Поверх тумана: площадка вылета, светящиеся метки
function drawOverlayObjs() {
  for (const o of G.objs) {
    if (o.k !== 'pad') continue;
    const L = LEVELS[o.lv];
    const pr = G.progress && G.progress[o.lv];
    const X = o.x, Y = o.y;
    ctx.save();
    glow(L.color, 18);
    ctx.strokeStyle = L.color; ctx.lineWidth = 2;
    ctx.strokeRect(X - 28, Y - 28, 56, 56);
    ctx.globalAlpha = 0.15 + Math.sin(G.time * 3) * 0.08;
    ctx.fillStyle = L.color; ctx.fillRect(X - 28, Y - 28, 56, 56);
    ctx.globalAlpha = 1;
    if (G.pad && G.pad.t > 0) {
      ctx.lineWidth = 4; ctx.beginPath();
      ctx.arc(X, Y, 36, -Math.PI / 2, -Math.PI / 2 + (G.pad.t / PAD_HOLD) * Math.PI * 2); ctx.stroke();
    }
    noGlow();
    ctx.textAlign = 'center';
    ctx.font = "13px 'Russo One', sans-serif"; ctx.fillStyle = '#ffffff';
    ctx.fillText('МИССИЯ 1', X, Y - 52);
    ctx.font = "16px 'Russo One', sans-serif"; ctx.fillStyle = L.color;
    ctx.fillText(L.name, X, Y - 36);
    ctx.font = '11px Consolas, monospace'; ctx.fillStyle = pr && pr.done ? '#3dff8a' : '#b9b0d6';
    ctx.fillText(pr && pr.done ? `✓ ВЫПОЛНЕНА · ${pr.best}` : 'встаньте на площадку', X, Y + 46);
    ctx.restore();
  }
}

// Карта патрулей: маршруты видны поверх тумана
function drawPatrols() {
  if (!G.m || !G.m.patrolMap) return;
  ctx.save();
  ctx.setLineDash([5, 7]); ctx.lineWidth = 1.5;
  for (const e of G.enemies) {
    if (e.dead || !e.patrol || e.patrol.length < 2) continue;
    ctx.strokeStyle = rgba(ETYPES[e.t].color, 0.45);
    ctx.beginPath();
    e.patrol.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    if (e.patrol.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(ETYPES[e.t].color, 0.6);
    ctx.beginPath(); ctx.arc(e.rx, e.ry, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Метка снайпера: враг виден всем сквозь туман
function drawMarked() {
  ctx.save();
  for (const e of G.enemies) {
    if (e.dead || !(e.mark > 0)) continue;
    const r = ETYPES[e.t].r + 8;
    glow('#9dff3a', 10); ctx.strokeStyle = '#9dff3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(e.rx, e.ry - r); ctx.lineTo(e.rx + r, e.ry); ctx.lineTo(e.rx, e.ry + r); ctx.lineTo(e.rx - r, e.ry); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

function drawRings() {
  ctx.save();
  for (const r of G.rings) {
    const k = r.t / 0.6;
    const rad = r.r * (1 - (1 - k) * (1 - k));
    ctx.globalAlpha = (1 - k) * 0.3;
    ctx.strokeStyle = r.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawNade(n) {
  const col = n.kind === 'flash' ? '#ffffff' : n.kind === 'decoy' ? '#c77dff' : '#ff3d00';
  const blink = Math.sin(n.t * (10 + n.t * 25)) > 0;
  ctx.save();
  glow(col, blink ? 18 : 6);
  ctx.fillStyle = blink ? col : '#333';
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (n.kind === 'nade' && n.t > 0.45) {
    ctx.globalAlpha = 0.15; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(n.x, n.y, 105, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawBullets() {
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of G.bullets) {
    if (!onScreen(b.x, b.y)) continue;
    const c = b.side === 'e' ? ENEMY_BOLT : b.side === 'a' ? ALLY_BOLT : charColor(pById(b.o) ? pById(b.o).ch : 0);
    const tx = b.x - b.vx * 0.026, ty = b.y - b.vy * 0.026;
    glow(c, 14);
    ctx.strokeStyle = c; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    noGlow();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const q of G.parts) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    ctx.fillStyle = q.color;
    const s = q.size;
    if (q.shape) {
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      if (q.shape === 2) { ctx.strokeStyle = q.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke(); }
      else ctx.fillRect(-s / 2, -s / 3, s, s * 0.66);
      ctx.restore();
    } else ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
  }
  ctx.restore();
}

// Лазерный прицел снайпера
function drawLaser() {
  const p = me();
  if (!p || p.down || CHARS[p.ch].weapon !== 'sniper') return;
  const d = castRay(p.x, p.y, Math.cos(p.a), Math.sin(p.a), 900);
  ctx.save();
  ctx.strokeStyle = rgba('#9dff3a', 0.35 + (p.atkCd <= 0 ? 0.25 : 0)); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p.rx + Math.cos(p.a) * 30, p.ry + Math.sin(p.a) * 30); ctx.lineTo(p.rx + Math.cos(p.a) * d, p.ry + Math.sin(p.a) * d); ctx.stroke();
  ctx.restore();
}

// Подсказки взаимодействия рядом с героем (в мировых координатах)
function drawWorldPrompts() {
  const p = me();
  if (!p || p.down || G.ui) return;
  const near = p.near;
  if (near && near.info.mode !== 'ride' || near && p.ride < 0) {
    const o = near.o, info = near.info;
    const x = o ? o.x : p.x, y = o ? o.y : p.y;
    let text = `E — ${info.label}`;
    if (info.mode === 'debris') {
      text = o.eng && o.eng.includes(p.idx) ? (o.eng.length < 2 ? 'Ждём напарника…' : 'E — в зелёной зоне, вместе!') : 'E — взяться за завал (нужны двое)';
    }
    ctx.save();
    ctx.font = "13px 'Russo One', sans-serif"; ctx.textAlign = 'center';
    glow('#000', 6); ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y - 30);
    noGlow();
    if (info.mode === 'hold' && p.useP > 0) {
      ctx.strokeStyle = '#3dff8a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + (p.useP / info.dur) * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  if (p.cmdT > 0) {
    ctx.save();
    ctx.strokeStyle = '#4da6ff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(p.rx, p.ry, 26, -Math.PI / 2, -Math.PI / 2 + p.cmdT * Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
