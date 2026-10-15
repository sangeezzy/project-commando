'use strict';
// ---------- «Выживание» (карта 3, процедурная): волны, грузовик с боеприпасами и медиком, броня, погода ----------
// Волна n — SURV.size(n) противников; приходят группами по 2–4 у краёв карты (не ближе SURV.spawnMin к отряду, вне его прямой видимости
// и сами его не видят), идут к центру; «директор» раз в SURV.dirT с гонит отставших к отряду. Оружие: волны 1–2 — пистолеты,
// 3–4 — пистолеты и ружья, дальше — как на других картах. После волн 3, 6, 9, 12, дальше — каждой второй: грузовик (въезжает с юга,
// стоит на площади): у заднего борта (F) — пополнить боеприпасы и броню (класс — по числу приездов: IIIA → III → III+ → IV) или
// покинуть боевую зону; из пассажирской двери выходит медик — лечит каждого по отдельности. Пока грузовик стоит — пауза: уедет, только
// если отпустить — F у водительской двери («Двигай, шеф!») или подойти к нему, а потом всем людям отойти дальше половины карты;
// уезжая, водитель прощается. Боты отряда тоже пополняются и лечатся; покинуть зону не могут.

const SURV = {
  W: 80, H: 60,
  size: (n, first = 4) => Math.min(40, first + 2 * (n - 1)),     // противников в волне: первая — first (по отряду, firstCount), дальше +2
  truckDue: (n) => (n <= 12 ? n % 3 === 0 : n % 2 === 0),
  maxAlive: 14,                                    // одновременно на карте
  group: [2, 4], groupGap: [3, 6],                 // группа: человек; между группами, с
  spawnMin: M(25), dirT: 5,
  firstBreak: 8, breakT: 10, afterTruck: 6,
  drive: 7, medicWalk: 1.5, departDelay: 3,
  visitR: M(7),                                    // подошёл к грузовику ближе — «подходили» (дальше — можно отпустить, отойдя на полкарты)
  supplyT: 2.5, healT: 4, reach: M(1.6),
  truckLen: 8, truckW: 3,                          // клетки
};
const SURV_PHASES = ['break', 'wave', 'truck', 'fight', 'exit'];    // fight, exit — «Штурм»
const MODES = ['survival', 'assault'];
const TRUCK_STATES = ['in', 'park', 'out', 'gone'];
const MEDIC_STATES = ['hidden', 'exit', 'stand', 'return'];

// ---------- Карта ----------
function buildSurvival(seed) {
  const rnd = makeRng((seed ^ 0x5eed1e) >>> 0);
  const { W, H } = SURV, cx = W / 2, cy = H / 2;
  const b = new MapBuilder(W, H, seed);
  b.fill(1, 1, W - 2, H - 2, FM.ASPHALT);
  for (let i = 0; i < 4; i++) {
    const x = 2 + Math.floor(rnd() * (W - 20)), y = 2 + Math.floor(rnd() * (H - 16));
    b.fill(x, y, x + 8 + Math.floor(rnd() * 10), y + 6 + Math.floor(rnd() * 8), rnd() < 0.5 ? FM.GRAVEL : FM.DIRT);
  }
  b.fill(cx - 9, cy - 7, cx + 8, cy + 6, FM.CONCRETE);                  // площадь
  // занято: дорога (север–юг, для грузовика) и площадь — свободны всегда; дальше — что уже поставили (с запасом)
  const occ = new Uint8Array(W * H);
  const mark = (x0, y0, x1, y1, m = 0) => { for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1; };
  const free = (x0, y0, x1, y1, m = 0) => { for (let y = y0 - m; y <= y1 + m; y++) for (let x = x0 - m; x <= x1 + m; x++) if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || occ[y * W + x]) return false; return true; };
  mark(cx - 4, 0, cx + 3, H - 1);                 // дорога
  mark(cx - 9, cy - 7, cx + 8, cy + 6);           // площадь
  const ri = (a, z) => a + Math.floor(rnd() * (z - a + 1));
  // здания: проёмы (без дверей) на 1–3 стенах, внутри полумрак, иногда перегородка
  let nb = 0;
  for (let tries = 0; tries < 200 && nb < 7; tries++) {
    const w = ri(7, 12), h = ri(6, 9), x = ri(2, W - w - 3), y = ri(2, H - h - 3);
    if (!free(x, y, x + w - 1, y + h - 1, 2)) continue;
    const doors = [];
    const sides = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, ri(1, 3));
    for (const s of sides) {
      if (s === 0) doors.push([ri(x + 1, x + w - 2), y]); else if (s === 1) doors.push([ri(x + 1, x + w - 2), y + h - 1]);
      else if (s === 2) doors.push([x, ri(y + 1, y + h - 2)]); else doors.push([x + w - 1, ri(y + 1, y + h - 2)]);
    }
    b.box(x, y, x + w - 1, y + h - 1, rnd() < 0.5 ? WM.BRICK : WM.CONCRETE, FM.INDOOR, doors);
    if (w >= 10) { const px = x + Math.floor(w / 2); b.wall(px, y + 1, px, y + h - 2, WM.BRICK); b.set(px, y + ri(1, h - 2), T.FLOOR, FM.INDOOR); }
    b.dark(x + 1, y + 1, x + w - 2, y + h - 2, 0.12 + rnd() * 0.35);
    mark(x, y, x + w - 1, y + h - 1, 1);
    nb++;
  }
  // контейнеры и машины
  const props = (kind, n, len, wid, colors) => {
    for (let i = 0, tries = 0; i < n && tries < 200; tries++) {
      const vert = rnd() < 0.5, w = vert ? wid : len, h = vert ? len : wid, x = ri(2, W - w - 2), y = ri(2, H - h - 2);
      if (!free(x, y, x + w - 1, y + h - 1, 1)) continue;
      b.prop(kind, x, y, x + w - 1, y + h - 1, { color: colors[Math.floor(rnd() * colors.length)] });
      mark(x, y, x + w - 1, y + h - 1, 1);
      i++;
    }
  };
  props('container', ri(3, 5), 6, 2, ['#3f5f7a', '#7a3f32', '#5f6a3a', '#8a6a2a']);
  props('car', ri(4, 6), 4, 2, ['#6c7580', '#7a3b32', '#c9c3b5', '#2f3a48']);
  // низкие укрытия
  const lows = [[WM.JERSEY, 2, 4], [WM.SANDBAG, 2, 3], [WM.CRATE, 1, 2], [WM.BARREL, 1, 1]];
  for (let i = 0, tries = 0; i < ri(30, 45) && tries < 600; tries++) {
    const [wm, a, z] = lows[Math.floor(rnd() * lows.length)], len = ri(a, z), vert = rnd() < 0.5;
    const x = ri(2, W - 6), y = ri(2, H - 6), x1 = vert ? x : x + len - 1, y1 = vert ? y + len - 1 : y;
    if (!free(x, y, x1, y1, 1)) continue;
    b.low(x, y, x1, y1, wm);
    mark(x, y, x1, y1, 1);
    i++;
  }
  // площадь: блоки по углам (укрытие у грузовика), дорогу не трогают
  b.low(cx - 8, cy - 6, cx - 6, cy - 6, WM.JERSEY); b.low(cx + 5, cy - 6, cx + 7, cy - 6, WM.JERSEY);
  b.low(cx - 8, cy + 5, cx - 6, cy + 5, WM.JERSEY); b.low(cx + 5, cy + 5, cx + 7, cy + 5, WM.JERSEY);
  for (let x = 3; x < W - 3; x += 3) if (x < cx - 9 || x > cx + 8) b.ent('stripe', x, cy + 0.42, { w: 1.6, h: 0.16 });
  return finishMap(b, { name: 'ВЫЖИВАНИЕ', start: { x: cx + 6, y: cy + 1, a: -Math.PI / 2 }, surv: { cx, cy },
    truck: { cx, park: cy - 4, from: H + 9, to: -14 } });     // въезжает с юга, стоит на площади, уезжает на север
}

