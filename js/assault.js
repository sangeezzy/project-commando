'use strict';
// ---------- «Штурм» (карта 4, процедурная): зачистить локацию — переход на следующую, каждая сложнее ----------
// Локация n (seed = база + n в старших битах, см. assaultSeed): противников ASSAULT.enemies(n); площадь — по их числу; форма — прямоугольник,
// квадрат, Г, Т, крест, П; здания (одиночные и Г-образные), двери трёх типов, часть заперта — ключи лежат там, куда можно дойти без этих
// дверей; машины, контейнеры, укрытия. Противники — как в «Зачистке»: охрана и патрули, вне видимости старта. Погода — своя на локации.
// Подкрепление — 20% (REINF). Все уничтожены — после 3, 6, 9, 12, дальше каждой второй локации — грузовик (как в «Выживании»),
// потом открывается переход (в дальнем конце; хост стоит 2 с). Состояние отряда (оружие, патроны, здоровье, броня) — на следующую локацию.

const ASSAULT = {
  enemies: (n) => Math.min(30, 6 + 2 * (n - 1)),
  area: (k) => 1600 + k * 170,               // м² (клеток) на k противников
  shapes: ['rect', 'square', 'L', 'T', 'cross', 'U'],
};
// Форма карты — клетки сетки (столбец, строка); нижний ряд — со стартом посередине (там дорога и стоянка грузовика)
const SHAPE_CELLS = {
  rect: [[0, 0]], square: [[0, 0]],
  L: [[0, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  cross: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  U: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
};
const assaultSeed = (base, stage) => (((base & 0xFFFFF) | (stage << 20)) >>> 0);
const assaultStage = (seed) => Math.max(1, seed >>> 20);
const KEY_IDS = [['red', 'Красный ключ'], ['blue', 'Синий ключ'], ['green', 'Зелёный ключ'], ['yellow', 'Жёлтый ключ'], ['white', 'Белый ключ'], ['black', 'Чёрный ключ']];

function buildAssault(seed) {
  const stage = assaultStage(seed), rnd = makeRng((seed ^ 0xA55A17) >>> 0);
  const ri = (a, z) => a + Math.floor(rnd() * (z - a + 1));
  const shape = ASSAULT.shapes[Math.floor(rnd() * ASSAULT.shapes.length)];
  const cells = SHAPE_CELLS[shape];
  const cols = Math.max(...cells.map((c) => c[0])) + 1, rows = Math.max(...cells.map((c) => c[1])) + 1;
  const area = ASSAULT.area(ASSAULT.enemies(stage));
  // размер клетки сетки: площадь формы ≈ area; прямоугольник — вытянутый, квадрат — нет
  let cw, ch;
  if (shape === 'rect') { const asp = 1.3 + rnd() * 0.7; cw = Math.round(Math.sqrt(area * asp)); ch = Math.round(area / cw); }
  else { cw = ch = Math.round(Math.sqrt(area / cells.length)); }
  cw = Math.max(cw, 28); ch = Math.max(ch, 24);
  const W = cols * cw + 2, H = rows * ch + 2;
  const b = new MapBuilder(W, H, seed);
  b.wm.fill(WM.VOID);
  const inShape = (x, y) => cells.some(([cx, cy]) => x >= 1 + cx * cw && x < 1 + (cx + 1) * cw && y >= 1 + cy * ch && y < 1 + (cy + 1) * ch);
  // пол — внутри формы (у края — забор: стена из бетона), снаружи — пустота
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!inShape(x, y)) continue;
    const edge = !inShape(x - 1, y) || !inShape(x + 1, y) || !inShape(x, y - 1) || !inShape(x, y + 1);
    if (edge) b.set(x, y, T.WALL, WM.CONCRETE); else b.set(x, y, T.FLOOR, FM.ASPHALT);
  }
  for (let i = 0; i < 3 + cells.length; i++) {
    const [cx, cy] = cells[Math.floor(rnd() * cells.length)];
    const x = 2 + cx * cw + ri(0, cw - 14), y = 2 + cy * ch + ri(0, ch - 12);
    for (let yy = y; yy < y + ri(6, 12); yy++) for (let xx = x; xx < x + ri(8, 14); xx++) if (b.inside(xx, yy) && b.grid[yy * W + xx] === T.FLOOR) b.fl[yy * W + xx] = rnd() < 0.5 ? FM.GRAVEL : FM.DIRT;
  }
  // старт и дорога: нижний ряд, клетка со стартом — посередине; дорога от нижнего края вверх на 14 клеток (въезд грузовика)
  const bottom = cells.filter((c) => c[1] === rows - 1);
  const sc = bottom[Math.floor(bottom.length / 2)];
  const sx = 1 + sc[0] * cw + Math.floor(cw / 2), sy = H - 4;
  for (let y = H - 15; y < H; y++) for (let x = sx - 2; x <= sx + 1; x++) b.set(x, y, T.FLOOR, FM.ASPHALT);
  const occ = new Uint8Array(W * H);
  const mark = (x0, y0, x1, y1, m = 0) => { for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1; };
  const free = (x0, y0, x1, y1, m = 0) => {
    for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || occ[y * W + x] || b.grid[y * W + x] !== T.FLOOR) return false;
    }
    return true;
  };
  mark(sx - 3, H - 16, sx + 2, H - 1);                // дорога и стоянка
  mark(sx + 2, H - 12, sx + 9, H - 2);               // место старта отряда
  // переход: клетка формы, дальняя от старта; у её дальнего края (где есть забор)
  const far = cells.slice().sort((a, c) => Math.hypot(c[0] - sc[0], c[1] - sc[1]) - Math.hypot(a[0] - sc[0], a[1] - sc[1]))[0];
  const fx0 = 1 + far[0] * cw, fy0 = 1 + far[1] * ch;
  const ex = fx0 + Math.floor(cw / 2) - 2, ey = far[1] === rows - 1 && far === sc ? 2 : fy0 + 1;
  const exit = { x0: ex, y0: ey, x1: ex + 4, y1: ey + 1 };
  mark(exit.x0 - 2, exit.y0, exit.x1 + 2, exit.y1 + 3);
  // здания: одиночные и Г-образные (две части с проходом между ними); двери: дерево/металл/броня, часть заперта
  const doors = [];
  const nb = Math.round(area / 380);
  const room = (x, y, w, h, doorsAt) => {
    const wm = rnd() < 0.5 ? WM.BRICK : WM.CONCRETE;
    b.box(x, y, x + w - 1, y + h - 1, wm, FM.INDOOR, doorsAt.map((d) => [d[0], d[1]]));
    b.dark(x + 1, y + 1, x + w - 2, y + h - 2, 0.06 + rnd() * 0.4);
  };
  for (let tries = 0, made = 0; tries < 400 && made < nb; tries++) {
    const w = ri(7, 13), h = ri(6, 10), x = ri(2, W - w - 3), y = ri(2, H - h - 3);
    const L = rnd() < 0.35, w2 = ri(5, 8), h2 = Math.min(ri(5, 8), h);
    // Г: вторая часть пристроена справа к нижней половине
    const bx1 = L ? x + w - 1 + w2 - 1 : x + w - 1, by1 = Math.max(y + h - 1, L ? y + h - 1 : 0);
    if (!free(x, y, bx1, by1, 2)) continue;
    const ds = [];
    const side = ri(0, 3);
    const outer = (s) => (s === 0 ? [ri(x + 1, x + w - 2), y] : s === 1 ? [ri(x + 1, x + w - 2), y + h - 1] : s === 2 ? [x, ri(y + 1, y + h - 2)] : null);
    const d1 = outer(side) || [ri(x + 1, x + w - 2), y + h - 1];
    ds.push(d1);
    if (rnd() < 0.5) { const d2 = outer((side + 1) % 3); if (d2) ds.push(d2); }
    room(x, y, w, h, ds);
    for (const d of ds) doors.push(d);
    if (L) {
      const x2 = x + w - 1, y2 = y + h - h2;
      room(x2, y2, w2, h2, []);
      const inner = [x2, ri(y2 + 1, y2 + h2 - 2)];                       // проход между частями (дверь в общей стене)
      b.set(inner[0], inner[1], T.FLOOR, FM.INDOOR);
      doors.push(inner);
    }
    mark(x, y, bx1, by1, 1);
    made++;
  }
  // двери: тип и замок
  const keysLeft = KEY_IDS.slice(Math.floor(rnd() * 2));
  const locked = [];
  for (const [x, y] of doors) {
    const r = rnd(), type = r < 0.5 ? 'wood' : r < 0.85 ? 'metal' : 'armored';
    const lock = (type === 'armored' ? rnd() < 0.7 : rnd() < 0.25) && keysLeft.length;
    if (lock) { const [id, name] = keysLeft.shift(); b.door(x, y, type, { key: id }); locked.push({ x, y, id, name }); }
    else b.door(x, y, type === 'armored' && rnd() < 0.5 ? 'metal' : type);
  }
  // машины, контейнеры, укрытия
  const props = (kind, n, len, wid, colors) => {
    for (let i = 0, tries = 0; i < n && tries < 300; tries++) {
      const vert = rnd() < 0.5, w = vert ? wid : len, h = vert ? len : wid, x = ri(2, W - w - 2), y = ri(2, H - h - 2);
      if (!free(x, y, x + w - 1, y + h - 1, 1)) continue;
      b.prop(kind, x, y, x + w - 1, y + h - 1, { color: colors[Math.floor(rnd() * colors.length)] });
      mark(x, y, x + w - 1, y + h - 1, 1);
      i++;
    }
  };
  props('container', Math.round(area / 1200), 6, 2, ['#3f5f7a', '#7a3f32', '#5f6a3a', '#8a6a2a']);
  props('car', Math.round(area / 900), 4, 2, ['#6c7580', '#7a3b32', '#c9c3b5', '#2f3a48']);
  const lows = [[WM.JERSEY, 2, 4], [WM.SANDBAG, 2, 3], [WM.CRATE, 1, 2], [WM.BARREL, 1, 1]];
  for (let i = 0, tries = 0, n = Math.round(area / 110); i < n && tries < 900; tries++) {
    const [wm, a, z] = lows[Math.floor(rnd() * lows.length)], len = ri(a, z), vert = rnd() < 0.5;
    const x = ri(2, W - 6), y = ri(2, H - 6), x1 = vert ? x : x + len - 1, y1 = vert ? y + len - 1 : y;
    if (!free(x, y, x1, y1, 1)) continue;
    b.low(x, y, x1, y1, wm);
    mark(x, y, x1, y1, 1);
    i++;
  }
  // ключи: туда, куда можно дойти со старта, не открывая запертых (ни одной) — и не в помещении
  const meta = { name: `ШТУРМ · ЛОКАЦИЯ ${stage}`, start: { x: sx + 5, y: sy - 3, a: -Math.PI / 2 }, exit, assault: { stage, shape },
    truck: { cx: sx, park: H - 12, from: H + 9, to: H + 9 } };       // грузовик въезжает снизу, стоит у старта, уезжает задним ходом
  const m = finishMap(b, meta);
  const reach = bfsFrom((sx + 5.5) * TILE, (sy - 2.5) * TILE, 1e9, true);
  const spots = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (walkable(x, y) && reach.f[y * W + x] < 1e9 && m.fl[y * W + x] !== FM.INDOOR) spots.push([x, y]);
  }
  for (const k of locked) {
    const [x, y] = spots[Math.floor(rnd() * spots.length)];
    m.keys.push({ id: k.id, name: k.name, x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, taken: false, color: KEY_COLORS[k.id] || '#d0b030' });
  }
  return m;
}

