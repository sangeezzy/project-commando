'use strict';
// ---------- Машины: вождение, места, попадания (VEHICLES, VEH_ARMOR, VEH в data.js) ----------
// map.cars: { id, model, color, armor, x, y — центр, a — куда смотрит перед, vx, vy — скорость (px/с), w — поворот (рад/с), steer — руль,
//   hp — двигатель (0 — заглох: не едет, из-под капота чёрный дым), seats — id сидящих (0 — свободно; 0-е — водитель),
//   ctrl — { thr: газ −1…1 (назад — тормоз и задний ход), steer: −1…1, hb: ручник }, parked — стоит (клетки под ней — низкое укрытие,
//   stamp — какие), holes — пробоины (в координатах машины), remote — ведёт гость (позу присылает он),
//   flats — спущенные колёса (биты: 1 — переднее левое, 2 — переднее правое, 4 — заднее левое, 8 — заднее правое),
//   bpTires — пулестойкие покрышки, tires — резина (если не задана — по классу машины: tiresOf / TIRE_FOR) }.
// Физика — «велосипедная» модель: сила двигателя падает к максимальной скорости, тормоза с ABS, сцепление шин ограничивает поворот
// (на скорости — снос), ручник срывает задние колёса. Столкновения: стены и укрытия (клетки), другие машины, люди (наезд — урон).
// Пули (vehBullet): кузов, стёкла, салон, двигатель, колёса (спускают, если покрышки не пулестойкие) — по VEH_ARMOR; сидящие внутри —
// цели; свои пули из машины её не задевают. Удар передом (моторным отсеком) — урон двигателю.
// Взрываться машина не может. Водитель — только пистолет; пассажиры — любое оружие.

const vSize = (c) => { const V = VEHICLES[c.model]; return { hl: M(V.len) / 2, hw: M(V.wid) / 2 }; };
// cos / sin угла машины — запомнены, пока она не повернулась (пуля проверяет машины на каждом шаге в 6 px)
function carTrig(c) { if (c._ta !== c.a) { c._ta = c.a; c._co = Math.cos(c.a); c._si = Math.sin(c.a); } }
function toLocal(c, x, y) {
  carTrig(c);
  const dx = x - c.x, dy = y - c.y, co = c._co, si = c._si;
  return { x: dx * co + dy * si, y: -dx * si + dy * co };
}
function toWorld(c, lx, ly) {
  carTrig(c);
  const co = c._co, si = c._si;
  return { x: c.x + lx * co - ly * si, y: c.y + lx * si + ly * co };
}
// Расстояние от точки до кузова (0 — внутри)
function carDist(c, x, y) {
  const L = toLocal(c, x, y), { hl, hw } = vSize(c);
  return Math.hypot(Math.max(0, Math.abs(L.x) - hl), Math.max(0, Math.abs(L.y) - hw));
}
const seatPos = (c, i) => { const s = VEHICLES[c.model].seats[i]; return toWorld(c, M(s[0]), M(s[1])); };
const carSpeed = (c) => Math.hypot(c.vx, c.vy);
const carMass = (c) => VEHICLES[c.model].mass * VEH_ARMOR[c.armor].massK;
function personById(id) {
  if (!id) return null;
  for (const q of G.players) if (q.id === id) return q;
  for (const q of G.enemies) if (q.id === id) return q;
  return null;
}

// ---------- Машины карты ----------
// Из машин-предметов карты (MapBuilder.prop('car')): модель и направление — от места (у всех одинаково, гость строит то же)
function initVehicles() {
  map.cars = [];
  for (const e of map.ents) {
    if (e.kind !== 'car') continue;
    const h = ((e.x0 * 73856093) ^ (e.y0 * 19349663)) >>> 0;
    const vert = e.y1 - e.y0 > e.x1 - e.x0;
    const model = e.model || VEH_RANDOM[h % VEH_RANDOM.length];
    const a = e.a ?? (vert ? (h & 16 ? Math.PI / 2 : -Math.PI / 2) : (h & 16 ? 0 : Math.PI));
    const c = { id: map.cars.length + 1, model, color: e.color || '#6a7078', armor: e.armor || VEHICLES[model].armor,
      x: (e.x0 + e.x1 + 1) / 2 * TILE, y: (e.y0 + e.y1 + 1) / 2 * TILE, a, vx: 0, vy: 0, w: 0, steer: 0, hp: VEHICLES[model].engineHp,
      seats: VEHICLES[model].seats.map(() => 0), ctrl: { thr: 0, steer: 0, hb: 0 }, parked: true, stamp: [], holes: [], stillT: 0,
      flats: 0, bpTires: e.bpTires ?? !!VEHICLES[model].bpTires, tires: e.tires || null };
    // клетки, которые поставил строитель карты (низкое укрытие «автомобиль») — это и есть «стоянка»
    for (let y = e.y0; y <= e.y1; y++) for (let x = e.x0; x <= e.x1; x++) {
      const i = y * map.w + x;
      if (map.grid[i] === T.LOW && map.wm[i] === WM.CAR) c.stamp.push(i);
    }
    map.cars.push(c);
  }
}

// Встала — клетки под ней становятся низким укрытием (прячутся за ней, сквозь не ходят, ИИ обходит); поехала — снова пол
function parkCar(c) {
  if (c.parked) return;
  c.parked = true; c.vx = c.vy = c.w = 0; c.stamp = [];
  const { hl, hw } = vSize(c), m = M(0.15);
  const x0 = Math.floor((c.x - hl - hw) / TILE), x1 = Math.floor((c.x + hl + hw) / TILE);
  const y0 = Math.floor((c.y - hl - hw) / TILE), y1 = Math.floor((c.y + hl + hw) / TILE);
  const people = allPeople().filter((q) => !q.dead && !q.veh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
    const i = y * map.w + x;
    if (map.grid[i] !== T.FLOOR) continue;
    const L = toLocal(c, (x + 0.5) * TILE, (y + 0.5) * TILE);
    if (Math.abs(L.x) > hl - m || Math.abs(L.y) > hw - m) continue;
    if (people.some((q) => Math.floor(q.x / TILE) === x && Math.floor(q.y / TILE) === y)) continue;   // на клетке стоит человек
    map.grid[i] = T.LOW; map.wm[i] = WM.CAR;
    c.stamp.push(i);
  }
  map.ver = (map.ver || 0) + 1;
}
function unparkCar(c) {
  if (!c.parked) return;
  for (const i of c.stamp) if (map.grid[i] === T.LOW && map.wm[i] === WM.CAR) { map.grid[i] = T.FLOOR; map.wm[i] = 0; }
  c.stamp = []; c.parked = false; c.stillT = 0;
  map.ver = (map.ver || 0) + 1;
}