// ---------- Состояние ----------
// rnd — генератор карты (startMap): волны, точки появления, погода — те же при перезапуске
function survInit(rnd) {
  const { cx, cy } = map.surv;
  // точки появления: проходимые клетки у краёв (до 8 клеток), до центра можно дойти
  const reach = bfsFrom((cx + 0.5) * TILE, (cy + 0.5) * TILE, 1e9, true);
  const spawns = [];
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (Math.min(x, y, map.w - 1 - x, map.h - 1 - y) > 8 || !walkable(x, y) || reach.f[y * map.w + x] >= 1e9) continue;
    spawns.push([x, y]);
  }
  G.surv = { mode: 'survival', rnd, wave: 0, stage: 0, phase: 'break', t: SURV.firstBreak, toSpawn: 0, spawnT: 0, dirT: 0, trucks: 0, stop: 0,
    truck: null, medic: null, spawns, recent: [], tilesOn: false, waitT: 0, reinf: null, first: firstCount(G.players.length, rnd) };
  initWeather(rollWeather(rnd));
  for (const p of G.players) giveArmor(p, tableArmor(p));     // начинают с бронёй со стола (не брали — без брони)
}

// Первая волна «Выживания» / первая локация «Штурма»: случайно 0,8–1,2 × бойцов отряда (люди и боты), не меньше 1
const firstCount = (squad, rnd = Math.random) => Math.max(1, Math.round(Math.max(1, squad) * (0.8 + 0.4 * rnd())));

const survLeft = () => (G.surv ? G.surv.toSpawn + G.enemies.filter((e) => !e.dead).length : 0);
// Грузовик едет по дороге x = map.truck.cx (север — вперёд): въезд с from до park, отъезд до to (передний край, клетки)
const truckRear = () => ({ x: (map.truck.cx + 0.5) * TILE, y: (G.surv.truck.fy + SURV.truckLen + 0.7) * TILE });
const medicDoor = () => ({ x: (map.truck.cx + 2.2) * TILE, y: (G.surv.truck.fy + 2) * TILE });
const medicSpot = () => ({ x: (map.truck.cx + 3.6) * TILE, y: (G.surv.truck.fy + 3.5) * TILE });
const truckParked = () => !!(G.surv && G.surv.truck && G.surv.truck.state === 'park');
const nearRear = (o) => truckParked() && Math.hypot(o.x - truckRear().x, o.y - truckRear().y) < SURV.reach;
// Водительская дверь — левый борт кабины (кабина — спереди, на севере); середина грузовика
const truckDriver = () => ({ x: (map.truck.cx - 1.5) * TILE, y: (G.surv.truck.fy + 1.2) * TILE });
const truckCenter = () => ({ x: (map.truck.cx + 0.5) * TILE, y: (G.surv.truck.fy + SURV.truckLen / 2) * TILE });
const nearDriver = (o) => truckParked() && !G.surv.truck.go && Math.hypot(o.x - truckDriver().x, o.y - truckDriver().y) < SURV.reach;
// Фразы: боец отправляет водителя (F у двери) и водитель на прощание
const TRUCK_GO_LINES = ['Двигай, шеф!', 'Поехали, поехали!', 'Всё, гони отсюда!', 'Спасибо, шеф, дальше мы сами.', 'Заводи, шеф, пока не прилетело!',
  'Свободен, шеф!', 'Давай, давай, уезжай!', 'Всё взяли — трогай!', 'Шеф, жми на газ!', 'Отваливай, мы прикроем!'];
