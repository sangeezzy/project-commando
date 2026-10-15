'use strict';
// ---------- Отрисовка мира ----------

const VIS_RAYS = 720;
const VIS_DX = Float64Array.from({ length: VIS_RAYS }, (_, i) => Math.cos((i / VIS_RAYS) * Math.PI * 2));   // направления лучей обзора
const VIS_DY = Float64Array.from({ length: VIS_RAYS }, (_, i) => Math.sin((i / VIS_RAYS) * Math.PI * 2));

const onScreen = (x, y, pad = 60) => (G.camRot ? Math.hypot(x - G.cam.x, y - G.cam.y) < Math.hypot(VW, VH) / 2 / G.zoom + pad
  : Math.abs(x - G.cam.x) < VW / 2 / G.zoom + pad && Math.abs(y - G.cam.y) < VH / 2 / G.zoom + pad);

// Видит ли игрок человека: прямая видимость (с учётом присевших за укрытием) и поле зрения
function playerSees(p, o) {
  const eye = eyeOf(p);
  const d = Math.hypot(o.x - eye.x, o.y - eye.y);
  if (d > VIS_BASE * sightK() * visK() && d > NEAR_SENSE) return false;      // туман, дождь — дальше не различить
  if (d > NEAR_SENSE && Math.abs(angDiff(Math.atan2(o.y - eye.y, o.x - eye.x), p.a)) > PLAYER_FOV) return false;
  if (sightLine(eye, o)) return true;
  // высунувшийся из-за угла: видна голова
  return Math.abs(o.lean || 0) > 0.25 && sightLine(eye, { x: o.lx, y: o.ly, crouch: o.crouch });
}

function render(dt = 1 / 60) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1c1d';
  ctx.fillRect(0, 0, VW, VH);
  if (!map || G.state === 'menu' || G.state === 'lobby') return;   // меню и лобби — DOM поверх
  const p = viewer();                 // чьими глазами: свой боец, после гибели — живой товарищ
  const sh = G.shake, z = G.zoom;
  CAMM = camMatrix(Math.round(rand(-sh, sh)), Math.round(rand(-sh, sh)));
  if (!G.camRot) { CAMM[4] = Math.round(CAMM[4]); CAMM[5] = Math.round(CAMM[5]); }
  const offX = CAMM[4], offY = CAMM[5];
  ctx.setTransform(...CAMM);
  {
    // видимый кусок заранее отрисованной карты (координаты мира; при повороте камеры — описывающий прямоугольник)
    const sp = screenPolyWorld(0).pts;
    drawMapView(ctx, Math.min(...sp.map((q) => q.x)), Math.min(...sp.map((q) => q.y)), Math.max(...sp.map((q) => q.x)), Math.max(...sp.map((q) => q.y)));
  }
  for (const d of G.decals) if (onScreen(d.x, d.y)) drawDecal(d);
  for (const q of G.parts) if (q.shape === 5) drawPart(q);
  for (const d of map.doors) if (onScreen(d.cx, d.cy)) drawDoor(d);
  drawAssaultGate();                  // «Штурм»: ворота перехода (не дверь — только вид; закрыты — стена)
  for (const k of map.keys) if (!k.taken && onScreen(k.x, k.y)) drawKey(k);
  drawTruck();
  for (const o of allPeople()) if (o.dead && !o.evac && onScreen(o.x, o.y)) drawBody(o);
  drawVehicles();                     // машины (сидящие — поверх)
  drawMGs();                          // станковые пулемёты (под бойцами: стрелок — за ними)
  for (const e of G.enemies) {
    if (e.dead || !onScreen(e.x, e.y)) { e.va = 0; continue; }
    const v = p && (p.dead || G.noFog || playerSees(p, e)) ? 1 : 0;      // отладка ]: видно всех
    e.va = (e.va || 0) + (v - (e.va || 0)) * Math.min(1, dt * 16);
    if (e.va > 0.02) drawPerson(e, e.va);
  }
  // свой отряд виден всегда (связь, знаем, где свои)
  for (const o of G.players) if (!o.dead && onScreen(o.x, o.y)) drawPerson(o, 1);
  drawMedic();
  for (const q of G.parts) if (q.shape !== 5) drawPart(q);
  const view = p && !p.dead ? viewPolygon(p) : null;
  const fogClip = G.noFog ? null : view;      // туман войны: чужие лучи и вспышки за стенами не видно (отладка ] — видно всё)
  drawLighting(CAMM, view, fogClip);
  // светится само: вспышки выстрелов; значки внимания — только у тех, кого можно разглядеть
  ctx.setTransform(...CAMM);
  drawLampDaylight(fogClip);
  drawMuzzle(fogClip);
  if (p && !p.dead) for (const o of allPeople()) if (o !== p && lampOn(o) && onScreen(o.x, o.y) && los(p.x, p.y, o.x, o.y)) drawLampGlare(o, p);
  for (const e of G.enemies) if (!e.dead && e.va > 0.3 && (G.noFog || perceivedAt(e.x, e.y) > LIGHT.seeMin)) { uprightAt(e.x, e.y); drawAwareness(e); }
  ctx.setTransform(...CAMM);
  if (view && !G.noFog) drawFog(p, view);
  if (G.noFog) drawAllEnemies();
  drawWeather(CAMM, p);
  drawLaser(me());
  drawHubWorld();
  drawAssaultExit();
  drawTeamTags();
  drawIntel();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBarksOver();
  drawHUD();
  drawTouch();
}