// ---------- Физика ----------
// Динамическая модель «велосипед» (две оси): у каждой оси шины дают силу вдоль (тяга, тормоз) и поперёк (по углу увода: сначала
// растёт, потом насыщается — шина скользит). Сцепление общее — «круг трения»: тянет или тормозит — держит вбок хуже. Нагрузка на оси —
// по развесовке (front), при разгоне вес уходит назад, при торможении — вперёд (высота центра тяжести cgh). Двигатель — мощность на
// колёсах P (кВт) и предел силы на первой передаче Fmax (Н); привод (drive): 'fwd' — передний (на газу в повороте выносит носом:
// недостаточная поворачиваемость), 'rwd' — задний (на газу срывает зад: избыточная), 'awd' — полный (тяга на обе оси: лучше разгон
// со старта, нейтральнее в повороте). Тормоза — 70/30 спереди/сзади, с ABS (не блокируются, руль работает). Ручник блокирует
// задние колёса — они почти не держат вбок: разворот, занос. Сопротивление воздуха (CdA) и качения сами задают максимальную скорость.
// Меньше ~1 м/с (и задним ходом без сноса) — кинематика (шины не скользят). Углы увода — в осях колеса, при любом направлении движения:
// машина, развёрнутая ручником боком или задом, скользит и гасит скорость трением шин, а не встаёт на месте.
// Резина (TIRES) — множитель сцепления по покрытию; спущенное колесо — ось держит хуже, сопротивление больше, тянет в его сторону.
// Двигатель работает, только если цел и за рулём кто-то есть.
// Шаг — не больше 1/240 с (жёсткие шины), столкновения со стенами — после каждого.
function stepCar(c, dt) {
  const n = Math.max(1, Math.ceil(dt * 240));
  let impact = 0;
  for (let i = 0; i < n; i++) { carDyn(c, dt / n); impact = Math.max(impact, carWalls(c)); }
  return impact;
}
function carDyn(c, dt) {
  const V = VEHICLES[c.model], ctrl = c.ctrl, g = 9.81;
  const m = carMass(c), L = V.wb, la = L * (1 - V.front), lb = L * V.front;     // la, lb — от центра тяжести до передней и задней оси
  const Iz = m * (V.len * V.len + V.wid * V.wid) / 12 * 1.1;
  const driver = !!c.seats[0], alive = c.hp > 0 && driver, hb = !!(ctrl.hb && driver);
  const co = Math.cos(c.a), si = Math.sin(c.a);
  let u = (c.vx * co + c.vy * si) / PX_M, v = (-c.vx * si + c.vy * co) / PX_M, r = c.w || 0;    // м/с вдоль и поперёк, рад/с
  // руль: колёса поворачиваются с конечной скоростью; на скорости — не круче, чем держат шины (×steerLim): как у водителя, который
  // не выворачивает руль в пол на 60 км/ч (с клавиатуры иначе не удержать); сорвать — ручником или газом (задний привод)
  const mu = VEH.grip * (V.mu || 1) * roadGrip(c);
  const dMax = u > 3 ? Math.min(V.steer, Math.atan(VEH.steerLim * mu * g * L / (u * u))) : V.steer;
  c.steer = approach0(c.steer, (driver ? ctrl.steer : 0) * dMax, VEH.steerRate * dt);
  // спущенные колёса: сколько на каждой оси и с какой стороны (тянет к спущенному)
  const fl = c.flats || 0, bit = (i) => (fl >> i) & 1;
  const nF = bit(0) + bit(1), nR = bit(2) + bit(3), flatK = (n) => (n ? VEH.flatGrip * (n > 1 ? 0.8 : 1) : 1);
  const d = c.steer + (fl ? VEH.flatPull * (bit(1) + bit(3) - bit(0) - bit(2)) * Math.min(1, Math.abs(u) / 5) : 0);
  // нагрузки на оси (перенос веса — по ускорению прошлого шага)
  const Nf = Math.max(0.15 * m * g, m * g * V.front - m * (c.ax || 0) * V.cgh / L);
  const Nr = Math.max(0.15 * m * g, m * g * (1 - V.front) + m * (c.ax || 0) * V.cgh / L);
  // сцепление оси падает с нагрузкой (шина «устаёт»): нагруженная ось срывается первой — у переднеприводных с тяжёлым носом на пределе
  // выносит нос, а не зад; жёсткость передних шин на увод ниже задних — машина слегка недостаточно поворачиваема, как настоящие
  const half = m * g / 2;
  const muF = mu * flatK(nF) * (1 - VEH.loadSens * (Nf / half - 1)), muR = mu * flatK(nR) * VEH.rearGrip * (1 - VEH.loadSens * (Nr / half - 1));
  // вдоль: двигатель (по приводу), тормоза, ручник
  const thr = alive ? ctrl.thr : 0, sg = u > 0.05 ? 1 : u < -0.05 ? -1 : 0;
  let Fd = 0, Bk = 0;
  const ek = engineK(c);                                                  // повреждённый двигатель — слабее (и «чихает»)
  if (thr > 0 && u > -0.5) Fd = ek * thr * Math.min(V.Fmax, V.P * 1000 / Math.max(1, Math.abs(u)));
  else if (thr < 0 && u < 0.5) Fd = ek * thr * Math.min(V.Fmax * 0.7, V.P * 1000 / Math.max(1, Math.abs(u))) * Math.max(0, 1 + u / VEH.vrev);   // задний ход
  else if (thr) Bk = Math.abs(thr) * VEH.brake * m;                      // газ против движения — тормоз
  const df = V.drive === 'fwd' ? 1 : V.drive === 'rwd' ? 0 : (V.awdFront ?? 0.4);
  let Fxf = Fd * df - sg * Bk * 0.7, Fxr = Fd * (1 - df) - sg * Bk * 0.3;
  // противобуксовочная система (V.tc — доля сцепления, которую ей можно отдать тяге): тяга не больше, чем оставляет запас вбок под
  // боковую силу прошлого шага (c.fyF / c.fyR) — мощная машина на полном газу не срывается в занос (без неё задняя ось целиком уходит в тягу)
  if (V.tc && Fd > 0) {
    const cap = (muN, fy) => Math.sqrt(Math.max(0, (V.tc * muN) ** 2 - fy * fy));
    if (Fxf > 0) Fxf = Math.min(Fxf, cap(muF * Nf, c.fyF || 0));
    if (Fxr > 0) Fxr = Math.min(Fxr, cap(muR * Nr, c.fyR || 0));
  }
  Fxf = clamp(Fxf, -0.95 * muF * Nf, muF * Nf);                          // пробуксовка; ABS — тормоз до 0,95 сцепления
  Fxr = clamp(Fxr, -0.95 * muR * Nr, muR * Nr);
  // ручник: задние колёса стоят — их сила трения скольжения против движения пятна контакта (вдоль и поперёк), без насыщения шины
  const vrx = u, vry = v - lb * r, vr = Math.hypot(vrx, vry), locked = hb && vr > 0.3;
  let Fyr = 0;
  if (locked) { const Fk = 0.8 * muR * Nr, s = Math.max(vr, 1); Fxr = -Fk * vrx / s; Fyr = -Fk * vry / s; }
  // сопротивление: воздух, качение (спущенные колёса — больше), двигатель без газа, стоит без водителя — ручник
  const res = 0.5 * 1.2 * V.CdA * u * u + (VEH.crr + VEH.flatRes * (nF + nR)) * m * g + (driver ? (thr ? 0 : VEH.engineBrake * m) : VEH.park * m);
  // поперёк: углы увода; сила — по жёсткости шины, насыщается сцеплением, оставшимся от продольной силы
  // кинематика (0) — малая скорость или задний ход без сноса; динамика (1) — едет, скользит боком, развернуло
  const kin = u >= 0 ? clamp((Math.hypot(u, v) - 1) / 1.5, 0, 1) : clamp((Math.abs(v) - 1) / 1.5, 0, 1);
  const cd = Math.cos(d), sd = Math.sin(d);
  let Fyf = 0;
  if (kin > 0) {
    // скорость пятна контакта в осях колеса: вдоль (wx) и поперёк (wy); угол увода — по модулю продольной (едет хоть вперёд, хоть назад)
    const vf = v + la * r, wx = u * cd + vf * sd, wy = -u * sd + vf * cd;
    const af = Math.atan2(wy, Math.abs(wx)), ar = Math.atan2(vry, Math.abs(vrx));
    const Ff = Math.sqrt(Math.max(0, (muF * Nf) ** 2 - Fxf * Fxf));
    Fyf = -Ff * Math.tanh(VEH.cs * VEH.csF * Nf * af / Math.max(1, Ff));
    if (!locked) {
      const Fr = Math.sqrt(Math.max(0, (muR * Nr) ** 2 - Fxr * Fxr));
      Fyr = -Fr * Math.tanh(VEH.cs * VEH.csR * Nr * ar / Math.max(1, Fr));
    }
  }
  c.fyF = Fyf; c.fyR = Fyr;                                                // для противобуксовочной (V.tc) на следующем шаге
  const Fx = Fxf * cd - Fyf * sd + Fxr;
  // динамика
  let u1 = u + (Fx / m + v * r) * dt;
  let v1 = v + ((Fyf * cd + Fxf * sd + Fyr) / m - u * r) * dt;
  let r1 = r + ((la * (Fyf * cd + Fxf * sd) - lb * Fyr) / Iz) * dt;
  // система стабилизации (V.esc): закручивает быстрее, чем держат шины (μg/u), или кузов уходит боком — гасит вращение и снос
  // (как подтормаживание отдельных колёс) и чуть сбрасывает скорость; ручником сорвать — можно (при ручнике выключена)
  if (V.esc && driver && !hb && u > 4) {
    const rLim = (mu * g / u) * ESC.margin, beta = Math.atan2(v1, u1);
    const over = Math.abs(r1) - rLim, slide = Math.abs(beta) - ESC.beta;
    if (over > 0 || slide > 0) {
      if (over > 0) r1 -= Math.sign(r1) * Math.min(over, ESC.yaw * V.esc * dt);
      if (slide > 0) { v1 -= Math.sign(v1) * Math.min(Math.abs(v1), ESC.side * V.esc * dt); if (Math.sign(r1) === Math.sign(beta)) r1 *= 1 - Math.min(1, ESC.yawSlide * dt); }
      u1 -= ESC.brake * dt;
      c.escOn = G.time;
    }
  }
  // сопротивление — к нулю, не дальше (стоит — стоит)
  const dres = (res / m) * dt;
  if (Math.abs(u1) <= dres && !Fd) u1 = 0; else u1 -= Math.sign(u1) * dres;
  if (kin < 1) {
    // кинематика: колёса катятся без скольжения, задняя ось не сносится; боковая скорость гаснет не мгновенно — не быстрее трения шин
    const uk = u1, rk = uk * Math.tan(d) / L, vk = rk * lb;
    u1 = uk; v1 = approach0(v1, vk + (v1 - vk) * kin, mu * g * dt * 1.1); r1 = rk + (r1 - rk) * kin;
  }
  c.ax = c.ax === undefined ? 0 : c.ax + ((u1 - u) / dt - c.ax) * Math.min(1, dt * 20);
  c.w = r1;
  c.a += r1 * dt;
  const co2 = Math.cos(c.a), si2 = Math.sin(c.a);
  c.vx = (u1 * co2 - v1 * si2) * PX_M; c.vy = (u1 * si2 + v1 * co2) * PX_M;
  c.x += c.vx * dt; c.y += c.vy * dt;
  // скольжение (для следов на асфальте): вбок, пробуксовка, юз
  c.slip = Math.abs(v1) + (Fd && Math.abs(Fd * df) > muF * Nf * 0.98 ? 3 : 0) + (Fd && Math.abs(Fd * (1 - df)) > muR * Nr * 0.98 ? 3 : 0) + (locked && vr > 2 ? 3 : 0);
}
// Сцепление под машиной: покрытие (асфальт, бетон, гравий, грунт), погода (мокрый асфальт держит хуже) и резина (TIRES: на хорошем
// покрытии — good, на плохом — poor; мокрый асфальт — посередине)
function roadGrip(c) {
  const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
  const fm = map.fl ? map.fl[ty * map.w + tx] || FM.ASPHALT : FM.ASPHALT;
  const rain = G.weather ? clamp(G.weather.rain || 0, 0, 1) : 0;
  const T = TIRES[tiresOf(c)] || TIRES.road, poor = VEH.poor[fm] ? 1 : VEH.wetPoor * rain;
  return (VEH.surface[fm] ?? 1) * (1 - VEH.wet * rain) * (T.good + (T.poor - T.good) * poor);
}
// Система стабилизации (у машин с V.esc): margin — запас по скорости вращения над μg/u; beta — допустимый угол сноса (рад);
// yaw — как быстро гасит лишнее вращение (рад/с²), side — снос (м/с²), yawSlide — вращение в сторону сноса (1/с), brake — подтормаживание (м/с²)
const ESC = { margin: 1.15, beta: 0.14, yaw: 6, side: 6, yawSlide: 4, brake: 2 };
// Повреждённый двигатель работает хуже: мощность × (ENGINE_DMG.min + (1 − min) × доля прочности^pow); ниже ENGINE_DMG.rough — «чихает»:
// провалы тяги (×misK) на 0,08–0,25 с, тем чаще, чем сильнее повреждён (c.misT — сколько ещё длится провал; у каждого считает сам)
const ENGINE_DMG = { min: 0.3, pow: 0.7, rough: 0.4, misRate: 3, misK: 0.15 };
function engineK(c) {
  const k = clamp(c.hp / VEHICLES[c.model].engineHp, 0, 1);
  if (k >= 1) return 1;
  const now = G.time;
  if (k < ENGINE_DMG.rough && !(c.misEnd > now) && now >= (c.misNext || 0)) {
    // следующий провал — по пуассоновскому потоку: чаще при меньшей прочности
    const rate = ENGINE_DMG.misRate * (1 - k / ENGINE_DMG.rough);
    if (c.misNext) c.misEnd = now + rand(0.08, 0.25);
    c.misNext = now + (rate > 0 ? -Math.log(1 - Math.random()) / rate : 1e9);
  }
  const base = ENGINE_DMG.min + (1 - ENGINE_DMG.min) * Math.pow(k, ENGINE_DMG.pow);
  return c.misEnd > now ? base * ENGINE_DMG.misK : base;
}
const engineMisfire = (c) => c.misEnd > G.time;