const TRUCK_BYE_LINES = ['Удачи, мужики!', 'Держитесь там, ещё приеду!', 'Берегите себя!', 'Ни пуха!', 'Живыми останьтесь, ладно?',
  'Не скучайте, скоро буду!', 'Ну, с богом!', 'Не подставляйтесь зря!', 'До встречи, бойцы!', 'Патроны берегите!'];
const pickLine = (list) => list[Math.floor(Math.random() * list.length)];
// Реплика водителя — над кабиной (как реплики бойцов: эффект 'bark', сторона отряда)
const driverBark = (text) => { const d = truckDriver(); emit(['bark', d.x, d.y, text, 'p', 0]); };
const nearMedic = (o) => truckParked() && G.surv.medic && G.surv.medic.state === 'stand' && Math.hypot(o.x - G.surv.medic.x, o.y - G.surv.medic.y) < SURV.reach;

// Грузовик на стоянке — препятствие (клетки — «стена» из металла: не пройти, не видно, пули — как сквозь машину)
function setTruckTiles(on) {
  const s = G.surv, { cx } = map.truck, fy = Math.round(s.truck ? s.truck.fy : map.truck.park);
  if (on === s.tilesOn) return;
  s.tilesOn = on;
  for (let y = fy; y < fy + SURV.truckLen; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const i = y * map.w + x;
    if (on) { map.grid[i] = T.WALL; map.wm[i] = WM.TRUCK; } else { map.grid[i] = T.FLOOR; map.wm[i] = 0; }
  }
  map.ver++;
  fieldCache.clear();
  // кто стоял на месте стоянки — в сторону
  if (on) for (const o of allPeople()) if (!o.dead && circleStuck(o, PR)) { const sp = freeSpotNear(o.x, o.y); o.x = o.px = sp.x; o.y = o.py = sp.y; }
}

// ---------- Ход режима (хост, одиночка) ----------
function updateSurvival(dt) {
  const s = G.surv;
  if (s && s.mode === 'assault') { updateAssault(dt); return; }
  if (!s || G.mapId !== 'surv') return;
  if (s.phase === 'break') {
    s.t -= dt;
    if (s.t <= 0) startWave();
  } else if (s.phase === 'wave') {
    s.spawnT -= dt;
    const alive = G.enemies.filter((e) => !e.dead).length;
    if (s.toSpawn > 0 && s.spawnT <= 0 && alive < SURV.maxAlive) {
      spawnGroup();
      s.spawnT = SURV.groupGap[0] + s.rnd() * (SURV.groupGap[1] - SURV.groupGap[0]);
    }
    s.dirT -= dt;
    if (s.dirT <= 0) { s.dirT = SURV.dirT; directEnemies(); }
    updateReinf();
    // живых — заново: группа могла появиться в этом же кадре
    if (s.toSpawn <= 0 && !G.enemies.some((e) => !e.dead)) waveDone();
  } else if (s.phase === 'truck') updateTruck(dt);
}

function startWave() {
  const s = G.surv;
  s.wave++;
  s.toSpawn = SURV.size(s.wave, s.first);
  s.spawnT = 0; s.dirT = SURV.dirT; s.phase = 'wave';
  // тела позапрошлых волн убрать (держать список коротким)
  G.enemies = G.enemies.filter((e) => !e.dead || (e.wave || 0) >= s.wave - 1);
  setWeather(rollWeather(s.rnd));
  s.reinf = reinfRoll(s.rnd, s.toSpawn);
  emit(['banner', `ВОЛНА ${s.wave}`, `противников: ${s.toSpawn} · погода: ${WEATHER[G.weather.kind].name}`]);
}

function waveDone() {
  const s = G.surv;
  if (s.reinf) s.reinf.done = true;            // волна кончилась — подкрепления уже не будет
  if (G.run) G.run.cleared = s.wave;
  if (SURV.truckDue(s.wave)) {
    s.phase = 'truck'; s.trucks++; s.stop++; s.waitT = 0;
    s.truck = { state: 'in', t: 0, fy: map.truck.from };
    s.medic = { state: 'hidden', t: 0, x: 0, y: 0, a: 0, heal: 0 };
    const cls = ARMOR_ORDER[Math.min(s.trucks, 4)];
    emit(['banner', `ВОЛНА ${s.wave} ОТБИТА — ГРУЗОВИК`, `пополнить боеприпасы и броню ${cls} — у заднего борта (F), лечение — у медика`]);
  } else {
    s.phase = 'break'; s.t = SURV.breakT;
    emit(['banner', `ВОЛНА ${s.wave} ОТБИТА`, `следующая — через ${SURV.breakT} с`]);
  }
}

// Случайная клетка появления, подходящая под условие ok(x, y, px, py): клетки — в случайном порядке до первой подходящей
// (равномерно среди подходящих, но без проверки видимости до всех ~2000 клеток края)
function pickSpawn(list, rnd, ok) {
  const idx = Uint32Array.from(list.keys());
  for (let n = idx.length; n > 0; n--) {
    const k = Math.floor(rnd() * n), i = idx[k];
    idx[k] = idx[n - 1];
    const [x, y] = list[i];
    if (ok(x, y, (x + 0.5) * TILE, (y + 0.5) * TILE)) return list[i];
  }
  return null;
}
// Места n бойцов группы у клетки (x, y): рядами по cols, через 1,2 м
const groupAt = (x, y, n, cols) => Array.from({ length: n }, (_, i) =>
  freeSpotNear((x + 0.5 + (i % cols) * 1.2) * TILE, (y + 0.5 + Math.floor(i / cols) * 1.2) * TILE));