// ---------- Противники локации ----------
// Как «Зачистка»: дойти можно, ≥ 16 м от старта, ни один не на прямой линии со стартом, друг от друга ≥ 4 м; 30–60% — патрули
function assaultSetup(rnd) {
  const { w, h } = map, stage = map.assault.stage, st = map.start;
  const team = SPAWN_OFF.map(([ox, oy]) => ({ x: (st.x + ox) * TILE, y: (st.y + oy) * TILE }));
  const reach = bfsFrom(team[0].x, team[0].y, 1e9, true);
  const cand = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!walkable(x, y) || reach.f[y * w + x] >= 1e9) continue;
    const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
    if (team.some((t) => Math.hypot(t.x - cx, t.y - cy) < M(16) || los(t.x, t.y, cx, cy))) continue;
    cand.push([x, y]);
  }
  const n = ASSAULT.enemies(stage), enemies = [];
  for (let tries = 0; tries < 6000 && enemies.length < n && cand.length; tries++) {
    const [x, y] = cand[Math.floor(rnd() * cand.length)];
    if (enemies.some((e) => Math.hypot(e.x - (x + 0.5), e.y - (y + 0.5)) < 4)) continue;
    enemies.push({ x: x + 0.5, y: y + 0.5, a: rnd() * Math.PI * 2, patrol: null });
  }
  const order = enemies.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, Math.round(enemies.length * (0.3 + rnd() * 0.3)))) {
    const e = enemies[i], f = bfsFrom(e.x * TILE, e.y * TILE, 14, true);
    const pts = cand.filter(([x, y]) => { const d = f.f[y * w + x]; return d >= 6 && d <= 14; });
    if (pts.length) e.patrol = [[Math.floor(e.x), Math.floor(e.y)], pts[Math.floor(rnd() * pts.length)]];
  }
  return { enemies, spawns: cand };
}
// Оружие: первая локация — пистолеты и ружья, дальше — как на других картах
function kitForStage(e, n, rnd) { if (n <= 1) kitForWave(e, 3, rnd); else randomKit(e, rnd); }