// ---------- Лазер (Shift+N, камера по взгляду): от дула по взгляду до стены / закрытой двери или человека, не дальше видимости ----------
// Над низкими укрытиями проходит (ствол выше). Видно только своему бойцу (рисуется у себя). G.laserDot — точка на экране (метка попадания)
function laserEnd(p) {
  const ca = Math.cos(p.a), sa = Math.sin(p.a), W = WEAPONS[p.gun.t];
  const ex = p.leanPx ? p.lx : p.x, ey = p.leanPx ? p.ly : p.y;
  const ox = ex + ca * M(0.25 + W.len / 40), oy = ey + sa * M(0.25 + W.len / 40);
  let R = opaqueTile(Math.floor(ox / TILE), Math.floor(oy / TILE)) || !los(ex, ey, ox, oy) ? 0
    : castRay(ox, oy, ca, sa, VIS_BASE * sightK() * visK());
  for (const o of allPeople()) {
    if (o === p || o.dead || o.veh) continue;
    const rx = o.x - ox, ry = o.y - oy, t = rx * ca + ry * sa;
    if (t < 0 || t > R) continue;
    const d2 = rx * rx + ry * ry - t * t;
    if (d2 < PR * PR) R = Math.max(0, t - Math.sqrt(PR * PR - d2));
  }
  return { ox, oy, x: ox + ca * R, y: oy + sa * R };
}
function drawLaser(p) {
  G.laserDot = null;
  if (!p || p.dead || p.down || !laserOn(p) || p.sprint || p.sw || p.melee || G.state !== 'play') return;   // бегом, при смене, с ножом — ствол опущен
  const L = laserEnd(p), z = G.zoom, k = canShoot(p) ? 1 : 0.45;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,40,30,${0.32 * k})`; ctx.lineWidth = 1.6 / z;
  ctx.beginPath(); ctx.moveTo(L.ox, L.oy); ctx.lineTo(L.x, L.y); ctx.stroke();
  ctx.fillStyle = `rgba(255,60,40,${0.35 * k})`;
  ctx.beginPath(); ctx.arc(L.x, L.y, 5 / z, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,120,100,${0.95 * k})`;
  ctx.beginPath(); ctx.arc(L.x, L.y, 2 / z, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  G.laserDot = worldToScreen(L.x, L.y, CAMM);
}