// Отряду не видно ни одного из мест (и не ближе SURV.spawnMin) — проверяются все, а не только первая клетка
const hiddenFrom = (squad, pts) => pts.every((p) => !squad.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < SURV.spawnMin || los(q.x, q.y, p.x, p.y)));

// Группа 2–4 у края: вне прямой видимости отряда (и отряда им не видно), не ближе spawnMin, не там же, где прошлые две
function spawnGroup() {
  const s = G.surv, rnd = s.rnd;
  const squad = G.players.filter((q) => !q.dead);
  const n = Math.min(s.toSpawn, SURV.group[0] + Math.floor(rnd() * (SURV.group[1] - SURV.group[0] + 1)));
  let pts = null;
  const spot = pickSpawn(s.spawns, rnd, (x, y, px, py) => !s.recent.some((r) => Math.hypot(r[0] - x, r[1] - y) < 15) &&
    hiddenFrom(squad, [{ x: px, y: py }]) && hiddenFrom(squad, (pts = groupAt(x, y, n, 2))));
  if (!spot) return;
  const [x, y] = spot;
  s.recent = [[x, y], ...s.recent].slice(0, 2);
  const { cx, cy } = map.surv;
  for (const sp of pts) {
    const e = makeEnemy(sp.x, sp.y, Math.atan2(cy * TILE - sp.y, cx * TILE - sp.x), null);
    kitForWave(e, s.wave, rnd);
    e.wave = s.wave;
    // идут к центру карты (с разбросом) — как «проверить место»
    Object.assign(e, { st: 1, investigate: true, lastX: (cx + (rnd() - 0.5) * 10) * TILE, lastY: (cy + (rnd() - 0.5) * 8) * TILE, goal: null, calmT: 0 });
    G.enemies.push(e);
  }
  s.toSpawn -= n;
}

// Оружие по номеру волны («Штурм» — локации): 1–2 — пистолеты; 3–4 — пистолеты и ружья; 5–6 — половина так же, половина —
// случайный набор (винтовки); дальше — случайный набор, как на других картах
function kitForWave(e, n, rnd) {
  if (n <= 2) giveKit(e, null, null, randomPistol(rnd));
  else if (n <= 4 || (n <= 6 && rnd() < 0.5)) giveKit(e, rnd() < 0.5 ? 'w1300' : null, null, randomPistol(rnd));
  else randomKit(e, rnd, unlockedPrimaries(n));          // открытые к этой волне (UNLOCK): пулемёты — позже
}

// Не в бою и без цели — к отряду (примерно: точка в 12 м от середины отряда)
function directEnemies() {
  const squad = G.players.filter((q) => !q.dead);
  if (!squad.length) return;
  const mx = squad.reduce((a, q) => a + q.x, 0) / squad.length, my = squad.reduce((a, q) => a + q.y, 0) / squad.length;
  for (const e of G.enemies) {
    if (e.dead || e.st === 2 || e.investigate) continue;
    Object.assign(e, { st: 1, investigate: true, lastX: mx + gauss() * M(6), lastY: my + gauss() * M(6), goal: null, calmT: 0, notice: Math.min(e.notice, 0.3) });
  }
}

// ---------- Подкрепление («Выживание» — на волну, «Штурм» — на локацию) ----------
// Шанс REINF.chance бросается один раз в начале; случится в случайный момент (delay) после первой тревоги (кто-то из противников в бою)
// и до конца волны / открытия перехода. Отряд — от minShare до share исходного числа противников, появляется вне видимости отряда
// (и не ближе SURV.spawnMin), идёт туда, где отряд видели в последний раз. В рации — сообщение.
const REINF = { chance: 0.2, share: 0.3, minShare: 0.15, delay: [3, 60] };
const reinfRoll = (rnd, base) => ({ on: rnd() < REINF.chance, base, alarmAt: null, at: null, done: false });
function updateReinf() {
  const s = G.surv, r = s && s.reinf;
  if (!r || !r.on || r.done) return;
  if (r.alarmAt === null) {
    if (G.enemies.some((e) => !e.dead && e.st === 2)) { r.alarmAt = G.time; r.at = G.time + REINF.delay[0] + s.rnd() * (REINF.delay[1] - REINF.delay[0]); }
    return;
  }
  if (G.time >= r.at) { r.done = true; spawnReinf(r); }
}
function spawnReinf(r) {
  const s = G.surv, rnd = s.rnd;
  const n = Math.max(1, Math.min(Math.floor(r.base * REINF.share), Math.round(r.base * (REINF.minShare + rnd() * (REINF.share - REINF.minShare)))));
  const squad = G.players.filter((q) => !q.dead);
  if (!squad.length) return;
  // где отряд видели в последний раз: самое свежее lastX/lastY у противников в тревоге; нет — середина отряда
  let tx = 0, ty = 0, best = -1;
  for (const e of G.enemies) if (!e.dead && e.st === 2 && e.lastSeen > best) { best = e.lastSeen; tx = e.lastX; ty = e.lastY; }
  if (best < 0) { tx = squad.reduce((a, q) => a + q.x, 0) / squad.length; ty = squad.reduce((a, q) => a + q.y, 0) / squad.length; }
  let pts = null;
  const spot = pickSpawn(s.spawns, rnd, (x, y, px, py) => hiddenFrom(squad, [{ x: px, y: py }]) && hiddenFrom(squad, (pts = groupAt(x, y, n, 3))));
  if (!spot) return;
  for (const sp of pts) {
    const e = makeEnemy(sp.x, sp.y, Math.atan2(ty - sp.y, tx - sp.x), null);
    if (s.mode === 'assault') kitForStage(e, s.stage, rnd); else kitForWave(e, s.wave, rnd);
    e.wave = s.wave; e.reinf = true;
    // сразу в тревоге: к последнему месту отряда
    Object.assign(e, { st: 2, target: squad[0], lastX: tx, lastY: ty, lastSeen: G.time - 3, notice: 0.5, goal: null, searchT: 0 });
    G.enemies.push(e);
  }
  emit(['radio', `Внимание: у противника подкрепление — около ${n} чел., идут к вашему последнему месту!`]);
}