// Двигатель теряет прочность (попадание в моторный отсек, удар передом); 0 — заглох
function engineDamage(c, dmg) {
  if (c.hp <= 0 || !(dmg > 0)) return;
  c.hp = Math.max(0, c.hp - dmg);
  if (c.hp <= 0) emit(['vdead', c.id]);
}
const approach0 = (v, t, d) => (Math.abs(t - v) <= d ? t : v + Math.sign(t - v) * d);

// Точки контура (через ~10 px) — столкновения со стенами и укрытиями (клетки)
function carOutline(c) {
  const { hl, hw } = vSize(c), pts = [];
  const nx = Math.ceil((hl * 2) / 10), ny = Math.ceil((hw * 2) / 10);
  const at = (lx, ly) => { const p = toWorld(c, lx, ly); p.lx = lx; return p; };
  for (let i = 0; i <= nx; i++) { const lx = -hl + (2 * hl * i) / nx; pts.push(at(lx, -hw), at(lx, hw)); }
  for (let j = 1; j < ny; j++) { const ly = -hw + (2 * hw * j) / ny; pts.push(at(-hl, ly), at(hl, ly)); }
  return pts;
}
// Выталкивание из стен: точки контура внутри твёрдых клеток → сдвиг; скорость в стену гасится (отскок). Возвращает скорость удара, м/с.
// Удар моторным отсеком (в стене — точки передней части, отталкивает назад) — c.crashF: скорость такого удара (урон двигателю — снаружи).
function carWalls(c) {
  let impact = 0;
  const engX = vSize(c).hl - M(VEHICLES[c.model].len) * VEH.engineZone;
  for (let it = 0; it < 3; it++) {
    let px = 0, py = 0, any = false, front = false;
    for (const p of carOutline(c)) {
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if (!solidTile(tx, ty)) continue;
      any = true;
      if (p.lx > engX) front = true;
      // наименьший выход из клетки (по оси), в сторону свободной соседней
      const l = p.x - tx * TILE, r = (tx + 1) * TILE - p.x, t = p.y - ty * TILE, b = (ty + 1) * TILE - p.y;
      const opts = [[-l - 0.5, 0, !solidTile(tx - 1, ty)], [r + 0.5, 0, !solidTile(tx + 1, ty)], [0, -t - 0.5, !solidTile(tx, ty - 1)], [0, b + 0.5, !solidTile(tx, ty + 1)]];
      let best = null;
      for (const o of opts) if (o[2] && (!best || Math.hypot(o[0], o[1]) < Math.hypot(best[0], best[1]))) best = o;
      if (!best) best = opts.reduce((m, o) => (Math.hypot(o[0], o[1]) < Math.hypot(m[0], m[1]) ? o : m));
      if (Math.abs(best[0]) > Math.abs(px)) px = best[0];
      if (Math.abs(best[1]) > Math.abs(py)) py = best[1];
    }
    if (!any) break;
    c.x += px; c.y += py;
    const n = Math.hypot(px, py);
    if (n > 0.01) {
      const nx = px / n, ny = py / n, vn = c.vx * nx + c.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn / PX_M);
        carTrig(c);
        if (front && nx * c._co + ny * c._si < -0.3) c.crashF = Math.max(c.crashF || 0, -vn / PX_M);
        c.vx -= (1 + VEH.restitution) * vn * nx; c.vy -= (1 + VEH.restitution) * vn * ny;
        c.w *= 0.5;
      }
    }
  }
  return impact;
}