// ---------- Двери и ключи ----------
// Створка поворачивается вокруг петли внутрь помещения; выбитая деревянная лежит на полу
function drawDoor(d) {
  const DT = DOOR_TYPES[d.type];
  const X = d.x * TILE, Y = d.y * TILE;
  ctx.save();
  if (d.broken) {
    ctx.translate(d.cx + (d.horiz ? 4 : d.swing * 16), d.cy + (d.horiz ? d.swing * 16 : 4));
    ctx.rotate((d.horiz ? 0 : Math.PI / 2) + 0.35 * d.swing);
    ctx.fillStyle = DT.color; ctx.globalAlpha = 0.85;
    ctx.fillRect(-TILE / 2 + 2, -DT.thick / 2, TILE - 4, DT.thick);
    ctx.strokeStyle = DT.edge; ctx.lineWidth = 1; ctx.strokeRect(-TILE / 2 + 2.5, -DT.thick / 2, TILE - 5, DT.thick);
    ctx.restore();
    return;
  }
  // петля — у левого (или верхнего) края проёма
  const hx = d.horiz ? X + 1 : d.cx, hy = d.horiz ? d.cy : Y + 1;
  ctx.translate(hx, hy);
  ctx.rotate((d.horiz ? 0 : Math.PI / 2) + (d.horiz ? 1 : -1) * d.swing * d.ang * Math.PI / 2);
  const L = TILE - 2, th = DT.thick;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(2, -th / 2 + 2, L, th);                 // тень
  ctx.fillStyle = DT.color;
  ctx.fillRect(0, -th / 2, L, th);
  ctx.strokeStyle = DT.edge; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, -th / 2 + 0.5, L - 1, th - 1);
  if (d.type === 'armored') {
    // бронедверь: рёбра жёсткости
    ctx.beginPath(); for (let x = 6; x < L - 2; x += 6) { ctx.moveTo(x, -th / 2 + 1); ctx.lineTo(x, th / 2 - 1); } ctx.stroke();
  } else if (d.type === 'metal') {
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(1, -th / 2 + 1, L - 2, 1.5);
  } else {
    ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(L - 1, 0); ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // ручка и замок: цвет бирки ключа, если заперта
  ctx.fillStyle = '#c8c0a0';
  ctx.fillRect(L - 6, -th / 2 - 1.5, 3, th + 3);
  if (d.locked) {
    ctx.fillStyle = KEY_COLORS[d.key] || '#d0b030';
    ctx.beginPath(); ctx.arc(L - 4.5, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawKey(k) {
  const t = G.time * 2 + k.x;
  ctx.save();
  ctx.translate(k.x, k.y);
  // слабый блик, чтобы ключ находился глазами
  ctx.fillStyle = `rgba(255,240,180,${0.12 + 0.08 * Math.sin(t)})`;
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(0.6);
  ctx.strokeStyle = '#c9a646'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-4, 0, 3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(7, 0); ctx.moveTo(5, 0); ctx.lineTo(5, 2.5); ctx.moveTo(7, 0); ctx.lineTo(7, 2.5); ctx.stroke();
  ctx.fillStyle = k.color;
  ctx.fillRect(-9, -2, 3, 4);                          // бирка
  ctx.restore();
}

// Противники, замеченные отрядом (ботами или товарищами), которых сам сейчас не видишь: красная метка, гаснет за ~6 с
function drawIntel() {
  const mine = me();
  if (!mine || !G.intel) return;
  const intel = G.intel[mine.side];
  if (!intel) return;
  ctx.save();
  for (const it of intel.values()) {
    const e = G.enemies.find((q) => q.id === it.id);
    if (!e || e.dead || (e.va || 0) > 0.5 || !onScreen(it.x, it.y)) continue;
    const age = G.time - it.t, k = clamp(1 - age / ENEMY.intel.ttl, 0, 1);
    ctx.globalAlpha = 0.25 + 0.6 * k;
    ctx.strokeStyle = '#ff5040'; ctx.lineWidth = 2;
    const r = 9 + 2 * Math.sin(G.time * 5);
    ctx.beginPath(); ctx.moveTo(it.x, it.y - r); ctx.lineTo(it.x + r, it.y); ctx.lineTo(it.x, it.y + r); ctx.lineTo(it.x - r, it.y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#ff5040'; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(age < 1 ? 'контакт' : `${Math.round(age)} с назад`, it.x, it.y - r - 4);
  }
  ctx.restore();
}

// Видно ли противника на экране сейчас (как значки «?»/«!»: в поле зрения и различим по свету)
const enemyShown = (e) => !!e && !e.dead && (e.va || 0) > 0.3 && (G.noFog || perceivedAt(e.x, e.y) > LIGHT.seeMin);

// Реплики видимых противников — над ними (b.over); остальные слышимые — внизу экрана (drawHUD)
function drawBarksOver() {
  if (!G.barks || !G.barks.length) return;
  const z = G.zoom, stack = new Map();
  ctx.save();
  ctx.font = '13px Consolas, monospace';
  ctx.textAlign = 'center';
  for (let i = G.barks.length - 1; i >= 0; i--) {          // новые — ниже, старые поднимаются
    const b = G.barks[i];
    const e = b.foe && b.id !== undefined ? G.enemies.find((q) => q.id === b.id) : null;
    b.over = enemyShown(e);
    if (!b.over) continue;
    const n = stack.get(e) || 0;
    stack.set(e, n + 1);
    const sp = worldToScreen(e.x, e.y, CAMM), x = sp.x, y = sp.y - 34 * z - n * 20;
    const w = ctx.measureText(b.text).width + 12;
    ctx.globalAlpha = Math.min(1, b.t);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y - 13, w, 18);
    ctx.fillStyle = '#e8a080';
    ctx.fillText(b.text, x, y);
  }
  ctx.restore();
}

// Отладка (]): метки всех живых противников поверх света — видны и в темноте, и за стенами
function drawAllEnemies() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,70,50,0.9)'; ctx.lineWidth = 1.5;
  for (const e of G.enemies) {
    if (e.dead || !onScreen(e.x, e.y)) continue;
    ctx.beginPath(); ctx.arc(e.x, e.y, PR + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.a) * (PR + 10), e.y + Math.sin(e.a) * (PR + 10)); ctx.stroke();
  }
  ctx.restore();
}

// Метки своих поверх тумана: цвет места и имя (бот — «бот»)
// Камера повёрнута (в машине): надписи и значки над бойцом — без поворота (читаются ровно), на своём месте на экране
function uprightAt(x, y) {
  if (!G.camRot) return;
  const s = worldToScreen(x, y, CAMM), z = G.zoom;
  ctx.setTransform(z, 0, 0, z, s.x - z * x, s.y - z * y);
}