// ---------- Грузовик и медик ----------
const easeOut = (k) => 1 - (1 - k) * (1 - k), easeIn = (k) => k * k;
function updateTruck(dt) {
  const s = G.surv, tr = s.truck, md = s.medic, park = map.truck.park;
  tr.t += dt;
  if (tr.state === 'in') {
    tr.fy = map.truck.from + (park - map.truck.from) * easeOut(clamp(tr.t / SURV.drive, 0, 1));
    if (tr.t >= SURV.drive) { tr.state = 'park'; tr.t = 0; tr.fy = park; setTruckTiles(true); md.state = 'exit'; md.t = 0; truckReinforce(); }
  } else if (tr.state === 'park') {
    updateMedic(dt);
    s.waitT += dt;
    // уезжает, только если отпустили: F у водительской двери (tr.go — survAct 'truckgo') или к нему подходили, а потом все живые люди
    // отошли дальше половины карты
    const humans = G.players.filter((q) => !q.ai && !q.dead && !q.evac), c = truckCenter();
    const dist = (q) => Math.hypot(q.x - c.x, q.y - c.y);
    if (humans.some((q) => dist(q) < SURV.visitR)) tr.visited = true;
    if (!tr.go && tr.visited && humans.length && humans.every((q) => dist(q) > Math.max(map.w, map.h) * TILE / 2)) tr.go = 'away';
    if (tr.go) {
      tr.ready = (tr.ready || 0) + dt;
      if (tr.ready >= (tr.go === 'away' ? 0 : SURV.departDelay) && md.state === 'stand' && !md.heal) { md.state = 'return'; md.t = 0; }
    }
    if (md.state === 'hidden' && tr.go && tr.ready) {
      tr.state = 'out'; tr.t = 0; setTruckTiles(false);
      driverBark(pickLine(TRUCK_BYE_LINES));
      emit(['banner', 'ГРУЗОВИК УЕХАЛ', s.mode === 'assault' ? '' : `следующая волна — через ${SURV.afterTruck} с`]);
    }
  } else if (tr.state === 'out') {
    tr.fy = park + (map.truck.to - park) * easeIn(clamp(tr.t / SURV.drive, 0, 1));
    if (tr.t >= SURV.drive) {
      tr.state = 'gone'; s.truck = null; s.medic = null;
      if (s.mode === 'assault') { s.phase = 'exit'; assaultOpenExit(); } else { s.phase = 'break'; s.t = SURV.afterTruck; }
    }
  }
}
// Погибшие бойцы отряда (в новой волне и на новой локации их нет) приезжают на грузовике: у заднего борта, полное здоровье,
// снаряжение — со стола (люди) или новое (боты), без брони — пополнятся у борта
function truckReinforce() {
  const r = truckRear(), back = G.players.filter((q) => q.dead);
  back.forEach((q, i) => {
    const sp = freeSpotNear(r.x + (i - (back.length - 1) / 2) * M(1.2), r.y + M(1.5));
    Object.assign(q, { dead: false, down: false, evac: false, hp: HP, x: sp.x, y: sp.y, px: sp.x, py: sp.y, lx: sp.x, ly: sp.y, a: Math.PI / 2,
      vx: 0, vy: 0, bleed: 0, rev: 0, reviving: 0, revivedBy: null, act: null, armor: null, supp: 0, crouch: false, sprint: false,
      lean: 0, leanWant: 0, leanPx: 0, ads: 0, lamp: false, hurtT: 9 });
    if (q.ai) {
      const { leader, name } = q;
      makeAI(q, q.a, null);
      Object.assign(q, { leader, name });
      botKitFor(q, G.surv.rnd);                     // со стола (и броня), случайное или только пистолет
    } else {
      const k = (G.kits || {})[q.slot];
      if (k) { giveKit(q, k[0], k[1], k[2]); giveArmor(q, tableArmor(q)); } else giveKit(q, 'm4a1', null);   // со стола — и броня
    }
  });
  if (back.length) emit(['radio', `Грузовик привёз пополнение: ${back.map((q) => q.name).join(', ')}`]);
}
function updateMedic(dt) {
  const md = G.surv.medic, door = medicDoor(), spot = medicSpot();
  md.t += dt;
  const k = clamp(md.t / SURV.medicWalk, 0, 1);
  if (md.state === 'exit') {
    md.x = door.x + (spot.x - door.x) * k; md.y = door.y + (spot.y - door.y) * k; md.a = Math.atan2(spot.y - door.y, spot.x - door.x);
    if (k >= 1) { md.state = 'stand'; md.t = 0; }
  } else if (md.state === 'return') {
    md.x = spot.x + (door.x - spot.x) * k; md.y = spot.y + (door.y - spot.y) * k; md.a = Math.atan2(door.y - spot.y, door.x - spot.x);
    if (k >= 1) { md.state = 'hidden'; md.t = 0; }
  } else if (md.state === 'stand') {
    const pt = md.heal && allPeople().find((q) => q.id === md.heal);
    md.a = pt ? Math.atan2(pt.y - md.y, pt.x - md.x) : Math.PI / 2;
  }
}