// Машина с машиной (SAT по двум прямоугольникам): раздвинуть, скорости — по массам; удар передом (другая — впереди) — урон двигателю
function carsCollide(a, b) {
  const axes = [a.a, a.a + Math.PI / 2, b.a, b.a + Math.PI / 2];
  const corners = (c) => { const { hl, hw } = vSize(c); return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([x, y]) => toWorld(c, x, y)); };
  const ca = corners(a), cb = corners(b);
  let best = null;
  for (const ang of axes) {
    const ax = Math.cos(ang), ay = Math.sin(ang);
    const pa = ca.map((p) => p.x * ax + p.y * ay), pb = cb.map((p) => p.x * ax + p.y * ay);
    const o = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (o <= 0) return;
    if (!best || o < best.o) best = { o, ax, ay };
  }
  let { ax, ay } = best;
  if ((b.x - a.x) * ax + (b.y - a.y) * ay < 0) { ax = -ax; ay = -ay; }
  const ma = a.parked ? 1e9 : carMass(a), mb = b.parked ? 1e9 : carMass(b), ka = mb / (ma + mb), kb = ma / (ma + mb);
  a.x -= ax * best.o * ka; a.y -= ay * best.o * ka;
  b.x += ax * best.o * kb; b.y += ay * best.o * kb;
  const rv = (b.vx - a.vx) * ax + (b.vy - a.vy) * ay;
  if (-rv / PX_M > VEH.crashSpeed) {
    const hit = (c, nx, ny) => { carTrig(c); if (nx * c._co + ny * c._si > 0.5) engineDamage(c, (-rv / PX_M - VEH.crashSpeed) * VEH.crashDmg); };
    hit(a, ax, ay); hit(b, -ax, -ay);
    emit(['crash', (a.x + b.x) / 2, (a.y + b.y) / 2, r2(-rv / PX_M)]);
  }
  if (rv < 0) {
    const j = -(1 + VEH.restitution) * rv / (1 / ma + 1 / mb);
    a.vx -= (j / ma) * ax; a.vy -= (j / ma) * ay;
    b.vx += (j / mb) * ax; b.vy += (j / mb) * ay;
  }
}

// Люди и машина: человека выталкивает из-под кузова; на скорости — наезд (урон по скорости машины на человека).
// Тот же человек — не чаще VEH.hitGap с (по времени, а не по кадрам касания). Центр уже внутри кузова (на скорости проскочил кромку) —
// удар по всей скорости точки кузова, отбрасывает в сторону движения.
function carPeople(c, dt) {
  const { hl, hw } = vSize(c);
  const drv = personById(c.seats[0]);
  for (const q of allPeople()) {
    if (q.dead || q.veh) continue;
    const L = toLocal(c, q.x, q.y);
    const cx = clamp(L.x, -hl, hl), cy = clamp(L.y, -hw, hw);
    let dx = L.x - cx, dy = L.y - cy, d = Math.hypot(dx, dy);
    if (d >= PR) continue;
    const inside = d < 0.01;
    if (inside) {                                              // центр внутри кузова — к ближайшей стороне
      const ox = hl - Math.abs(L.x), oy = hw - Math.abs(L.y);
      if (ox < oy) { dx = Math.sign(L.x) || 1; dy = 0; d = -ox; } else { dx = 0; dy = Math.sign(L.y) || 1; d = -oy; }
    } else { dx /= d; dy /= d; }
    const n = toWorld({ x: 0, y: 0, a: c.a }, dx, dy);         // нормаль в мире
    const push = PR - d;
    if (q.net && !isAuth()) continue;
    moveCircle(q, n.x * push, n.y * push, PR);
    if (!isAuth() || (drv && ffBlocked(drv.side, q))) continue;      // огонь по своим выключен — свой водитель не ранит
    // скорость точки кузова у человека (с вращением машины)
    const rx = q.x - c.x, ry = q.y - c.y, w = c.w || 0;
    const pvx = c.vx - w * ry, pvy = c.vy + w * rx, ps = Math.hypot(pvx, pvy) / PX_M;
    const hitV = inside ? ps : Math.max(0, (pvx * n.x + pvy * n.y) / PX_M);
    if (hitV > VEH.hitSpeed && G.time - (q.carHitAt ?? -9) > VEH.hitGap) {
      q.carHitAt = G.time;
      const dmg = (hitV - VEH.hitSpeed) * VEH.hitDmg;
      // отбросить: вдоль нормали, а если внутри кузова — по ходу точки кузова
      const kx = inside && ps > 0 ? pvx / PX_M / ps : n.x, ky = inside && ps > 0 ? pvy / PX_M / ps : n.y;
      damagePerson(q, dmg, c.x, c.y, Math.atan2(ky, kx), drv);
      if (!q.dead) moveCircle(q, kx * M(0.6), ky * M(0.6), PR);
    }
  }
}

