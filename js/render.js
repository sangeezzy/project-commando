'use strict';
// ---------- Отрисовка мира ----------

const VIS_RAYS = 720;

const onScreen = (x, y, pad = 60) => Math.abs(x - G.cam.x) < VW / 2 / G.zoom + pad && Math.abs(y - G.cam.y) < VH / 2 / G.zoom + pad;

// Видит ли игрок человека: прямая видимость (с учётом присевших за укрытием) и поле зрения
function playerSees(p, o) {
  const eye = eyeOf(p);
  const d = Math.hypot(o.x - eye.x, o.y - eye.y);
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
  const offX = Math.round(VW / 2 - G.cam.x * z + rand(-sh, sh)), offY = Math.round(VH / 2 - G.cam.y * z + rand(-sh, sh));
  ctx.setTransform(z, 0, 0, z, offX, offY);
  {
    // видимый кусок заранее отрисованной карты (координаты мира)
    const wx = -offX / z, wy = -offY / z, mc = map.canvas;
    const x0 = Math.max(0, wx), y0 = Math.max(0, wy), x1 = Math.min(mc.width, wx + VW / z), y1 = Math.min(mc.height, wy + VH / z);
    if (x1 > x0 && y1 > y0) ctx.drawImage(mc, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  for (const d of G.decals) if (onScreen(d.x, d.y)) drawDecal(d);
  for (const q of G.parts) if (q.shape === 5) drawPart(q);
  for (const d of map.doors) if (onScreen(d.cx, d.cy)) drawDoor(d);
  for (const k of map.keys) if (!k.taken && onScreen(k.x, k.y)) drawKey(k);
  for (const o of allPeople()) if (o.dead && onScreen(o.x, o.y)) drawBody(o);
  for (const e of G.enemies) {
    if (e.dead || !onScreen(e.x, e.y)) { e.va = 0; continue; }
    const v = p && (p.dead || G.noFog || playerSees(p, e)) ? 1 : 0;      // отладка ]: видно всех
    e.va = (e.va || 0) + (v - (e.va || 0)) * Math.min(1, dt * 16);
    if (e.va > 0.02) drawPerson(e, e.va);
  }
  // свой отряд виден всегда (связь, знаем, где свои)
  for (const o of G.players) if (!o.dead && onScreen(o.x, o.y)) drawPerson(o, 1);
  for (const q of G.parts) if (q.shape !== 5) drawPart(q);
  const view = p && !p.dead ? viewPolygon(p) : null;
  drawLighting(offX, offY, view);
  // светится само: вспышки выстрелов; значки внимания — только у тех, кого можно разглядеть
  ctx.setTransform(z, 0, 0, z, offX, offY);
  drawLampDaylight();
  drawMuzzle();
  if (p && !p.dead) for (const o of allPeople()) if (o !== p && lampOn(o) && onScreen(o.x, o.y) && los(p.x, p.y, o.x, o.y)) drawLampGlare(o, p);
  for (const e of G.enemies) if (!e.dead && e.va > 0.3 && (G.noFog || perceivedAt(e.x, e.y) > LIGHT.seeMin)) drawAwareness(e);
  if (view && !G.noFog) drawFog(offX, offY, p, view);
  if (G.noFog) drawAllEnemies();
  drawHubWorld();
  drawTeamTags();
  drawIntel();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD();
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
function drawTeamTags() {
  const mine = me();
  ctx.save();
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'center';
  for (const o of G.players) {
    if (o === mine || !onScreen(o.x, o.y)) continue;
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

function drawMuzzle() {
  if (!G.muzzle) return;
  for (const m of G.muzzle) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
    ctx.fillStyle = 'rgba(255,230,150,0.9)';
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(14, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,100,0.35)';
    ctx.beginPath(); ctx.arc(2, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
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
function drawGunShape(t, mo = 1, g = ctx) {
  const W = WEAPONS[t], a = g.globalAlpha;
  if (t === 'm1911') {
    g.fillStyle = '#26282a'; g.fillRect(0, -1.2, W.len, 2.4);      // затвор и ствол
    g.fillStyle = '#4a3a2a'; g.fillRect(-1, -1, 2.5, 2);            // рукоятка (щёчки)
    return;
  }
  if (t === 'w1300') {
    g.fillStyle = '#1c1c1c'; g.fillRect(-4, -1.4, W.len - 2, 2.8);   // ствольная коробка и ствол
    g.fillStyle = '#2a2a2a'; g.fillRect(4, 1.2, W.len - 12, 1.4);    // подствольный магазин
    g.fillStyle = '#3a3a3a'; g.fillRect(12, -1.8, 7, 3.6);           // цевьё (помпа)
    g.fillStyle = '#1c1c1c'; g.fillRect(-10, -2.2, 7, 4.4);          // приклад
    return;
  }
  const akm = t === 'akm';
  g.fillStyle = '#1a1a1a';
  g.fillRect(-4, -1.6, W.len, 3.2);                // ствольная коробка, цевьё, ствол
  g.fillStyle = akm ? '#6b4527' : '#1a1a1a';
  g.fillRect(-9, -2, 6, 4);                        // приклад (у АКМ — дерево)
  if (akm) { g.fillRect(9, -1.9, 8, 3.8); }        // деревянное цевьё
  if (mo < 0.98) {
    g.globalAlpha = a * (1 - mo);
    g.fillStyle = akm ? '#5a3a20' : '#2a2a2a';
    g.fillRect(6, 1.4 + mo * 6, 3.5, akm ? 5.5 : 4.5);    // магазин выходит вниз (у АКМ — изогнутый, длиннее)
    g.globalAlpha = a;
  }
  if (!akm) { g.fillStyle = '#333'; g.fillRect(4, -2.6, 6, 1.2); }   // прицел (у АКМ — открытый)
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
  // оружие опущено: на бегу сильнее, при перезарядке — к себе
  const lowK = Math.max(an.low, an.reload);
  const rot = an.low * 0.75 + an.reload * 0.5 * (1 - an.low);
  const mo = magOut(g);
  const cls = WEAPONS[g.t].cls, pistol = cls === 'pistol';
  // за спиной — полноразмерные, которые не в руках и не в левой руке (под плечами, наискось)
  if (o.kit) for (let i = 0; i < 2; i++) {
    const k = o.kit[i];
    if (!k || i === o.cur || i === o.off) continue;
    ctx.save(); ctx.translate(-5, i ? 3 : -3); ctx.rotate(i ? 2.6 : -2.6); ctx.globalAlpha = alpha * 0.9;
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
  // полноразмерное в левой руке (выхвачен пистолет): висит стволом вперёд-вниз вдоль левого бока
  if (o.kit && o.off >= 0 && o.kit[o.off] && pistol) {
    ctx.save(); ctx.translate(1, -8); ctx.rotate(0.35); ctx.globalAlpha = alpha * 0.95;
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
  const poly = new Path2D();
  for (let i = 0; i < VIS_RAYS; i++) {
    const a = (i / VIS_RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const hit = castRay(p.x, p.y, dx, dy, maxR, opq);
    // закрытая дверь стоит посреди проёма — её створку видно целиком
    const door = tileAt(Math.floor((p.x + dx * (hit + 1)) / TILE), Math.floor((p.y + dy * (hit + 1)) / TILE)) === T.DOOR;
    const d = Math.min(maxR, hit + (door ? 22 : 6));
    if (i === 0) poly.moveTo(p.x + dx * d, p.y + dy * d); else poly.lineTo(p.x + dx * d, p.y + dy * d);
  }
  poly.closePath();
  return poly;
}

// Туман прямо на экран, без промежуточного полноэкранного холста: вне видимости — 0,82, в видимости вне поля зрения
// (сзади и по бокам) — полутень 0,41, в поле зрения и вплотную (NEAR_SENSE) — чисто
function drawFog(offX, offY, p, poly) {
  const z = G.zoom, maxR = Math.hypot(VW, VH) / z;
  const ox = p.lx ?? p.x, oy = p.ly ?? p.y;
  ctx.save();
  ctx.setTransform(z, 0, 0, z, offX, offY);
  // рамка — экран в координатах мира (огромный прямоугольник растеризатор обрабатывает заметно дольше)
  const sx = -offX / z - 8, sy = -offY / z - 8, sw = VW / z + 16, sh = VH / z + 16;
  const outside = new Path2D();
  outside.rect(sx, sy, sw, sh);
  outside.addPath(poly);
  ctx.fillStyle = 'rgba(12,14,16,0.82)';
  ctx.fill(outside, 'evenodd');
  // поле зрения вместе с кругом вплотную — один контур «замочная скважина»: сектор впереди, дуга малого радиуса сзади
  const seen = new Path2D();
  seen.rect(sx, sy, sw, sh);
  seen.moveTo(ox + Math.cos(p.a - PLAYER_FOV) * maxR, oy + Math.sin(p.a - PLAYER_FOV) * maxR);
  seen.arc(ox, oy, maxR, p.a - PLAYER_FOV, p.a + PLAYER_FOV);
  seen.arc(ox, oy, NEAR_SENSE, p.a + PLAYER_FOV, p.a - PLAYER_FOV + Math.PI * 2);
  seen.closePath();
  ctx.clip(poly);
  ctx.fillStyle = 'rgba(12,14,16,0.41)';
  ctx.fill(seen, 'evenodd');
  ctx.restore();
}