// ---------- Действия у грузовика (хост проверяет, что рядом) ----------
// 'supply' — пополнить (SURV.supplyT с): все стволы — полный боекомплект, броня — класса по числу приездов, целая;
// 'heal' — у медика (SURV.healT с): здоровье полное; 'evac' — покинуть боевую зону: весь отряд — в хаб (только хост)
function survAct(p, k) {
  const s = G.surv;
  if (!s || p.dead || p.down || p.act) return;
  // supply:a,b,c,броня — свой выбор (меню у борта); просто supply — те же стволы и лучшая доступная броня (боты)
  if (k.startsWith('supply') && nearRear(p)) p.act = { kind: 'supply', t: 0, dur: SURV.supplyT, pick: k.length > 7 ? k.slice(7).split(',') : null };
  else if (k === 'heal' && nearMedic(p) && p.hp < HP && !s.medic.heal) { p.act = { kind: 'heal', t: 0, dur: SURV.healT }; s.medic.heal = p.id; }
  else if (k === 'evac' && nearRear(p) && !p.ai && p.slot === 0) backToHub(true);     // покинуть боевую зону — весь отряд в хаб с итогами (решает хост)
  else if (k === 'truckgo' && nearDriver(p)) {                                         // у водительской двери: отпустить грузовик
    s.truck.go = 'door'; s.truck.ready = 0;
    if (p.ai) bark(p, pickLine(TRUCK_GO_LINES)); else emit(['bark', p.x, p.y, pickLine(TRUCK_GO_LINES), p.side, p.id]);
  }
}
// Каждый кадр, пока идёт действие: отошёл — бросил; время вышло — готово
function survActStep(p, a, dt) {
  const s = G.surv;
  const near = a.kind === 'supply' ? nearRear(p) : nearMedic(p);
  if (!s || !near || p.down || p.dead) { if (a.kind === 'heal' && s && s.medic) s.medic.heal = 0; p.act = null; return false; }
  a.t += dt;
  if (a.t < a.dur) return true;
  if (a.kind === 'supply') {
    const sup = truckSupply(p, a.pick);
    p.supplied = s.stop;
    emit(['toast', p.id, `ПОПОЛНЕНО: ${sup.names}; броня ${sup.arm || 'нет'}`]);
  } else {
    p.hp = HP; p.healed = s.stop; s.medic.heal = 0;
    emit(['toast', p.id, 'ВЫЛЕЧЕН']);
  }
  p.act = null;
  return false;
}

// Броня, взятая на оружейном столе (людям — G.kits, союзным ботам — G.botKits; null — без брони)
const tableArmor = (p) => (p.side === 'p' && (((p.ai ? G.botKits : G.kits) || {})[p.slot] || [])[3]) || null;
// Что можно взять у грузовика сейчас: открытые к этой волне (локации) стволы, свои — тоже; броня — до лучшей привезённой
// или взятой на оружейном столе, если она тяжелее
function truckOffer(p) {
  const s = G.surv, n = s.mode === 'assault' ? s.stage : s.wave;
  const own = p.kit.slice(0, 2).filter(Boolean).map((g) => g.t);
  const ownA = Math.max(0, ARMOR_ORDER.indexOf(tableArmor(p)));
  return { prim: PRIMARY_IDS.filter((t) => unlockedPrimaries(n).includes(t) || own.includes(t)), pist: PISTOL_IDS,
    armors: ARMOR_ORDER.slice(0, Math.max(Math.min(s.trucks, 4), ownA) + 1) };       // [null, 'IIIA', …] — без брони тоже можно (быстрее)
}
// Выдать у грузовика: pick = [ствол 1, ствол 2, пистолет, броня] (проверяется по truckOffer; неверный — как без выбора);
// без выбора — те же стволы и лучшая доступная броня. Всё — с полным боекомплектом.
function truckSupply(p, pick) {
  const off = truckOffer(p);
  let kitT = p.kit.map((g) => g && g.t), arm = off.armors[off.armors.length - 1];
  if (pick) {
    const [w1, w2, pt, ar] = pick;
    const ok = (t) => !t || off.prim.includes(t);
    if (ok(w1) && ok(w2) && (!w1 || w1 !== w2) && off.pist.includes(pt)) kitT = [w1 || null, w2 || null, pt];
    const ai = ar ? off.armors.indexOf(ar) : 0;
    if (ai >= 0) arm = off.armors[ai];
  }
  const old = p.kit;
  p.kit = kitT.map((t, i) => (t ? Object.assign(makeGun(t, ammoFor(t, p.side, p.ai)), { mode: old[i] && old[i].t === t ? old[i].mode : WEAPONS[t].modes[0] }) : null));
  if (!p.kit[p.cur]) p.cur = p.kit[0] ? 0 : p.kit[1] ? 1 : 2;
  p.gun = p.kit[p.cur]; p.off = -1; p.sw = null;
  giveArmor(p, arm);
  return { arm, names: p.kit.filter(Boolean).map((g) => WEAPONS[g.t].name).join(' + ') };
}