// ---------- Места ----------
// Ближайшая машина со свободным местом в пределах VEH.enterR от кузова; за рулём — своя
function vehNear(o) {
  if (!map || !map.cars || !o) return null;
  if (o.veh) return o.veh;
  let best = null, bd = M(VEH.enterR);
  for (const c of map.cars) {
    if (!c.seats.some((s) => !s)) continue;
    const d = carDist(c, o.x, o.y);
    if (d < bd && carSpeed(c) < M(VEH.exitSpeed)) { bd = d; best = c; }
  }
  return best;
}
// Какое место занять: человек — водительское, если свободно, иначе ближайшее к нему; бот — ближайшее пассажирское
function pickSeat(c, o) {
  if (!o.ai && !c.seats[0]) return 0;
  let best = -1, bd = 1e9;
  c.seats.forEach((s, i) => {
    if (s || (o.ai && i === 0)) return;
    const p = seatPos(c, i), d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function enterCar(o, c, seat = pickSeat(c, o)) {
  if (!c || seat < 0 || c.seats[seat] || o.dead || o.down || o.veh || o.mg) return false;
  c.seats[seat] = o.id;
  o.veh = c; o.seat = seat;
  Object.assign(o, { crouch: false, crouchToggle: false, sprint: false, leanWant: 0, act: null, melee: null, peek: null, flank: null, fm: null, doorFire: null, kneel: false, goal: null });
  if (seat === 0) {
    // водитель: руки на руле — только пистолет
    o.vehCur = o.cur;
    if (o.cur !== 2) { o.cur = 2; o.off = -1; o.sw = null; o.gun = o.kit[2]; }
  }
  const p = seatPos(c, seat);
  o.x = o.px = p.x; o.y = o.py = p.y;
  emit(['door', p.x, p.y, 'close', 'metal']);
  return true;
}
function exitCar(o, force = false) {
  const c = o.veh;
  if (!c) return false;
  if (!force && carSpeed(c) > M(VEH.exitSpeed)) return false;
  c.seats[o.seat] = 0;
  if (o.seat === 0) { c.ctrl = { thr: 0, steer: 0, hb: 0 }; c.remote = false; }
  if (o.seat === 0 && o.vehCur !== undefined && o.kit[o.vehCur]) { o.cur = o.vehCur; o.gun = o.kit[o.cur]; o.off = -1; }
  o.vehCur = undefined;
  const s = VEHICLES[c.model].seats[o.seat], side = s[1] < 0 ? -1 : 1;
  const out = toWorld(c, M(s[0]), side * (vSize(c).hw + M(0.55)));
  const sp = freeSpotNear(out.x, out.y);
  o.veh = null; o.seat = -1;
  o.x = o.px = sp.x; o.y = o.py = sp.y;
  emit(['door', o.x, o.y, 'open', 'metal']);
  return true;
}
// F: в машине — выйти, рядом — сесть
function vehToggle(o) {
  if (o.veh) exitCar(o);
  else { const c = vehNear(o); if (c) enterCar(o, c); }
}

// ---------- Каждый кадр (хост) ----------
function updateVehicles(dt) {
  if (!map || !map.cars || !map.cars.length) return;
  for (const c of map.cars) {
    // кто сидит: погибший или раненый — выпадает наружу
    c.seats.forEach((id, i) => {
      if (!id) return;
      const q = personById(id);
      if (!q || q.veh !== c) { c.seats[i] = 0; return; }
      if (q.dead || q.down || q.evac) exitCar(q, true);
    });
    const drv = personById(c.seats[0]);
    if (!drv) c.ctrl = { thr: 0, steer: 0, hb: 0 };
    else if (drv.ai && !(VEH.botDrive && drv.drive)) c.ctrl = { thr: 0, steer: 0, hb: 1 };   // бот за рулём без задания (или вождение ботов выключено) — стоит
    if (c.parked && (c.ctrl.thr || c.remote)) unparkCar(c);
    if (!c.parked && !c.remote) {
      const steps = Math.max(1, Math.ceil(carSpeed(c) * dt / 12));      // не больше ~12 px за шаг (стены не проскочить)
      let impact = 0;
      c.crashF = 0;
      for (let s = 0; s < steps; s++) impact = Math.max(impact, stepCar(c, dt / steps));
      if (impact > VEH.crashSpeed) emit(['crash', c.x, c.y, r2(impact)]);   // удар — звук и тряска
      if (c.crashF > VEH.crashSpeed) engineDamage(c, (c.crashF - VEH.crashSpeed) * VEH.crashDmg);   // передом — и двигатель
    }
    if (!c.parked) {
      // встала и стоит — «паркуется»
      if (carSpeed(c) < M(0.15) && !c.ctrl.thr && !c.remote) { c.stillT += dt; if (c.stillT > VEH.parkT) parkCar(c); }
      else c.stillT = 0;
      // шум мотора и колёс
      c.noiseT = (c.noiseT || 0) - dt;
      if (c.noiseT <= 0 && (c.hp > 0 && drv) ) {
        c.noiseT = 0.5;
        makeNoise(c.x, c.y, M(VEH.noise * (0.4 + 0.6 * Math.min(1, carSpeed(c) / M(15)))), 'step', drv);
      }
    }
  }
  // машины между собой (стоящие — клетки, их и так не проехать)
  const moving = map.cars.filter((c) => !c.parked);
  for (const a of moving) for (const b of map.cars) if (a !== b && (b.parked ? false : a.id < b.id)) carsCollide(a, b);
  for (const c of map.cars) {
    if (!c.parked) carPeople(c, dt);
    seatPeople(c);
  }
}
// Сидящие — на своих местах; скорость — как у машины (разброс при стрельбе на ходу)
function seatPeople(c) {
  c.seats.forEach((id, i) => {
    const q = id && personById(id);
    if (!q) return;
    const p = seatPos(c, i);
    q.x = p.x; q.y = p.y;
    q.lx = p.x; q.ly = p.y; q.leanPx = 0; q.lean = 0;
    q.crouch = false;
  });
}

// ---------- Управление (свой боец) ----------
// В машине: водитель — W/S газ и тормоз (задний ход), A/D руль, Space — ручник; стреляет только из пистолета. Пассажир — не ходит.
// C — камера (обычная / за машиной). F — выйти (не быстрее VEH.exitSpeed).
function vehControl(p, mx, my) {
  const c = p.veh;
  if (p.seat !== 0) return;
  const hb = keys.Space ? 1 : 0;
  c.ctrl = { thr: clamp(-my, -1, 1), steer: clamp(mx, -1, 1), hb };
  if (!isAuth()) { c.remote = true; guestDrive(c, G.lastDt || 1 / 60); }
}
// Гость за рулём сам считает свою машину (как своего бойца) и шлёт позу хосту
function guestDrive(c, dt) {
  if (c.parked) unparkCar(c);
  const steps = Math.max(1, Math.ceil(carSpeed(c) * dt / 12));
  c.crashF = 0;
  let impact = 0;
  for (let s = 0; s < steps; s++) impact = Math.max(impact, stepCar(c, dt / steps));
  if (c.crashF > VEH.crashSpeed) c.crashAcc = (c.crashAcc || 0) + (c.crashF - VEH.crashSpeed) * VEH.crashDmg;   // урон двигателю — посчитает хост
  if (impact > VEH.crashSpeed) c.crashV = Math.max(c.crashV || 0, impact);
  seatPeople(c);
}
// Ввод гостя-водителя: поза машины, газ; накопленный урон двигателю от ударов передом и сила удара (звук) — с последней отправки
function vehInput(c) {
  const v = [c.id, r1(c.x), r1(c.y), r2(c.a), r1(c.vx), r1(c.vy), r2(c.steer), r2(c.ctrl.thr), r1(c.crashAcc || 0), r2(c.crashV || 0)];
  c.crashAcc = 0; c.crashV = 0;
  return v;
}

// ---------- ИИ (союзные боты) ----------
// Ведущий в машине, она стоит или едет медленно, есть свободное пассажирское место — бот (не в бою) садится; ведущий вышел — выходит.
// В машине: видит противника — стреляет (разброс — по скорости машины), нет — смотрит наружу со своей стороны.
function vehBoard(e, dt) {
  if (e.side !== 'p' || e.veh || e.down || e.seeing) return false;
  const L = leaderOf(e);
  const c = L && L.veh;
  if (!c || carSpeed(c) > M(VEH.exitSpeed) || pickSeat(c, e) < 0) return false;
  const d = carDist(c, e.x, e.y);
  if (d > M(30)) return false;
  if (d < M(VEH.enterR) * 0.8) { enterCar(e, c); return true; }
  const seat = seatPos(c, pickSeat(c, e)), side = toWorld(c, toLocal(c, seat.x, seat.y).x, Math.sign(toLocal(c, seat.x, seat.y).y || 1) * (vSize(c).hw + M(0.6)));
  const step = fieldStep(e, fieldTo(side.x, side.y));
  e.sprint = d > M(6); e.crouch = false;
  moveDir(e, step ?? Math.atan2(side.y - e.y, side.x - e.x), e.sprint ? ENEMY.speed.run : ENEMY.speed.walk, dt);
  e.want = step ?? Math.atan2(side.y - e.y, side.x - e.x);
  return true;
}
function vehStep(e, dt, seen) {
  const c = e.veh;
  if (e.seat === 0 && e.drive && VEH.botDrive) {                     // за рулём с заданием (VEH.botDrive)
    Object.assign(e, { sprint: false, crouch: false, kneel: false, leanWant: 0, peek: null, flank: null, fm: null });
    if (e.drive.car !== c) { e.drive = null; exitCar(e); return false; }
    driveStep(e, dt);
    e.want = c.a;
    return true;
  }
  if (e.side === 'p') { const L = leaderOf(e); if ((!L || L.veh !== c) && exitCar(e)) return false; }
  Object.assign(e, { sprint: false, crouch: false, kneel: false, leanWant: 0, peek: null, flank: null, fm: null, doorFire: null });
  const t = seen && seen.t;
  if (t && e.st === 2) {
    e.want = Math.atan2(seen.py - e.y, seen.px - e.x);
    e.react -= dt;
    if (!(e.gun.reloadT > 0)) shootAt(e, seen.partial ? { x: seen.px, y: seen.py, speed: t.speed, crouch: t.crouch } : t, seen.d, dt, false);
  } else {
    const s = VEHICLES[c.model].seats[e.seat];
    e.want = c.a + (s[1] < 0 ? -1 : 1) * Math.PI / 2 * 0.8;
  }
  if (!e.gun.chamber && !e.gun.reloadT && canReload(e.gun)) startReload(e);
  return true;
}

// ---------- Боты за рулём (VEH.botDrive — по умолчанию выключено: включать для конкретных случаев) ----------
// botDrive(e, машина, { pts, loop, vmax }) — проехать по точкам (px; loop — по кругу), botDriveTo(e, машина, x, y) — доехать до места
// (путь по клеткам, BFS), botStopDriving(e). Бот сам идёт к водительской двери и садится, потом ведёт: руль — «чистое преследование»
// (точка впереди на ~0,7 с пути), скорость — по кривизне маршрута впереди: в поворот не быстрее √(aiLat × μg × R), тормозит заранее
// (aiBrake × μg), сцепление — с учётом покрытия и дождя (roadGrip). Упёрся — сдаёт назад с обратным рулём. Без VEH.botDrive — ничего.
function botDrive(e, c, task) {
  if (!VEH.botDrive || !c || e.dead || e.down || (c.seats[0] && c.seats[0] !== e.id)) return false;
  const pts = resample(task.pts, M(2), task.loop);
  if (pts.length < 2) return false;
  e.drive = { car: c, pts, loop: !!task.loop, i: 0, vmax: task.vmax || 40, stuckT: 0, revT: 0, laps: 0, done: false };
  e.drive.i = nearestIdx(pts, c.x, c.y);
  return true;
}
function botDriveTo(e, c, x, y) {
  const f = fieldTo(x, y), pts = [];
  let tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
  for (let k = 0; k < 2000; k++) {
    pts.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    let best = f.f[ty * map.w + tx], bx = tx, by = ty;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = f.f[(ty + dy) * map.w + tx + dx] + (dx && dy ? 0.4 : 0);
      if ((dx || dy) && v < best) { best = v; bx = tx + dx; by = ty + dy; }
    }
    if (bx === tx && by === ty) break;
    tx = bx; ty = by;
  }
  pts.push({ x, y });
  return botDrive(e, c, { pts, loop: false });
}
function botStopDriving(e) { e.drive = null; if (e.veh && e.seat === 0) e.veh.ctrl = { thr: 0, steer: 0, hb: 1 }; }
// Ровные точки через step px (по кругу — и через стык)
function resample(src, step, loop) {
  const out = [];
  if (!src || !src.length) return out;
  out.push({ x: src[0].x, y: src[0].y });
  let acc = 0;
  const n = src.length + (loop ? 1 : 0);
  for (let i = 1; i < n; i++) {
    const a = src[i - 1], b = src[i % src.length];
    let d = Math.hypot(b.x - a.x, b.y - a.y), t = 0;
    while (acc + d - t >= step) { t += step - acc; acc = 0; out.push({ x: a.x + (b.x - a.x) * t / d, y: a.y + (b.y - a.y) * t / d }); }
    acc += d - t;
  }
  return out;
}
function nearestIdx(pts, x, y) { let b = 0, bd = 1e18; pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }

// Пешком к машине: к водительской двери, сесть за руль
function driveBoard(e, dt) {
  const D = e.drive, c = D.car;
  if (c.seats[0] && c.seats[0] !== e.id) { e.drive = null; return false; }
  const door = toWorld(c, M(VEHICLES[c.model].seats[0][0]), -(vSize(c).hw + M(0.6)));
  const d = carDist(c, e.x, e.y);
  if (d < M(VEH.enterR) * 0.8) { if (e.veh) exitCar(e, true); return enterCar(e, c, 0) || true; }
  const step = fieldStep(e, fieldTo(door.x, door.y));
  e.sprint = d > M(6); e.crouch = false;
  moveDir(e, step ?? Math.atan2(door.y - e.y, door.x - e.x), e.sprint ? ENEMY.speed.run : ENEMY.speed.walk, dt);
  e.want = step ?? Math.atan2(door.y - e.y, door.x - e.x);
  return true;
}
// За рулём: руль, газ / тормоз по кривизне впереди, задний ход, если застрял
function driveStep(e, dt) {
  const D = e.drive, c = e.veh, V = VEHICLES[c.model], pts = D.pts, n = pts.length;
  const nx = (j) => (D.loop ? (j + 1) % n : j + 1 < n ? j + 1 : -1);
  const sp = carSpeed(c) / PX_M, g = 9.81, mu = VEH.grip * (V.mu || 1) * roadGrip(c);
  // где на маршруте: ближайшая точка среди следующих 25
  let bi = D.i, bd = 1e18;
  for (let k = 0, j = D.i; k < 25 && j >= 0; k++, j = nx(j)) { const d = (pts[j].x - c.x) ** 2 + (pts[j].y - c.y) ** 2; if (d < bd) { bd = d; bi = j; } }
  // круги — по пройденным точкам (полный оборот), а не по переходу через «начало» (машина могла стоять чуть позади него)
  const adv = D.loop ? (bi - D.i + n) % n : bi - D.i;
  if (adv > 0 && adv < n / 2) { D.prog = (D.prog || 0) + adv; D.laps = Math.floor(D.prog / n); }
  D.i = bi;
  // точка преследования
  const Ld = Math.max(5, sp * 0.7);
  let j = D.i, s = 0;
  while (s < Ld) { const q = nx(j); if (q < 0) break; s += Math.hypot(pts[q].x - pts[j].x, pts[q].y - pts[j].y) / PX_M; j = q; }
  // объезд: впереди на пути (до ~12 м) другая машина — точка прицеливания сдвигается вбок, туда, где свободнее (и не в стену)
  let tg = { x: pts[j].x, y: pts[j].y };
  for (let k = 0, q = D.i; k < 7 && q >= 0; k++, q = nx(q)) {
    const blk = map.cars.find((o) => o !== c && carDist(o, pts[q].x, pts[q].y) < M(2.4));
    if (!blk) continue;
    const r = nx(q) >= 0 ? nx(q) : q, dir = Math.atan2(pts[r].y - pts[q].y, pts[r].x - pts[q].x);
    const side = (sg) => ({ x: pts[q].x - Math.sin(dir) * sg * M(3.6), y: pts[q].y + Math.cos(dir) * sg * M(3.6) });
    const free = (p) => carDist(blk, p.x, p.y) - (solidTile(Math.floor(p.x / TILE), Math.floor(p.y / TILE)) ? M(9) : 0);
    const a = side(1), b = side(-1);
    tg = free(a) >= free(b) ? a : b;
    break;
  }
  const L = toLocal(c, tg.x, tg.y), alpha = Math.atan2(L.y, L.x), ld = Math.max(1, Math.hypot(L.x, L.y) / PX_M);
  const delta = Math.atan(2 * V.wb * Math.sin(alpha) / ld);
  const dMax = sp > 3 ? Math.min(V.steer, Math.atan(VEH.steerLim * mu * g * V.wb / (sp * sp))) : V.steer;
  let steer = clamp(delta / dMax, -1, 1);
  // скорость: на каждые 2 м впереди — предел по кривизне и запас на торможение до него
  let vt = D.vmax;
  s = 0;
  for (let k = 0, a = D.i; k < 60; k++) {
    const b = nx(a), cc = b >= 0 ? nx(b) : -1;
    if (cc < 0) { vt = Math.min(vt, Math.sqrt(2 * VEH.aiBrake * mu * g * Math.max(0, s + 1))); break; }   // конец пути — встать у него
    const a1 = Math.atan2(pts[b].y - pts[a].y, pts[b].x - pts[a].x), a2 = Math.atan2(pts[cc].y - pts[b].y, pts[cc].x - pts[b].x);
    const seg = Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) / PX_M;
    const curv = Math.abs(angDiff(a2, a1)) / Math.max(0.5, seg);
    const vc = curv > 1e-3 ? Math.sqrt(VEH.aiLat * mu * g / curv) : 99;
    vt = Math.min(vt, Math.sqrt(vc * vc + 2 * VEH.aiBrake * mu * g * s));
    s += seg; a = b;
    if (s > 70) break;
  }
  // тормоз — сколько нужно для замедления aiBrake × μg (педаль VEH.brake — это 100%), сильнее, если уже не успевает
  const brk = clamp(VEH.aiBrake * mu * g / VEH.brake + (sp - vt) / 4, 0.4, 1);
  let thr = sp < vt - 0.4 ? (Math.abs(alpha) > 1.2 ? 0.4 : 1) : sp > vt + 0.5 ? -brk : 0.15;
  // застрял (стоит с газом) — назад с обратным рулём
  if (thr > 0 && sp < 0.6) { D.stuckT += dt; if (D.stuckT > 1.2) { D.revT = 1.3; D.stuckT = 0; } } else D.stuckT = Math.max(0, D.stuckT - dt);
  if (D.revT > 0) { D.revT -= dt; thr = -1; steer = -steer || 1; }
  // приехал (не по кругу): до конца пути меньше 2,5 м — тормоз до остановки
  if (!D.loop) {
    const rem = Math.hypot(pts[n - 1].x - c.x, pts[n - 1].y - c.y) / PX_M;
    if (rem < 2.5 || (D.i >= n - 2 && sp < 0.5)) { thr = sp > 0.3 ? -1 : 0; steer = 0; if (sp <= 0.3) D.done = true; }
  }
  c.ctrl = { thr, steer, hb: 0 };
  return true;
}

// ---------- Пули ----------
// Пуля над машиной: стрелок стоит вплотную (стреляет поверх) или за ней вплотную стоит человек (30% — в машину, как у низких укрытий);
// присевшие — пуля в машину. Иначе — в машину.
function carPassOver(b, c, people, ux, uy) {
  if (!b.crouch && !b.car && carDist(c, b.sx, b.sy) < COVER_NEAR) return true;
  for (const o of people) {
    if (o.veh || o.id === b.owner || o.dead) continue;
    if (carDist(c, o.x, o.y) > COVER_NEAR) continue;
    const ahead = (o.x - b.x) * ux + (o.y - b.y) * uy;
    if (ahead <= 0 || Math.abs((o.x - b.x) * uy - (o.y - b.y) * ux) > M(1.2)) continue;
    b.low = b.low || o.crouch;
    return o.crouch ? false : Math.random() >= STAND_COVER_HIT;
  }
  return false;
}
// Пуля пересекла зону: держит — пуля остаётся (пробоина-вмятина), нет — теряет энергию. true — пуля кончилась.
function carZone(b, c, zone, L, ux, uy, hole) {
  const Z = VEH_ARMOR[c.armor][zone];
  const stop = b.t.threat <= Z.stop;
  if (!stop) b.e *= Math.pow(Z.pen, b.t.penExp ?? 1);
  if (hole) emit(['chit', c.id, r1(L.x), r1(L.y), zone === 'glass' ? 1 : 0, r1(b.x), r1(b.y), r2(Math.atan2(-uy, -ux)), stop ? 1 : 0]);
  return stop || b.e < 0.2;
}
// Колесо под точкой (координаты машины): номер 0..3 (переднее левое, переднее правое, заднее левое, заднее правое) или −1
function wheelAt(c, L) {
  const { hw } = vSize(c), wb = M(VEHICLES[c.model].wb) / 2;
  if (Math.abs(L.y) < hw - M(VEH.wheelW) || Math.abs(L.y) > hw + 1) return -1;
  for (let i = 0; i < 4; i++) {
    const wx = i < 2 ? wb : -wb;
    if (Math.abs(L.x - wx) < M(VEH.wheelR) && (L.y > 0) === !!(i & 1)) return i;
  }
  return -1;
}
// Пуля в колесо: резина и диск отнимают энергию; покрышка спускает (не пулестойкая и ещё цела)
function wheelHit(c, i, b, ux, uy) {
  b.e *= 0.6;
  if (!c.bpTires && !(c.flats & (1 << i))) { c.flats |= 1 << i; emit(['flat', c.id, i, r1(b.x), r1(b.y)]); }
  else emit(['flat', c.id, -1, r1(b.x), r1(b.y)]);                   // пулестойкая или уже спущена — только удар
  return b.e < 0.2;
}
// Шаг пули: вход в кузов (панель) или в колесо, моторный отсек (двигатель теряет прочность — тем быстрее, чем крупнее калибр), салон,
// колёса изнутри (пуля навылет через арку), сидящие, выход.
function vehBullet(b, ux, uy, people) {
  for (const c of map.cars) {
    if (c.id === b.car) continue;                              // своя машина: из неё стреляют, её не задевают (и своих в ней)
    const st0 = b.cars && b.cars[c.id];
    if (!st0 && (b.x - c.x) ** 2 + (b.y - c.y) ** 2 > M(2.7) ** 2) continue;   // далеко (дальше описанной окружности) и не внутри — мимо
    const L = toLocal(c, b.x, b.y), { hl, hw } = vSize(c);
    const inside = Math.abs(L.x) <= hl && Math.abs(L.y) <= hw;
    b.cars = b.cars || {};
    const st = b.cars[c.id];
    if (!inside) {
      if (st && !st.over) {                                    // вышла с другой стороны — ещё одна панель
        b.cars[c.id] = null;
        const zone = !b.low && Math.abs(L.x) < hl * 0.55 && Math.random() < VEH.glassK ? 'glass' : 'hull';
        if (carZone(b, c, zone, L, ux, uy, true)) return true;
      } else if (st) b.cars[c.id] = null;
      continue;
    }
    if (!st) {
      const over = carPassOver(b, c, people, ux, uy);
      b.cars[c.id] = { over, sx: Math.sign(L.x) || 1, sy: Math.sign(L.y) || 1, mid: false, eng: false, wh: 0 };
      if (over) continue;
      const wi = wheelAt(c, L);
      if (wi >= 0) { b.cars[c.id].wh |= 1 << wi; if (wheelHit(c, wi, b, ux, uy)) return true; continue; }
      // боковые окна салона — стекло (часть попаданий), иначе — кузов
      const zone = !b.low && Math.abs(L.x) < hl * 0.55 && Math.abs(L.y) > hw * 0.6 && Math.random() < VEH.glassK ? 'glass' : 'hull';
      if (carZone(b, c, zone, L, ux, uy, true)) return true;
      continue;
    }
    if (st.over) continue;
    const wi = wheelAt(c, L);
    if (wi >= 0 && !(st.wh & (1 << wi))) { st.wh |= 1 << wi; if (wheelHit(c, wi, b, ux, uy)) return true; }
    // моторный отсек
    const engX = hl - M(VEHICLES[c.model].len) * VEH.engineZone;
    if (!st.eng && L.x > engX) {
      st.eng = true;
      engineDamage(c, (b.t.armorDmg || 10) * b.e);
      if (carZone(b, c, 'engine', L, ux, uy, false)) return true;
    }
    // салон: пересекла середину — сиденья, стойки
    if (!st.mid && L.x <= engX && (Math.sign(L.y) !== st.sy || Math.sign(L.x) !== st.sx)) {
      st.mid = true;
      if (carZone(b, c, 'cabin', L, ux, uy, false)) return true;
    }
    // сидящие внутри
    for (let i = 0; i < c.seats.length; i++) {
      const q = c.seats[i] && personById(c.seats[i]);
      if (!q || q.id === b.owner || q.dead) continue;
      const p = seatPos(c, i);
      if (Math.hypot(p.x - b.x, p.y - b.y) < PR * 0.9) { hitPerson(q, b); return true; }
    }
  }
  return false;
}

// ---------- Отрисовка ----------
const CAR_SHAPE = {
  hatch: { hood: 0.24, roof: [0.34, 0.25], rear: 0.04 },
  sedan: { hood: 0.27, roof: [0.3, 0.22], rear: 0.16 },
  suv: { hood: 0.22, roof: [0.4, 0.3], rear: 0.05 },
  van: { hood: 0.14, roof: [0.6, 0.5], rear: 0.03 },
  sport: { hood: 0.34, roof: [0.24, 0.18], rear: 0.12 },
};
function drawVehicles() {
  if (!map || !map.cars) return;
  for (const c of map.cars) {
    const { hl, hw } = vSize(c);
    if (!onScreen(c.x, c.y, hl + 20)) continue;
    const S = CAR_SHAPE[c.model] || CAR_SHAPE.sedan, L = hl * 2, Wd = hw * 2;
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.a);
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, -hl + 4, -hw + 4, L, Wd, 8); ctx.fill();
    // кузов
    ctx.fillStyle = c.color;
    roundRect(ctx, -hl, -hw, L, Wd, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    // лобовое и заднее стёкла, крыша
    const fx = hl - L * S.hood;                                 // конец капота
    const roofF = fx - L * 0.1, roofB = roofF - L * S.roof[0];
    ctx.fillStyle = 'rgba(25,35,45,0.85)';
    roundRect(ctx, roofF, -hw + 4, L * 0.1, Wd - 8, 3); ctx.fill();                       // лобовое
    roundRect(ctx, roofB - L * 0.07, -hw + 5, L * 0.07, Wd - 10, 3); ctx.fill();          // заднее
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, roofB, -hw + 5, roofF - roofB, Wd - 10, 4); ctx.fill();                // крыша
    // боковые стёкла
    ctx.fillStyle = 'rgba(25,35,45,0.6)';
    ctx.fillRect(roofB, -hw + 1, roofF - roofB, 3); ctx.fillRect(roofB, hw - 4, roofF - roofB, 3);
    // фары и фонари
    ctx.fillStyle = 'rgba(255,240,200,0.7)';
    ctx.fillRect(hl - 4, -hw + 3, 3, 6); ctx.fillRect(hl - 4, hw - 9, 3, 6);
    ctx.fillStyle = c.ctrl && c.ctrl.thr < 0 && c.seats[0] ? 'rgba(255,60,40,0.95)' : 'rgba(150,30,25,0.8)';
    ctx.fillRect(-hl + 1, -hw + 3, 3, 5); ctx.fillRect(-hl + 1, hw - 8, 3, 5);
    // колёса (передние — с поворотом руля)
    ctx.fillStyle = '#151515';
    const wb = M(VEHICLES[c.model].wb) / 2;
    [[wb, -hw, c.steer], [wb, hw, c.steer], [-wb, -hw, 0], [-wb, hw, 0]].forEach(([wx, wy, st], i) => {
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(st);
      if (c.flats & (1 << i)) {
        ctx.fillStyle = '#262626'; ctx.fillRect(-6.5, -3.5, 13, 7);            // спущено: резина расплылась, виден диск
        ctx.fillStyle = '#8a8d90'; ctx.fillRect(-3, -1.5, 6, 3);
        ctx.fillStyle = '#151515';
      } else ctx.fillRect(-6, -2.5, 12, 5);
      ctx.restore();
    });
    // пробоины: в кузове — тёмные точки, в стекле — светлые «звёзды»
    for (const h of c.holes) {
      if (h[2]) { ctx.strokeStyle = 'rgba(220,230,240,0.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 0.8 + h[0]; ctx.moveTo(h[0], h[1]); ctx.lineTo(h[0] + Math.cos(a) * 3, h[1] + Math.sin(a) * 3); } ctx.stroke(); }
      ctx.fillStyle = h[3] ? 'rgba(90,90,90,0.9)' : 'rgba(12,12,12,0.85)';
      ctx.beginPath(); ctx.arc(h[0], h[1], h[3] ? 1.4 : 1.1, 0, Math.PI * 2); ctx.fill();
    }
    if (c.hp <= 0) { ctx.fillStyle = 'rgba(20,20,20,0.35)'; ctx.fillRect(fx, -hw + 2, L * S.hood - 2, Wd - 4); }   // капот в копоти
    ctx.restore();
  }
}
// Следы шин на асфальте: машину сносит вбок (занос, ручник) или колёса буксуют — тёмные полосы (у каждого на экране; у чужих машин —
// по скорости из снимка: боковая составляющая)
function vehSkids(dt) {
  if (!map || !map.cars) return;
  for (const c of map.cars) {
    if (c.parked || !onScreen(c.x, c.y, 120)) continue;
    const lat = Math.abs(-c.vx * Math.sin(c.a) + c.vy * Math.cos(c.a)) / PX_M;
    const slip = Math.max(lat, c.slip || 0);
    if (slip < 1.6 || carSpeed(c) < M(2)) continue;
    c.skidT = (c.skidT || 0) - dt;
    if (c.skidT > 0) continue;
    c.skidT = 0.03;
    const V = VEHICLES[c.model], wb = M(V.wb) / 2, hw = vSize(c).hw - 3, k = Math.min(0.45, 0.12 + slip * 0.04);
    for (const [lx, ly] of [[-wb, -hw], [-wb, hw], [wb, -hw], [wb, hw]]) {
      const p = toWorld(c, lx, ly);
      addDecal({ x: p.x, y: p.y, r: 2.2, c: `rgba(18,18,18,${k})` });
    }
  }
}