// startMap('assault', seed): противники, погода, подкрепление; со второй локации — отряд как был в конце прошлой (G.assaultCarry)
function assaultInit(rnd) {
  const stage = map.assault.stage, setup = assaultSetup(rnd);
  for (const m of setup.enemies) { const e = makeEnemy(m.x * TILE, m.y * TILE, m.a, m.patrol); kitForStage(e, stage, rnd); G.enemies.push(e); }
  if (stage === 1) G.assaultCarry = null;           // новый заход из хаба — без старого отряда
  const carry = stage > 1 ? G.assaultCarry : null;
  G.surv = { mode: 'assault', rnd, stage, wave: 0, phase: 'fight', t: 0, toSpawn: 0, trucks: carry ? carry.trucks : 0, stop: carry ? carry.trucks : 0,
    truck: null, medic: null, spawns: setup.spawns, tilesOn: false, waitT: 0, reinf: reinfRoll(rnd, setup.enemies.length) };
  initWeather(rollWeather(rnd));
  if (carry) for (const q of G.players) {
    const c = carry.squad[q.slot];
    if (!c) continue;
    q.kit = c.kit.map((k) => (k ? Object.assign(makeGun(k.t), { mag: k.mag, chamber: k.chamber, pouch: [...k.pouch], mode: k.mode }) : null));
    q.cur = c.cur; q.gun = q.kit[q.cur] || q.kit[2];
    q.hp = c.dead ? 50 : c.hp;                     // погибшие — снова в строю, но потрёпанные
    q.armor = c.armor ? { ...c.armor } : null;
  } else for (const q of G.players) q.armor = null;
}