// Бот отряда (вне боя), пока грузовик стоит: к заднему борту — пополниться, потом к медику — если ранен. Возвращает true, если занят этим
function survBotStep(e, dt) {
  const s = G.surv;
  if (!truckParked() || e.seeing || e.st === 2 || e.down) return false;
  if (e.act) { e.want = e.act.kind === 'heal' ? Math.atan2(s.medic.y - e.y, s.medic.x - e.x) : -Math.PI / 2; return true; }
  let goal = null, act = null;
  if (e.supplied !== s.stop) { goal = truckRear(); act = 'supply'; }
  else if (e.hp < HP && e.healed !== s.stop && s.medic.state === 'stand') { goal = { x: s.medic.x, y: s.medic.y }; act = 'heal'; }
  if (!goal) return false;
  // дошёл: проверка — та же, что у действия (до заднего борта / до самого медика), с запасом
  if (Math.hypot(goal.x - e.x, goal.y - e.y) < SURV.reach * 0.85) {
    if (act === 'heal' && s.medic.heal) { e.want = Math.atan2(goal.y - e.y, goal.x - e.x); return true; }   // медик занят — подождать рядом
    survAct(e, act);
    return true;
  }
  e.goal = e.goal && e.goal.survKey === act + s.stop ? e.goal : Object.assign(bfsFrom(goal.x, goal.y, 1e9, true), { survKey: act + s.stop });
  const step = fieldStep(e, e.goal);
  if (step === null) { moveDir(e, Math.atan2(goal.y - e.y, goal.x - e.x), ENEMY.speed.walk, dt); e.want = Math.atan2(goal.y - e.y, goal.x - e.x); return true; }
  moveDir(e, step, ENEMY.speed.walk, dt);
  e.want = step;
  return true;
}

// ---------- Меню у заднего борта (F) ----------
const truckMenuEl = document.getElementById('truckMenu');
const truckMenuOpen = () => !!truckMenuEl && !truckMenuEl.classList.contains('hidden');
function openTruckMenu() {
  if (!truckMenuEl || !G.surv) return;
  const host = isAuth();
  const ev = truckMenuEl.querySelector('#tmEvac');
  ev.disabled = !host;
  ev.textContent = host ? 'ПОКИНУТЬ БОЕВУЮ ЗОНУ — ВСЕМ В ХАБ' : 'ПОКИНУТЬ БОЕВУЮ ЗОНУ (решает хост)';
  truckMenuEl.querySelector('#tmSupply').textContent = `ВЗЯТЬ И ПОПОЛНИТЬ — ${String(SURV.supplyT).replace('.', ',')} с`;
  // выбор: открытые к этой волне стволы (и свои), пистолет, броня до привезённой (тяжелее — защищает лучше, но медленнее)
  const p = me(), off = truckOffer(p), cur = p.kit.map((g) => g && g.t);
  const opt = (ids, sel, none) => (none ? `<option value="">${none}</option>` : '') +
    ids.map((t) => `<option value="${t}"${t === sel ? ' selected' : ''}>${WEAPONS[t].name} — ${WEAPONS[t].cal}</option>`).join('');
  truckMenuEl.querySelector('#tmW1').innerHTML = opt(off.prim, cur[0], '— пусто —');
  truckMenuEl.querySelector('#tmW2').innerHTML = opt(off.prim, cur[1], '— пусто —');
  truckMenuEl.querySelector('#tmP').innerHTML = opt(off.pist, cur[2], null);
  // по умолчанию — своя броня, если её ещё можно взять, иначе лучшая привезённая
  const best = off.armors[off.armors.length - 1], selA = p.armor && off.armors.includes(p.armor.cls) ? p.armor.cls : best;
  truckMenuEl.querySelector('#tmArmor').innerHTML = off.armors.map((c) => `<option value="${c || ''}"${c === selA ? ' selected' : ''}>` +
    armorLabel(c) + '</option>').join('');
  truckMenuEl.querySelector('#tmErr').textContent = '';
  truckMenuEl.classList.remove('hidden');
  if (tmBots) tmBots.reset();
  for (const k in keys) keys[k] = false;
}
function closeTruckMenu() { if (truckMenuEl) truckMenuEl.classList.add('hidden'); }
const tmBots = truckMenuEl ? makeBotPanel(truckMenuEl, 'truck') : null;     // снаряжение союзных ботов у грузовика (hub.js)

// Действие 'botsupply:место:a,b,c,броня' (хост): игрок у заднего борта выдаёт союзному боту снаряжение из грузовика (truckOffer бота,
// полный боекомплект, броня — целая); бот считается пополненным на этой стоянке (сам к борту уже не пойдёт)
function survBotSupply(p, k) {
  const s = G.surv, m = /^botsupply:(\d+):(.*)$/.exec(k);
  if (!s || !m || !nearRear(p) || p.dead || p.down) return;
  const bot = G.players.find((o) => o.ai && o.side === 'p' && o.slot === +m[1] && !o.dead);
  if (!bot) return;
  const sup = truckSupply(bot, m[2].split(','));
  bot.supplied = s.stop;
  emit(['toast', p.id, `${bot.name}: ${sup.names}; броня ${sup.arm || 'нет'}`]);
}
if (truckMenuEl) {
  truckMenuEl.querySelector('#tmSupply').addEventListener('click', () => {
    const v = (id) => truckMenuEl.querySelector(id).value;
    const a = v('#tmW1'), b = v('#tmW2');
    if (a && a === b) { truckMenuEl.querySelector('#tmErr').textContent = 'Два одинаковых ствола брать незачем — выберите разные.'; return; }
    const p = me();
    if (p) doAct(p, `supply:${a},${b},${v('#tmP')},${v('#tmArmor')}`);
    closeTruckMenu();
  });
  truckMenuEl.querySelector('#tmEvac').addEventListener('click', () => { const p = me(); if (p) doAct(p, 'evac'); closeTruckMenu(); });
  truckMenuEl.querySelector('#tmCancel').addEventListener('click', closeTruckMenu);
  addEventListener('keydown', (ev) => { if (ev.code === 'Escape' && truckMenuOpen()) { ev.stopImmediatePropagation(); closeTruckMenu(); } }, true);
}
const uiOpen = () => loadoutOpen() || truckMenuOpen() || touchMenuOpen() || TouchUI.edit;