// Звук мотора своей машины (у каждого — своей, без сети). Обороты — по скорости и передаче (коробка: 5 передач, переключение
// на ~5500 об/мин вверх, на ~2200 вниз; на переключении газ на мгновение сброшен), с места и на нейтрали — от газа; нагрузка — газ.
const ENGINE_SND = { idle: 800, red: 6400, up: 5600, down: 2200, gears: [0, 14, 9, 6.4, 5, 4.1], shiftT: 0.18 };   // gears — об/мин на 1 км/ч
let engineSnd = null, engineSt = { gear: 1, rpm: 800, cutT: 0, car: null };
function engineRpm(c, dt) {
  const S = ENGINE_SND, st = engineSt, kmh = Math.abs(carSpeed(c) / PX_M * 3.6);
  if (st.car !== c) Object.assign(st, { gear: 1, rpm: S.idle, cutT: 0, car: c });
  const thr = c.seats[0] ? Math.max(0, Math.abs(c.ctrl.thr || 0)) : 0;
  st.cutT = Math.max(0, st.cutT - dt);
  const r = (g) => kmh * S.gears[g];
  if (st.gear < 5 && r(st.gear) > S.up && thr > 0) { st.gear++; st.cutT = S.shiftT; }
  else if (st.gear > 1 && r(st.gear) < S.down) st.gear--;
  // с места: сцепление пробуксовывает — обороты выше колёсных
  let target = Math.max(r(st.gear), S.idle + (kmh < 12 ? thr * 2600 * (1 - kmh / 12) : 0));
  target = Math.min(S.red, target);
  st.rpm += (target - st.rpm) * Math.min(1, dt * (st.cutT > 0 ? 6 : 12));
  return { rpm: st.rpm, load: st.cutT > 0 ? 0.1 : thr, cut: st.cutT > 0 ? 1 : 0 };
}
// Вне игры — мотор молчит
function engineSoundOff() { if (engineSnd) engineSnd.set({ on: false }); engineSt.car = null; }
function vehSound(dt = 1 / 60) {
  const p = me(), c = p && !p.dead && p.veh;
  if (!AC) return;
  if (!c) { if (engineSnd) engineSnd.set({ on: false }); engineSt.car = null; return; }
  if (!engineSnd) engineSnd = SFX.engineLoop();
  const on = c.hp > 0 && !!c.seats[0], e = engineRpm(c, dt);
  if (engineMisfire(c)) { e.cut = 1; e.load = 0.05; }          // повреждённый «чихает» — провал слышно
  engineSnd.set({ ...e, on });
}

