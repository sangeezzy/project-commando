'use strict';
// ---------- Хаб и карты: оружейный стол, проходы на карты, «Зачистка» со случайной расстановкой ----------
// После лобби — хаб (startMap('hub')). У стола (F) — выбор двух полноразмерных стволов (пистолет — всегда Colt M1911).
// Хост встаёт в проход и стоит HUB_HOLD с — переход на карту; seed — новый при переходе из хаба, тот же при перезапуске (Enter).
// Backspace (хост) — обратно в хаб.

const HUB_HOLD = 2;              // с: постоять в проходе
const TABLE_R = M(1.8);          // м: «у стола»

// ---------- «Зачистка»: отряд — в случайной точке у края карты, 8–12 противников вне его видимости ----------
// rnd — генератор карты (makeRng(seed)): при перезапуске та же расстановка
function missionSetup(rnd) {
  const { w, h } = map;
  const ok = (x, y) => walkable(x, y) && map.fl[y * w + x] !== FM.INDOOR;
  // старт: у края (2–4 клетки от стены карты), на улице, есть место на четверых
  const edge = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const de = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (de > 4 || !ok(x, y)) continue;
    if (SPAWN_OFF.every(([ox, oy]) => ok(Math.round(x + ox), Math.round(y + oy)))) edge.push([x, y]);
  }
  const [sx, sy] = edge[Math.floor(rnd() * edge.length)];
  const team = SPAWN_OFF.map(([ox, oy]) => ({ x: (sx + 0.5 + ox) * TILE, y: (sy + 0.5 + oy) * TILE }));
  // лицом — к середине карты
  const start = { x: sx + 0.5, y: sy + 0.5, a: Math.atan2(h / 2 - sy, w / 2 - sx) };
  // противники: дойти можно (через незапертые двери), не ближе 16 м к отряду, ни одного не видно со старта (и им — отряд),
  // друг от друга не ближе 5 м
  const reach = bfsFrom(team[0].x, team[0].y, 1e9, true);
  const cand = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!walkable(x, y) || reach.f[y * w + x] >= 1e9) continue;
    const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
    if (team.some((t) => Math.hypot(t.x - cx, t.y - cy) < M(16) || los(t.x, t.y, cx, cy))) continue;
    cand.push([x, y]);
  }
  const n = 8 + Math.floor(rnd() * 5);
  const enemies = [];
  for (let tries = 0; tries < 4000 && enemies.length < n && cand.length; tries++) {
    const [x, y] = cand[Math.floor(rnd() * cand.length)];
    if (enemies.some((e) => Math.hypot(e.x - (x + 0.5), e.y - (y + 0.5)) < 5)) continue;
    enemies.push({ x: x + 0.5, y: y + 0.5, a: rnd() * Math.PI * 2, patrol: null });
  }
  // часть — патрули (30–60%): ходят между своим местом и точкой в 6–14 м (не на виду у старта отряда); остальные держат позиции
  const nPatrol = Math.round(enemies.length * (0.3 + rnd() * 0.3));
  const order = enemies.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, nPatrol)) {
    const e = enemies[i], f = bfsFrom(e.x * TILE, e.y * TILE, 14, true);
    const pts = cand.filter(([x, y]) => { const d = f.f[y * w + x]; return d >= 6 && d <= 14; });
    if (!pts.length) continue;
    const [px, py] = pts[Math.floor(rnd() * pts.length)];
    e.patrol = [[Math.floor(e.x), Math.floor(e.y)], [px, py]];
  }
  return { start, enemies };
}

// ---------- Хаб ----------
const inRect = (o, r) => o.x >= r.x0 * TILE && o.x < (r.x1 + 1) * TILE && o.y >= r.y0 * TILE && o.y < (r.y1 + 1) * TILE;
const tableNear = (o) => G.mapId === 'hub' && !!o && Math.hypot(o.x - (HUB_TABLE.x0 + HUB_TABLE.x1 + 1) / 2 * TILE, o.y - (HUB_TABLE.y0 + HUB_TABLE.y1 + 1) / 2 * TILE) < TABLE_R + M(1.5);