// ---------- Снимок ----------
const survState = () => {
  const s = G.surv;
  if (!s) return 0;
  const tr = s.truck, md = s.medic;
  return [s.wave, SURV_PHASES.indexOf(s.phase), r1(s.t), s.toSpawn, s.trucks, s.stop, MODES.indexOf(s.mode), s.stage || 0,
    tr ? [TRUCK_STATES.indexOf(tr.state), r2(tr.fy), tr.go ? 1 : 0] : 0,       // go — отпущен (у гостя — без подсказки у двери)
    md ? [MEDIC_STATES.indexOf(md.state), r1(md.x), r1(md.y), r2(md.a), md.heal || 0] : 0,
    G.run ? [G.run.cleared, G.run.kills, G.run.losses] : 0];
};
function applySurvState(a) {
  if (!a) { G.surv = null; G.run = null; return; }
  const s = G.surv || (G.surv = { tilesOn: false });
  [s.wave, , s.t, s.toSpawn, s.trucks, s.stop] = a;
  s.phase = SURV_PHASES[a[1]]; s.mode = MODES[a[6]]; s.stage = a[7];
  s.truck = a[8] ? { state: TRUCK_STATES[a[8][0]], fy: a[8][1], go: !!a[8][2] } : null;
  s.medic = a[9] ? { state: MEDIC_STATES[a[9][0]], x: a[9][1], y: a[9][2], a: a[9][3], heal: a[9][4] } : null;
  G.run = a[10] ? { mode: s.mode === 'assault' ? 'assault' : 'surv', cleared: a[10][0], kills: a[10][1], losses: a[10][2] } : null;
  setTruckTiles(!!(s.truck && s.truck.state === 'park'));
}

// ---------- Отрисовка (координаты мира) ----------
function drawTruck() {
  const s = G.surv;
  if (!s || !s.truck || s.truck.state === 'gone') return;
  const { cx } = map.truck, X = (cx - 1) * TILE, Y = s.truck.fy * TILE, Wd = SURV.truckW * TILE, L = SURV.truckLen * TILE;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(X + 6, Y + 6, Wd, L);
  // кабина (спереди, на севере) и кузов под тентом
  ctx.fillStyle = '#4a5038'; roundRect(ctx, X + 2, Y, Wd - 4, TILE * 2.2, 5); ctx.fill();
  ctx.fillStyle = 'rgba(25,35,45,0.85)'; ctx.fillRect(X + 8, Y + 6, Wd - 16, 12);            // лобовое стекло
  ctx.fillStyle = '#5a6145'; roundRect(ctx, X, Y + TILE * 2.4, Wd, L - TILE * 2.4, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) { const yy = Y + TILE * 2.4 + i * (L - TILE * 2.4) / 6; ctx.beginPath(); ctx.moveTo(X + 2, yy); ctx.lineTo(X + Wd - 2, yy); ctx.stroke(); }
  // задний борт: открыт, ящики с патронами видны; дверь пассажира справа у кабины
  if (s.truck.state === 'park') {
    ctx.fillStyle = '#3a3f2c'; ctx.fillRect(X + 4, Y + L - 4, Wd - 8, 8);
    ctx.fillStyle = '#6b5a32'; ctx.fillRect(X + 10, Y + L - 18, 12, 9); ctx.fillRect(X + Wd - 22, Y + L - 18, 12, 9);
    ctx.fillStyle = '#f0d890'; ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText('БОЕПРИПАСЫ · F', X + Wd / 2, Y + L + 18);
  }
  ctx.fillStyle = '#2a2e20'; ctx.fillRect(X + Wd - 3, Y + 10, 3, TILE * 1.2);
  ctx.restore();
}
// Медик: белая форма с красным крестом; лечит — присел к раненому, руки работают, над раненым — зелёные «+»
function drawMedic() {
  const s = G.surv, md = s && s.medic;
  if (!md || md.state === 'hidden') return;
  const healing = md.heal && md.state === 'stand';
  ctx.save();
  ctx.translate(md.x, md.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(3, 3, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(md.a);
  const k = healing ? Math.sin(G.time * 9) : 0;
  ctx.fillStyle = '#c8c8c0';
  ctx.beginPath(); ctx.arc(10 + 3 * k, 5, 3, 0, Math.PI * 2); ctx.fill();          // руки (лечит — двигаются)
  ctx.beginPath(); ctx.arc(10 - 3 * k, -5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e4e4dc'; ctx.beginPath(); ctx.ellipse(0, 0, 6.5 * (healing ? 0.92 : 1), 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
  ctx.fillStyle = '#c03028'; ctx.fillRect(-4, -1.2, 5, 2.4); ctx.fillRect(-2.7, -2.5, 2.4, 5);   // крест на спине
  ctx.fillStyle = '#b8b8b0'; ctx.beginPath(); ctx.arc(0.5 + (healing ? 2 : 0), 0, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (healing) {
    const pt = allPeople().find((q) => q.id === md.heal);
    if (pt) {
      ctx.fillStyle = 'rgba(120,230,120,0.8)'; ctx.font = 'bold 10px Consolas, monospace'; ctx.textAlign = 'center';
      ctx.fillText('+', pt.x + Math.sin(G.time * 3) * 6, pt.y - 16 - (G.time * 20) % 10);
    }
  }
  if (md.state === 'stand' && !healing) {
    ctx.fillStyle = '#f0d890'; ctx.font = '9px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText('МЕДИК · F', md.x, md.y + 22);
  }
}