// Дым из-под капота: заглох — густой чёрный, сильно повреждён — серые струйки (у каждого на экране, без сети)
function vehSmoke(dt) {
  if (!map || !map.cars) return;
  for (const c of map.cars) {
    const k = c.hp / VEHICLES[c.model].engineHp;
    if (k > 0.35) continue;
    c.smokeT = (c.smokeT || 0) - dt;
    if (c.smokeT > 0 || !onScreen(c.x, c.y, 200)) continue;
    const dead = c.hp <= 0;
    c.smokeT = dead ? 0.05 : 0.25;
    const p = toWorld(c, vSize(c).hl * 0.65, rand(-6, 6));
    addPart(p.x, p.y, rand(-12, 12) + c.vx * 0.3, rand(-30, -14) + c.vy * 0.3, dead ? rand(1.6, 2.6) : 1.2,
      dead ? `rgba(18,18,18,${rand(0.45, 0.7)})` : 'rgba(130,130,130,0.35)', dead ? rand(6, 10) : 5, 0.6, 3);
  }
}

// ---------- Камера в машине ----------
// OPTS.carCam: 'std' — как обычно, 'car' — за машиной: камера поворачивается вместе с ней (перед машины — вверх экрана)
function camRotTarget(v) {
  if (!v || !v.veh || OPTS.carCam !== 'car') return 0;
  return -Math.PI / 2 - v.veh.a;
}