function drawTeamTags() {
  const mine = me();
  ctx.save();
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'center';
  for (const o of G.players) {
    if (o === mine || !onScreen(o.x, o.y)) continue;
    uprightAt(o.x, o.y);
    const c = SLOT_COLORS[o.slot] || '#fff';
    ctx.globalAlpha = o.dead ? 0.5 : 0.95;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const label = o.name + (o.dead ? ' †' : o.down ? ` — ранен ${Math.ceil(o.bleed)} с` : '');
    ctx.fillText(label, o.x + 1, o.y - 19);
    ctx.fillStyle = o.down ? '#ff6050' : c;
    ctx.fillText(label, o.x, o.y - 20);
    if (o.down && o.rev > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(o.x - 16, o.y - 32, 32, 4);
      ctx.fillStyle = '#9fe870'; ctx.fillRect(o.x - 16, o.y - 32, 32 * o.rev, 4);
    }
    ctx.beginPath(); ctx.moveTo(o.x - 4, o.y - 16); ctx.lineTo(o.x + 4, o.y - 16); ctx.lineTo(o.x, o.y - 12); ctx.closePath(); ctx.fill();
    if (!o.ai) talkIcon(o.x + ctx.measureText(o.name).width / 2 + 8, o.y - 24, o.slot);   // говорит (рядом / по рации)
  }
  ctx.restore();
}

function drawDecal(d) {
  if (d.casing) {
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
    ctx.fillStyle = '#a88a3c'; ctx.fillRect(-2, -0.8, 4, 1.6);
    ctx.restore();
    return;
  }
  let r = d.r;
  if (d.grow) r *= Math.min(1, 0.3 + (G.time - (d.t0 || (d.t0 = G.time))) / 6);
  ctx.fillStyle = d.c;
  ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill();
}