// Каждый кадр (хост, одиночка): хост стоит в проходе — счёт до перехода
function updateHub(dt) {
  if (G.mapId !== 'hub') return;              // счёт перехода на других картах ведут они сами («Штурм»); сброс — в startMap
  const host = G.players.find((q) => q.slot === 0 && !q.ai) || me();
  const i = host && !host.dead ? HUB_EXITS.findIndex((e) => inRect(host, e)) : -1;
  if (i < 0) { G.hubHold = null; return; }
  if (!G.hubHold || G.hubHold.i !== i) G.hubHold = { i, t: 0 };
  G.hubHold.t += dt;
  if (G.hubHold.t >= HUB_HOLD) {
    const id = HUB_EXITS[i].map, seed = (Math.random() * 4294967296) >>> 0;
    launchMap(id, id === 'assault' ? assaultSeed(seed, 1) : seed);      // «Штурм» из хаба — всегда с 1-й локации
  }
}

// Хост: на карту (из хаба — новый seed, перезапуск — тот же); всем гостям — 'start'
function launchMap(id, seed) {
  G.hubHold = null;
  startMap(id, seed, G.lastSquad, G.lastBots);
  if (G.role === 'host') broadcast({ t: 'start' });
}
// win — «покинуть боевую зону» у грузовика; Backspace и гибель отряда — поражение (для забега — с итогами)
function backToHub(win = false) {
  if (G.role === 'guest' || !map || G.mapId === 'hub') return;
  if (G.run) { endRun(win); return; }
  launchMap('hub', 0);
}

// ---------- Забег («Выживание», «Штурм»): от входа из хаба до возвращения ----------
// G.run: cleared — волн отбито / локаций зачищено, kills — убито противников, losses — погибло бойцов отряда (люди и боты).
// Конец забега — всегда в хаб: «покинуть боевую зону» (победа), Backspace или гибель отряда (поражение, через RUN_DEAD_T с).
// Итоги — эффект 'result' (видят все), в хабе — G.runResult; счёт следующего забега — с нуля.
const RUN_DEAD_T = 5;
const RUN_RESULT_T = 25;         // с: итоги видны в хабе
function startRun(id) {
  const stage = id === 'assault' ? assaultStage(G.mapSeed) : 0;
  if (id === 'surv' || (id === 'assault' && (stage === 1 || !G.run || G.run.mode !== 'assault'))) G.run = { mode: id, cleared: 0, kills: 0, losses: 0 };
  else if (id !== 'assault') G.run = null;
  if (id !== 'hub') G.runResult = null;
}
function endRun(win) {
  const r = G.run;
  G.run = null; G.assaultCarry = null;
  launchMap('hub', 0);
  emit(['result', win ? 1 : 0, r.mode === 'assault' ? 1 : 0, r.cleared, r.kills, r.losses]);
}
function runCount(o) {
  if (!G.run) return;
  if (o.side === 'e') G.run.kills++; else G.run.losses++;
}