// ---------- Сеть ----------
const carState = (c) => [c.id, VEH_IDS.indexOf(c.model), r1(c.x), r1(c.y), r2(c.a), r1(c.vx), r1(c.vy), r2(c.steer), Math.ceil(c.hp), c.parked ? 1 : 0, c.seats,
  c.ctrl.thr < 0 ? 1 : 0, c.flats || 0];
// Гость: позы машин (своя за рулём — у себя), кто где сидит (o.veh, o.seat), стоянки (клетки)
function applyCarState(list) {
  if (!map || !map.cars) return;
  const me0 = me();
  for (const [id, , x, y, a, vx, vy, steer, hp, parked, seats, rev, flats] of list || []) {
    const c = map.cars.find((q) => q.id === id);
    if (!c) continue;
    const mine = me0 && c.seats[0] === me0.id && seats[0] === me0.id;
    if (!mine) {
      Object.assign(c, { tx: x, ty: y, ta: a, vx, vy, steer, tT: performance.now() });
      if (c.tx0 === undefined || Math.hypot(c.x - x, c.y - y) > M(4)) { c.x = x; c.y = y; c.a = a; }
      c.tx0 = 1;
      c.ctrl = { thr: rev ? -1 : 0, steer: 0, hb: 0 };
    }
    c.hp = hp;
    c.seats = seats;
    c.flats = flats || 0;
    if (parked && !c.parked && !mine) { c.x = x; c.y = y; c.a = a; parkCar(c); }
    else if (!parked && c.parked) unparkCar(c);
  }
  for (const o of allPeople()) {
    o.veh = null; o.seat = -1;
    for (const c of map.cars) { const i = c.seats.indexOf(o.id); if (i >= 0) { o.veh = c; o.seat = i; } }
  }
}
// Гость, каждый кадр: чужие машины — к позе из снимка (с поправкой на скорость), сидящие — на местах
function guestVehicles(dt) {
  if (!map || !map.cars) return;
  const p = me(), now = performance.now();
  for (const c of map.cars) {
    const mine = p && p.veh === c && p.seat === 0;
    if (!mine && c.tx !== undefined && !c.parked) {
      const age = Math.min(0.12, (now - c.tT) / 1000);
      const gx = c.tx + c.vx * age, gy = c.ty + c.vy * age, k = Math.min(1, dt * 18);
      c.x += (gx - c.x) * k; c.y += (gy - c.y) * k;
      c.a += angDiff(c.ta, c.a) * k;
    }
    seatPeople(c);
  }
}