function drawPart(q) {
  const k = q.life / q.max;
  if (q.shape === 4) {
    ctx.strokeStyle = q.color; ctx.globalAlpha = 0.35 * k; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x1, q.y1); ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  if (q.shape === 5) {
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
    ctx.globalAlpha = Math.min(1, q.life); ctx.fillStyle = q.color;
    ctx.fillRect(-4, -1.8, 8, 3.6); ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }
  if (q.shape === 3) {
    ctx.fillStyle = q.color; ctx.globalAlpha = k;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (2 - k), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = Math.min(1, k * 1.5);
  if (q.shape === 1) {
    ctx.strokeStyle = q.color; ctx.lineWidth = q.size;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.02, q.y - q.vy * 0.02); ctx.stroke();
  } else if (q.shape === 2) {
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
    ctx.fillStyle = q.color; ctx.fillRect(-2, -0.8, 4, 1.6);
    ctx.restore();
  } else {
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
}

// Блик чужого фонаря: виден издалека, ослепляет, если светят прямо на игрока
function drawLampGlare(o, p) {
  const lx = o.x + Math.cos(o.a) * 20, ly = o.y + Math.sin(o.a) * 20;
  const toP = Math.abs(angDiff(Math.atan2(p.y - o.y, p.x - o.x), o.a));
  // сам источник лучше виден в темноте; большая слепящая вспышка — только если темно вокруг игрока
  const k = 0.3 * (0.3 + 0.7 * glareDarkness(o.x, o.y)) + 0.7 * lampAngular(toP) * glareDarkness(p.x, p.y);
  if (k < 0.03) return;
  const r = 6 + 22 * k;
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
  g.addColorStop(0, `rgba(255,255,240,${0.95 * k + 0.05})`);
  g.addColorStop(0.25, `rgba(255,250,220,${0.5 * k})`);
  g.addColorStop(1, 'rgba(255,250,220,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
}

// clip — многоугольник видимости игрока: вспышка за стеной (в тумане войны) не рисуется
function drawMuzzle(clip) {
  if (!G.muzzle || !G.muzzle.length) return;
  ctx.save();
  if (clip) ctx.clip(clip);
  for (const m of G.muzzle) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
    ctx.fillStyle = 'rgba(255,230,150,0.9)';
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(14, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,100,0.35)';
    ctx.beginPath(); ctx.arc(2, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ---------- Люди сверху ----------
// ---------- Анимация бойцов: плавные переходы между позами ----------
// o.an — коэффициенты смешивания 0..1, догоняют целевую позу за доли секунды (время в секундах — постоянные τ).
const ANIM = { crouch: 0.12, low: 0.09, reload: 0.08, ads: 0.08, death: 0.45 };
const approach = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function animTargets(o) {
  const reloading = o.gun.reloadT > 0;
  const ads = o.side === 'p' ? o.ads || 0 : o.st === 2 && o.seeing && !o.sprint && !reloading ? 1 : 0;
  return { crouch: o.crouch ? 1 : 0, low: o.sprint ? 1 : 0, reload: reloading ? 1 : 0, ads };
}

function updateAnim(o, dt) {
  const t = animTargets(o);
  if (!o.an) { o.an = { ...t }; return; }
  o.an.crouch = approach(o.an.crouch, t.crouch, dt, ANIM.crouch);
  o.an.low = approach(o.an.low, t.low, dt, ANIM.low);
  o.an.reload = approach(o.an.reload, t.reload, dt, ANIM.reload);
  // у игрока прицел и так плавный (ADS_TIME), у противника — сглаживаем
  o.an.ads = o.side === 'p' ? t.ads : approach(o.an.ads, t.ads, dt, ANIM.ads);
}

// Где магазин во время перезарядки: 0 — в оружии, 1 — вынут (плавно выходит и входит)
function magOut(g) {
  if (!(g.reloadT > 0)) return 0;
  const f = 1 - g.reloadT / g.reloadDur;
  if (f < 0.15) return 0;
  if (f < 0.35) return smooth01((f - 0.15) / 0.2);
  if (f < 0.65) return 1;
  if (f < 0.8) return 1 - smooth01((f - 0.65) / 0.15);
  return 0;
}

const lerp = (a, b, k) => a + (b - a) * k;

// Оружие сверху, стволом по +x, начало — у плеча/рук. mo — доля выхода магазина (перезарядка)
// Винтовки и пулемёты: ствольная коробка, приклад, цевьё по виду (GUN_LOOK); у M249 — короб с лентой сбоку.
const GUN_LOOK = {
  m4a1: { stock: '#1a1a1a', mag: '#2a2a2a', magL: 4.5, optic: true },
  akm: { stock: '#6b4527', fore: '#6b4527', mag: '#5a3a20', magL: 5.5 },
  ak74: { stock: '#5a3422', fore: '#5a3422', mag: '#6a3328', magL: 5.5, brake: true },     // ламинат, магазин «сливовый»
  rpk74: { stock: '#5a3422', fore: '#5a3422', mag: '#6a3328', magL: 7.5, bipod: true },   // длинный ствол, рожок на 45, сошки
  fal: { stock: '#202020', fore: '#2c2c2c', mag: '#242424', magL: 5, carry: true, brake: true },
  m249: { stock: '#1e1e1e', fore: '#2a2a2a', box: '#4a5038', bipod: true, shield: true },
};
const VERT_K = 0.34;           // висящее вертикально оружие сверху: видимая доля длины (ракурс)
function drawGunShape(t, mo = 1, g = ctx) {
  const W = WEAPONS[t], a = g.globalAlpha;
  if (W.cls === 'pistol') {
    g.fillStyle = t === 'hipower' ? '#202224' : '#26282a'; g.fillRect(0, -1.2, W.len, 2.4);      // затвор и ствол
    g.fillStyle = t === 'tt' ? '#2e2622' : '#4a3a2a'; g.fillRect(-1, -1, 2.5, 2);               // рукоятка (у ТТ — бакелит)
    return;
  }
  if (t === 'w1300') {
    g.fillStyle = '#1c1c1c'; g.fillRect(-4, -1.4, W.len - 2, 2.8);   // ствольная коробка и ствол
    g.fillStyle = '#2a2a2a'; g.fillRect(4, 1.2, W.len - 12, 1.4);    // подствольный магазин
    g.fillStyle = '#3a3a3a'; g.fillRect(12, -1.8, 7, 3.6);           // цевьё (помпа)
    g.fillStyle = '#1c1c1c'; g.fillRect(-10, -2.2, 7, 4.4);          // приклад
    return;
  }
  const L = GUN_LOOK[t] || GUN_LOOK.m4a1;
  g.fillStyle = '#1a1a1a';
  g.fillRect(-4, -1.6, W.len, 3.2);                // ствольная коробка, цевьё, ствол
  g.fillStyle = L.stock;
  g.fillRect(-9, -2, 6, 4);                        // приклад
  if (L.fore) { g.fillStyle = L.fore; g.fillRect(9, -1.9, 8, 3.8); }        // цевьё
  if (L.shield) { g.fillStyle = '#333'; g.fillRect(12, -2.1, 10, 1); }       // M249: теплозащитный кожух сверху
  if (L.brake) { g.fillStyle = '#0e0e0e'; g.fillRect(W.len - 6, -1.9, 2.5, 3.8); }   // дульный тормоз
  if (L.carry) { g.fillStyle = '#2e2e2e'; g.fillRect(1, -2.6, 7, 1); }       // FAL: ручка для переноски
  if (L.bipod) {
    // сошки сложены вдоль ствола (сверху — две тонкие ножки)
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(W.len - 12, -1.6); g.lineTo(W.len - 4, -2.6); g.moveTo(W.len - 12, 1.6); g.lineTo(W.len - 4, 2.6); g.stroke();
  }
  if (L.box) {
    // короб с лентой — сбоку слева; на перезарядке уходит
    g.globalAlpha = a * (mo < 0.98 ? 1 - mo : 1);
    g.fillStyle = L.box; g.fillRect(2, 1.6 + (mo < 0.98 ? mo * 6 : 0), 7, 4.5);
    g.globalAlpha = a;
  } else if (mo < 0.98) {
    g.globalAlpha = a * (1 - mo);
    g.fillStyle = L.mag;
    g.fillRect(6, 1.4 + mo * 6, 3.5, L.magL);      // магазин выходит вниз
    g.globalAlpha = a;
  }
  if (L.optic) { g.fillStyle = '#333'; g.fillRect(4, -2.6, 6, 1.2); }   // прицел (у остальных — открытый)
}

// Бронежилет на модели: плитоноска цвета класса (мягкая IIIA — без контура плит); с износом — потёртости и сколы,
// разбитая — трещины. Отметины у каждого бойца на своих местах (генератор от id), число — по износу
function drawVest(o) {
  const a = o.armor, A = ARMOR[a.cls], wear = 1 - clamp(a.hp / 100, 0, 1);
  ctx.fillStyle = A.color;
  roundRect(ctx, -6, -8, 12, 16, 2.5); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
  if (A.lvl > 1) {                                  // плиты спереди и сзади
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(1, -5.5, 4, 11); ctx.strokeRect(-5, -5.5, 4, 11);
  }
  const rnd = makeRng(o.id * 977 + 13), n = Math.round(wear * 9);
  for (let i = 0; i < n; i++) {
    const x = -5 + rnd() * 10, y = -7 + rnd() * 14;
    ctx.fillStyle = wear > 0.6 ? 'rgba(30,22,18,0.85)' : 'rgba(235,225,200,0.75)';
    ctx.fillRect(x, y, 2, 2);                      // скол / потёртость
  }
  if (a.hp <= 0) {                                  // разбита: трещины поперёк
    ctx.strokeStyle = 'rgba(20,15,10,0.8)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-1, -1); ctx.lineTo(-3, 3); ctx.moveTo(4, -6); ctx.lineTo(1, 0); ctx.lineTo(4, 5); ctx.stroke();
  }
}

function drawPerson(o, alpha) {
  if (o.down) { drawDowned(o, alpha); return; }
  if (!o.an) updateAnim(o, 0);
  const an = o.an;
  const isP = o.side === 'p';
  const uni = isP ? PLAYER_COL : ENEMY_COL;
  const s = 1 - 0.1 * an.crouch;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(o.x, o.y);
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(3, 3, 11 * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(o.a);
  ctx.scale(s, s);
  if (an.crouch > 0.02) {
    // колени выдвигаются вперёд
    ctx.fillStyle = uni;
    ctx.globalAlpha = alpha * Math.min(1, an.crouch * 1.5);
    const k = an.crouch;
    ctx.beginPath(); ctx.ellipse(2 + 6 * k, -5, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(1 + 4 * k, 6, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (o.act && o.act.kind === 'kick') {
    // удар ногой: нога выстреливает вперёд и возвращается
    const k = Math.sin(Math.PI * clamp(o.act.t / o.act.dur, 0, 1));
    ctx.fillStyle = uni;
    ctx.beginPath(); ctx.ellipse(4 + 12 * k, 3, 4 + 4 * k, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2622';
    ctx.beginPath(); ctx.ellipse(8 + 16 * k, 3, 3.2, 2.6, 0, 0, Math.PI * 2); ctx.fill();   // ботинок
  }
  const g = o.gun;
  const ads = an.ads;
  const ln = o.leanPx || 0;                 // выглядывание: плечи наполовину, голова и оружие целиком
  ctx.translate(0, ln * 0.5);
  if (o.mg) {
    // за станковым пулемётом: свой ствол — за спиной, руки — на рукоятках пулемёта (сам пулемёт — drawMGs)
    ctx.fillStyle = isP ? '#5e6b42' : '#4a4038';
    ctx.beginPath(); ctx.arc(9, -3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(9, 3, 3, 0, Math.PI * 2); ctx.fill();
  } else {
  // оружие опущено: на бегу сильнее, при перезарядке — к себе
  const lowK = Math.max(an.low, an.reload);
  const rot = an.low * 0.75 + an.reload * 0.5 * (1 - an.low);
  const mo = magOut(g);
  const cls = WEAPONS[g.t].cls, pistol = cls === 'pistol';
  // за спиной и на плече — полноразмерные, которые не в руках и не в левой руке: висят на ремне вертикально (стволом вверх, у плеча),
  // сверху видны в ракурсе — коротко (VERT_K длины), чуть отклонены назад от спины
  if (o.kit) for (let i = 0; i < 2; i++) {
    const k = o.kit[i];
    if (!k || i === o.cur || i === o.off) continue;
    ctx.save(); ctx.translate(-4, i ? 5 : -5); ctx.rotate(Math.PI + (i ? -0.3 : 0.3)); ctx.scale(VERT_K, 1); ctx.globalAlpha = alpha * 0.9;
    drawGunShape(k.t, 1); ctx.restore();
  }
  // смена оружия: ствол уходит вниз и возвращается
  const swK = o.sw ? Math.sin(Math.PI * clamp(o.sw.t / o.sw.dur, 0, 1)) : 0;
  ctx.save();
  if (pistol) ctx.translate(7 - ads, 2.5 - ads * 2);         // пистолет — двумя руками перед грудью
  else ctx.translate(2 - ads * 1, 5 - ads * 4);              // полноразмерное — у правого плеча
  ctx.rotate(rot + swK * 0.9);
  drawGunShape(g.t, mo);
  ctx.restore();
  // полноразмерное в левой руке (выхвачен пистолет): висит стволом вниз вдоль левого бока — тоже вертикально, в ракурсе
  if (o.kit && o.off >= 0 && o.kit[o.off] && pistol) {
    ctx.save(); ctx.translate(2, -9); ctx.rotate(0.2); ctx.scale(VERT_K * 1.2, 1); ctx.globalAlpha = alpha * 0.95;
    drawGunShape(o.kit[o.off].t, 1); ctx.restore();
  }
  // руки: передняя — на цевье (с оружием опускается), задняя — на рукоятке, при перезарядке тянется к магазину
  ctx.fillStyle = isP ? '#5e6b42' : '#4a4038';
  const reach = an.reload * Math.min(1, mo * 1.5 + 0.3);
  if (pistol) {
    const fx = lerp(12 - ads, 8, lowK), fy = lerp(2.5 - ads * 2, 6, lowK);
    ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
    // вторая рука: на пистолете — или держит полноразмерное слева
    const offHand = o.off >= 0;
    ctx.beginPath(); ctx.arc(offHand ? 4 : lerp(10, 7, reach), offHand ? -7 : lerp(4.5 - ads * 2, 9, reach), 3, 0, Math.PI * 2); ctx.fill();
  } else {
    const fx = lerp(15 - ads, 9, lowK), fy = lerp(5 - ads * 4, 9, lowK);
    ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
    const bx = lerp(3, 8, reach), by = lerp(7 - ads * 3, 11, reach);
    ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
  }
  }
  // нож: рука с клинком выбрасывается вперёд и возвращается
  if (o.melee) {
    const k = Math.sin(Math.PI * clamp(o.melee.t / o.melee.dur, 0, 1));
    const hx = 6 + 14 * k, hy = -3 + 2 * k;
    ctx.fillStyle = isP ? '#5e6b42' : '#4a4038';
    ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c8ccd0'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(hx + 2, hy); ctx.lineTo(hx + 9, hy - 0.5); ctx.stroke();
  }
  // плечи и разгрузка
  ctx.fillStyle = uni;
  ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = isP ? '#55603c' : '#3a332c';
  ctx.fillRect(-4.5, -6.5, 9, 13);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(1.5, -5.5, 2.5, 3); ctx.fillRect(1.5, 2.5, 2.5, 3);   // подсумки
  if (o.armor) drawVest(o);
  if (isP && o.slot >= 0) { ctx.fillStyle = SLOT_COLORS[o.slot]; ctx.fillRect(-3, -10.5, 4, 3); }   // повязка: цвет места в отряде
  // голова в шлеме: присев — чуть наклоняется вперёд; при выглядывании — дальше вбок
  ctx.translate(0, ln * 0.5);
  const hx = 0.5 + an.crouch * 1.5;
  ctx.fillStyle = isP ? '#6a7350' : '#3f3a33';
  ctx.beginPath(); ctx.arc(hx, 0, 5.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.arc(hx - 1, -1.5, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawAwareness(e) {
  if (e.st === 0 && e.notice < 0.05) return;
  const x = e.x, y = e.y - 22;
  const fight = e.st === 2;
  ctx.save();
  ctx.font = 'bold 14px Consolas, monospace';
  ctx.textAlign = 'center';
  if (fight) {
    ctx.fillStyle = '#ff5040';
    ctx.fillText('!', x, y + 4);
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = e.notice > 0.4 ? '#ffb030' : '#e8e0a0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.08, e.notice)); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.fillText('?', x, y + 4);
  }
  ctx.restore();
}

// Падение: боец оседает и смещается по направлению попадания, тело проявляется
const deathK = (o) => smooth01((G.time - (o.deadT ?? -99)) / ANIM.death);

// Раненый: лежит ничком головой туда, куда ползёт; оружие рядом
function drawDowned(o, alpha) {
  const uni = o.side === 'p' ? PLAYER_COL : ENEMY_COL;
  const wob = Math.sin(G.time * 6 + o.id) * (o.speed > 2 ? 1.2 : 0.3);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(o.x, o.y);
  ctx.rotate(o.a);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(2, 3, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = uni;
  ctx.fillRect(-16, -4 + wob, 12, 3.5); ctx.fillRect(-16, 1 - wob, 12, 3.5);       // ноги
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 6.5, 0, 0, Math.PI * 2); ctx.fill();      // туловище
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-4, -4, 8, 8);
  ctx.fillStyle = uni;
  ctx.fillRect(4, -7 - wob, 9, 3); ctx.fillRect(4, 4 + wob, 9, 3);                // руки вперёд
  ctx.fillStyle = o.side === 'p' ? '#6a7350' : '#3f3a33';
  ctx.beginPath(); ctx.arc(11, 0, 5, 0, Math.PI * 2); ctx.fill();                 // голова
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-2, 8, 24, 2.6);                         // винтовка рядом
  if (o.slot >= 0) { ctx.fillStyle = SLOT_COLORS[o.slot]; ctx.fillRect(-2, -8, 4, 3); }
  ctx.restore();
}

function drawBody(o) {
  const k = deathK(o);
  if (k < 1) {
    // стоящий боец заваливается: тает и сдвигается по направлению попадания
    ctx.save();
    ctx.translate(Math.cos(o.deadA) * 8 * k, Math.sin(o.deadA) * 8 * k);
    drawPerson(o, 1 - k);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(o.x + Math.cos(o.deadA) * 6, o.y + Math.sin(o.deadA) * 6);
  ctx.rotate(o.deadA + (o.id % 2 ? 0.4 : -0.4));
  const uni = o.side === 'p' ? PLAYER_COL : ENEMY_COL;
  ctx.fillStyle = uni;
  ctx.fillRect(-14, -5, 18, 10);                      // туловище
  ctx.fillRect(4, -5, 12, 4); ctx.fillRect(4, 1, 13, 4);   // ноги
  ctx.beginPath(); ctx.ellipse(-12, 0, 6, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = o.side === 'p' ? '#6a7350' : '#3f3a33';
  ctx.beginPath(); ctx.arc(-19, 0, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.rotate(0.9); ctx.fillRect(-6, 12, 26, 3);         // выпавшая винтовка
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- Туман: всё, чего не видно из глаз бойца ----------
// Многоугольник прямой видимости бойца (координаты мира)
function viewPolygon(body) {
  const p = { ...eyeOf(body), a: body.a };      // смотрим глазами (при выглядывании — из-за угла)
  // присевший не видит поверх своего укрытия
  const opq = p.crouch
    ? (tx, ty, t) => { const k = tileAt(tx, ty); return opaqueT(k) || (k === T.LOW && t < COVER_NEAR); }
    : opaqueTile;
  const maxR = Math.hypot(VW, VH) / G.zoom;
  // многоугольник нужен только для экрана (туман, свет): луч идёт до края экрана в своём направлении (с запасом на тряску),
  // а не на диагональ — на открытой карте вдвое меньше клеток; глаза вне экрана — как раньше, на всю диагональ
  const pad = 48, hx = VW / 2 / G.zoom + pad, hy = VH / 2 / G.zoom + pad;
  const rx0 = G.cam.x - hx, rx1 = G.cam.x + hx, ry0 = G.cam.y - hy, ry1 = G.cam.y + hy;
  const inside = p.x > rx0 && p.x < rx1 && p.y > ry0 && p.y < ry1;
  const poly = new Path2D();
  for (let i = 0; i < VIS_RAYS; i++) {
    const dx = VIS_DX[i], dy = VIS_DY[i];
    const lim = inside ? Math.min(dx > 1e-9 ? (rx1 - p.x) / dx : dx < -1e-9 ? (rx0 - p.x) / dx : 1e9,
      dy > 1e-9 ? (ry1 - p.y) / dy : dy < -1e-9 ? (ry0 - p.y) / dy : 1e9, maxR) : maxR;
    const hit = castRay(p.x, p.y, dx, dy, lim, opq);
    // закрытая дверь стоит посреди проёма — её створку видно целиком
    const door = tileAt(Math.floor((p.x + dx * (hit + 1)) / TILE), Math.floor((p.y + dy * (hit + 1)) / TILE)) === T.DOOR;
    const d = hit >= lim ? lim : Math.min(lim, hit + (door ? 22 : 6));
    if (i === 0) poly.moveTo(p.x + dx * d, p.y + dy * d); else poly.lineTo(p.x + dx * d, p.y + dy * d);
  }
  poly.closePath();
  return poly;
}

// Туман прямо на экран, без промежуточного полноэкранного холста: вне видимости — 0,82, в видимости вне поля зрения
// (сзади и по бокам) — полутень 0,41, в поле зрения и вплотную (NEAR_SENSE) — чисто
function drawFog(p, poly) {
  const z = G.zoom, maxR = Math.hypot(VW, VH) / z;
  const ox = p.lx ?? p.x, oy = p.ly ?? p.y;
  ctx.save();
  ctx.setTransform(...CAMM);
  // рамка — экран в координатах мира (огромный прямоугольник растеризатор обрабатывает заметно дольше); при повороте — повёрнутая
  const frame = screenPolyWorld(8).path;
  const outside = new Path2D();
  outside.addPath(frame);
  outside.addPath(poly);
  ctx.fillStyle = 'rgba(12,14,16,0.82)';
  ctx.fill(outside, 'evenodd');
  // поле зрения вместе с кругом вплотную — один контур «замочная скважина»: сектор впереди, дуга малого радиуса сзади
  const seen = new Path2D();
  seen.addPath(frame);
  seen.moveTo(ox + Math.cos(p.a - PLAYER_FOV) * maxR, oy + Math.sin(p.a - PLAYER_FOV) * maxR);
  seen.arc(ox, oy, maxR, p.a - PLAYER_FOV, p.a + PLAYER_FOV);
  seen.arc(ox, oy, NEAR_SENSE, p.a + PLAYER_FOV, p.a - PLAYER_FOV + Math.PI * 2);
  seen.closePath();
  ctx.clip(poly);
  ctx.fillStyle = 'rgba(12,14,16,0.41)';
  ctx.fill(seen, 'evenodd');
  ctx.restore();
}