// Ход локации (хост): бой (подкрепление) → все уничтожены → грузовик (если положен) → переход открыт (хост стоит 2 с) → следующая
function updateAssault(dt) {
  const s = G.surv;
  if (s.phase === 'fight') {
    updateReinf();
    if (!G.enemies.some((e) => !e.dead)) {
      if (s.reinf) s.reinf.done = true;
      if (SURV.truckDue(s.stage)) {
        s.phase = 'truck'; s.trucks++; s.stop++; s.waitT = 0;
        s.truck = { state: 'in', t: 0, fy: map.truck.from };
        s.medic = { state: 'hidden', t: 0, x: 0, y: 0, a: 0, heal: 0 };
        emit(['banner', `ЛОКАЦИЯ ${s.stage} ЗАЧИЩЕНА — ГРУЗОВИК`, `пополнить боеприпасы и броню ${ARMOR_ORDER[Math.min(s.trucks, 4)]} — у заднего борта (F), лечение — у медика`]);
      } else {
        s.phase = 'exit';
        emit(['banner', `ЛОКАЦИЯ ${s.stage} ЗАЧИЩЕНА`, 'переход на следующую открыт (хост стоит в нём 2 с)']);
      }
    }
  } else if (s.phase === 'truck') updateTruck(dt);
  else if (s.phase === 'exit') {
    const host = G.players.find((q) => q.slot === 0 && !q.ai) || me();
    if (!host || host.dead || !inRect(host, map.exit)) { G.hubHold = null; return; }
    if (!G.hubHold) G.hubHold = { i: 0, t: 0 };
    G.hubHold.t += dt;
    if (G.hubHold.t >= HUB_HOLD) nextStage();
  }
}

// На следующую локацию: запомнить отряд (оружие, патроны, здоровье, броня; Enter на новой локации — с этим же), новый seed — с номером
function nextStage() {
  const s = G.surv;
  G.assaultCarry = {
    trucks: s.trucks,
    squad: Object.fromEntries(G.players.map((q) => [q.slot, {
      kit: q.kit.map((k) => (k ? { t: k.t, mag: k.mag, chamber: k.chamber, pouch: [...k.pouch], mode: k.mode } : null)),
      cur: q.cur, hp: q.down ? 25 : q.hp, dead: q.dead, armor: q.armor ? { ...q.armor } : null,
    }])),
  };
  G.hubHold = null;
  launchMap('assault', assaultSeed(G.mapSeed, s.stage + 1));
}

function drawAssaultExit() {
  const s = G.surv;
  if (!s || s.mode !== 'assault' || s.phase !== 'exit' || !map.exit) return;
  const e = map.exit, X = e.x0 * TILE, Y = e.y0 * TILE, W = (e.x1 - e.x0 + 1) * TILE, H = (e.y1 - e.y0 + 1) * TILE;
  const hold = G.hubHold ? clamp(G.hubHold.t / HUB_HOLD, 0, 1) : 0;
  ctx.save();
  ctx.fillStyle = `rgba(120,230,120,${0.15 + hold * 0.3})`; ctx.fillRect(X, Y, W, H);
  ctx.strokeStyle = 'rgba(120,230,120,0.8)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(X, Y, W, H); ctx.setLineDash([]);
  if (hold > 0) { ctx.fillStyle = 'rgba(120,230,120,0.9)'; ctx.fillRect(X, Y + H - 4, W * hold, 4); }
  ctx.fillStyle = '#b8f0b0'; ctx.font = '11px Consolas, monospace'; ctx.textAlign = 'center';
  ctx.fillText(`ПЕРЕХОД: ЛОКАЦИЯ ${s.stage + 1}`, X + W / 2, Y + H + 14);
  ctx.restore();
}