// ---------- Оружейный стол: выбор двух полноразмерных (слот 2 может быть пустым), пистолет — всегда ----------
const loadoutEl = document.getElementById('loadout');
function openLoadout() {
  const p = me();
  if (!p || !loadoutEl) return;
  const cur = [p.kit[0] ? p.kit[0].t : 'm4a1', p.kit[1] ? p.kit[1].t : '', p.kit[2] ? p.kit[2].t : 'm1911'];
  const opt = (ids, sel, allowNone) => (allowNone ? '<option value="">— пусто —</option>' : '') +
    ids.map((t) => `<option value="${t}"${t === sel ? ' selected' : ''}>${WEAPONS[t].name} — ${WEAPONS[t].cal}</option>`).join('');
  loadoutEl.querySelector('#lo1').innerHTML = opt(PRIMARY_IDS, cur[0], false);
  loadoutEl.querySelector('#lo2').innerHTML = opt(PRIMARY_IDS, cur[1], true);
  loadoutEl.querySelector('#lo3').innerHTML = opt(PISTOL_IDS, cur[2], false);
  loadoutEl.querySelector('#loErr').textContent = '';
  loadoutEl.classList.remove('hidden');
  for (const k in keys) keys[k] = false;
}
function closeLoadout() { if (loadoutEl) loadoutEl.classList.add('hidden'); }
const loadoutOpen = () => !!loadoutEl && !loadoutEl.classList.contains('hidden');
if (loadoutEl) {
  loadoutEl.querySelector('#loOk').addEventListener('click', () => {
    const a = loadoutEl.querySelector('#lo1').value, b = loadoutEl.querySelector('#lo2').value, c = loadoutEl.querySelector('#lo3').value;
    if (a === b) { loadoutEl.querySelector('#loErr').textContent = 'Два одинаковых ствола брать незачем — выберите разные.'; return; }
    const p = me();
    if (p) doAct(p, `kit:${a},${b},${c}`);
    closeLoadout();
  });
  loadoutEl.querySelector('#loCancel').addEventListener('click', closeLoadout);
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && loadoutOpen()) { e.stopImmediatePropagation(); closeLoadout(); } }, true);
}

// Действие 'kit:a,b,c' (у хоста): новое снаряжение с полным боекомплектом — только в хабе, у стола; запоминается за местом.
// a, b — полноразмерные (b может быть пустым), c — пистолет (нет — Colt M1911)
function applyKitAct(p, k) {
  if (G.mapId !== 'hub' || !tableNear(p)) return;
  const [a, b, c0] = k.slice(4).split(',');
  const c = c0 || 'm1911';
  if (!PRIMARY_IDS.includes(a) || (b && (!PRIMARY_IDS.includes(b) || b === a)) || !PISTOL_IDS.includes(c)) return;
  giveKit(p, a, b || null, c);
  G.kits = G.kits || {};
  G.kits[p.slot] = [a, b || null, c];
  emit(['toast', p.id, `СНАРЯЖЕНИЕ: ${WEAPONS[a].name}${b ? ' + ' + WEAPONS[b].name : ''} + ${WEAPONS[c].name}`]);
}

// ---------- Отрисовка: надписи у проходов, счёт перехода, подсказка у стола (в координатах мира) ----------
function drawHubWorld() {
  if (G.mapId !== 'hub') return;
  ctx.save();
  HUB_EXITS.forEach((e, i) => {
    const X = e.x0 * TILE, Y = e.y0 * TILE, W = (e.x1 - e.x0 + 1) * TILE, H = (e.y1 - e.y0 + 1) * TILE;
    const hold = G.hubHold && G.hubHold.i === i ? clamp(G.hubHold.t / HUB_HOLD, 0, 1) : 0;
    ctx.fillStyle = `rgba(240,190,60,${0.12 + hold * 0.3})`; ctx.fillRect(X, Y, W, H);
    ctx.strokeStyle = 'rgba(240,190,60,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(X, Y, W, H); ctx.setLineDash([]);
    if (hold > 0) { ctx.fillStyle = 'rgba(240,190,60,0.85)'; ctx.fillRect(X, Y + H - 4, W * hold, 4); }
    ctx.fillStyle = '#f0d890'; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText(e.name, X + W / 2, Y + H + 14);
    ctx.fillStyle = 'rgba(232,228,216,0.6)'; ctx.font = '9px Consolas, monospace';
    ctx.fillText(e.desc, X + W / 2, Y + H + 26);
  });
  const tx = (HUB_TABLE.x0 + HUB_TABLE.x1 + 1) / 2 * TILE, ty = (HUB_TABLE.y1 + 1) * TILE;
  ctx.fillStyle = '#f0d890'; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'center';
  ctx.fillText('ОРУЖЕЙНЫЙ СТОЛ', tx, ty + 14);
  ctx.restore();
}
