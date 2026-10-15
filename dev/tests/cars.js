// Машины: модели и места, физика (разгон, тормоза, поворот, сцепление, задний ход), стены и наезд, сесть / выйти, водитель — только пистолет,
// пули (кузов, стёкла, двигатель, сидящие; свои из машины её не задевают), двигатель и дым, броня машин (VEH_ARMOR), стоянка (клетки),
// камера «за машиной», снимок для сети, союзные боты садятся к ведущему.
window.__result = (() => {
  const { check, run, step, tick } = T_;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];
  const put = (o, x, y) => { o.x = o.px = x; o.y = o.py = y; o.speed = 0; };
  const kmh = (c) => carSpeed(c) / PX_M * 3.6;
  // открытое место: квадрат size × size м без препятствий (для физики на «бесконечной дороге» и для стрельбы)
  const openSpot = (size = 12) => {
    const r = Math.ceil(size / 2);
    for (let y = r + 1; y < map.h - r - 1; y++) for (let x = r + 1; x < map.w - r - 1; x++) {
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r && ok; dx++) if (tileAt(x + dx, y + dy) !== T.FLOOR) ok = false;
      if (ok) return { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    }
    return null;
  };
  // машина на открытом месте (снята со стоянки, перед — по +x)
  const carAt = (c, spot, a = 0) => { unparkCar(c); Object.assign(c, { x: spot.x, y: spot.y, a, vx: 0, vy: 0, w: 0, steer: 0 }); return c; };

  run('модели и карта', () => {
    check('места по модели: хэтчбек, седан, внедорожник — 5, минивэн — 7', VEHICLES.hatch.seats.length === 5 && VEHICLES.sedan.seats.length === 5 &&
      VEHICLES.suv.seats.length === 5 && VEHICLES.van.seats.length === 7);
    check('броня машин: от гражданской до Бр6 (держит 12,7)', VEH_ARMOR.civil.hull.stop === 0 && VEH_ARMOR.br4.hull.stop >= 3 && VEH_ARMOR.br6.hull.stop >= WEAPONS.m2.threat);
    startRange();
    const ents = map.ents.filter((e) => e.kind === 'car').length;
    check('все машины карты — на ходу', map.cars.length === ents && ents >= 2, [map.cars.length, ents]);
    const c = map.cars[0];
    check('стоит: клетки под ней — низкое укрытие (машина)', c.parked && c.stamp.length >= 6 && c.stamp.every((i) => map.grid[i] === T.LOW && map.wm[i] === WM.CAR), c.stamp.length);
  });

  // «Бесконечная дорога»: машину каждый шаг возвращаем на место (стены не мешают), скорость — сохраняется
  const road = (c, ctrl, sec, fn) => {
    const x0 = c.x, y0 = c.y;
    c.ctrl = ctrl;
    for (let i = 0; i < sec * 120; i++) {
      stepCar(c, 1 / 120);
      c.x = x0; c.y = y0;
      if (fn && fn(i / 120) === false) return i / 120;
    }
    return sec;
  };
  const freeCar = (model) => {
    startMap('big', 0, solo, false);
    const c = map.cars[0];
    carAt(c, openSpot(12));
    Object.assign(c, { model, armor: 'civil', hp: VEHICLES[model].engineHp });
    c.seats[0] = me().id;               // за рулём кто-то есть (двигатель работает)
    return c;
  };

  run('физика', () => {
    // разгон и скорость — из мощности, массы, сцепления и сопротивления воздуха
    let c = freeCar('sedan');
    const t100 = road(c, { thr: 1, steer: 0, hb: 0 }, 30, () => (kmh(c) >= 100 ? false : undefined));
    check('седан (90 л. с.): 0–100 км/ч за 10–14 с', t100 > 10 && t100 < 14, t100.toFixed(1));
    road(c, { thr: 1, steer: 0, hb: 0 }, 120);
    check('максимальная скорость — от мощности и сопротивления воздуха: 150–200 км/ч', kmh(c) > 150 && kmh(c) < 200, kmh(c).toFixed(0));
    c = freeCar('hatch');
    const th = road(c, { thr: 1, steer: 0, hb: 0 }, 30, () => (kmh(c) >= 100 ? false : undefined));
    check('хэтчбек (70 л. с.) разгоняется медленнее седана', th > t100, th.toFixed(1));
    c = freeCar('suv');
    const ts = road(c, { thr: 1, steer: 0, hb: 0 }, 30, () => (kmh(c) >= 100 ? false : undefined));
    check('внедорожник (150 л. с., полный привод) — быстрее седана', ts < t100, ts.toFixed(1));
    // тормоза: с 50 км/ч (ABS, ~0,85 g)
    c = freeCar('sedan');
    road(c, { thr: 1, steer: 0, hb: 0 }, 10, () => (kmh(c) >= 50 ? false : undefined));
    let dist = 0;
    road(c, { thr: -1, steer: 0, hb: 0 }, 5, () => { dist += carSpeed(c) / 120; return kmh(c) < 0.3 ? false : undefined; });
    check('тормозной путь с 50 км/ч — 10–15 м', dist / PX_M > 9.5 && dist / PX_M < 15, (dist / PX_M).toFixed(1));
    // задний ход
    c = freeCar('sedan');
    road(c, { thr: -1, steer: 0, hb: 0 }, 6);
    const back = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
    check('задний ход — назад, не быстрее ~22 км/ч', back < 0 && kmh(c) < VEH.vrev * 3.6 + 1, kmh(c).toFixed(1));
    // поворот на малой скорости: колёса на 35°
    c = freeCar('sedan');
    c.vx = M(5);
    road(c, { thr: 0.15, steer: 1, hb: 0 }, 2);
    const R = (carSpeed(c) / PX_M) / Math.max(1e-6, Math.abs(c.w));
    check('радиус поворота на 18 км/ч — 3,5–7 м', R > 3.5 && R < 7, R.toFixed(1));
    // на скорости: боковое ускорение (по повороту вектора скорости) — не больше сцепления
    c = freeCar('sedan');
    road(c, { thr: 1, steer: 0, hb: 0 }, 20, () => (kmh(c) >= 90 ? false : undefined));
    let lat = 0, pv = Math.atan2(c.vy, c.vx);
    road(c, { thr: 0.3, steer: 1, hb: 0 }, 1.5, () => { const hv = Math.atan2(c.vy, c.vx); lat = Math.max(lat, Math.abs(angDiff(hv, pv)) * 120 * carSpeed(c) / PX_M); pv = hv; });
    check('на 90 км/ч боковое ускорение — 0,6–0,95 g (сцепление шин)', lat > 0.6 * 9.81 && lat <= VEH.grip * 9.81 * 1.05, (lat / 9.81).toFixed(2));
    // ручник на 50 км/ч с рулём — зад уходит в занос
    c = freeCar('sedan');
    road(c, { thr: 1, steer: 0, hb: 0 }, 20, () => (kmh(c) >= 50 ? false : undefined));
    let hb = 0;
    road(c, { thr: 0, steer: 1, hb: 1 }, 1, () => { hb = Math.max(hb, Math.abs(angDiff(c.a, Math.atan2(c.vy, c.vx)))); });
    check('ручник с рулём — занос (кузов боком к движению > 30°)', hb * 57.3 > 30, Math.round(hb * 57.3));
    // двигатель заглох — не едет
    c = freeCar('sedan'); c.hp = 0;
    road(c, { thr: 1, steer: 0, hb: 0 }, 3);
    check('двигатель заглох — газ не работает', kmh(c) < 0.5);
    c.seats[0] = 0;
  });

  run('привод: передний, задний, полный', () => {
    check('у моделей — разные приводы', new Set(VEH_IDS.map((id) => VEHICLES[id].drive)).size === 3, VEH_IDS.map((id) => VEHICLES[id].drive));
    // одна и та же машина (седан), меняется только привод: в ливень, 40 км/ч, руль до упора, полный газ
    const limit = (drive) => {
      const c = freeCar('sedan');
      const was = VEHICLES.sedan.drive;
      VEHICLES.sedan.drive = drive;
      G.weather = { rain: 1, vis: 1, hear: 1, fog: 0, kind: 'heavy' };
      c.vx = M(11);
      road(c, { thr: 0.3, steer: 0, hb: 0 }, 0.5);
      let slip = 0, rs = 0, rn = 0;
      road(c, { thr: 1, steer: 1, hb: 0 }, 2, (t) => {
        slip = Math.max(slip, Math.abs(angDiff(c.a, Math.atan2(c.vy, c.vx))));
        const u = (c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a)) / PX_M;
        if (t > 0.5 && u > 1) { rs += c.w / (u * Math.tan(c.steer) / VEHICLES.sedan.wb); rn++; }
      });
      const c2 = freeCar('sedan');
      const t50 = road(c2, { thr: 1, steer: 0, hb: 0 }, 20, () => (kmh(c2) >= 50 ? false : undefined));
      G.weather = null;
      VEHICLES.sedan.drive = was;
      return { slip: Math.round(slip * 57.3), turn: rn ? rs / rn : 0, t50 };
    };
    const F = limit('fwd'), Rr = limit('rwd'), A = limit('awd');
    check('задний привод на газу в повороте срывает зад (занос), передний — нет', Rr.slip > 20 && F.slip < 10, [Rr.slip, F.slip]);
    check('передний на газу выносит носом сильнее полного', F.turn < A.turn, [F.turn.toFixed(2), A.turn.toFixed(2)]);
    check('полный привод в ливень разгоняется с места быстрее всех (меньше буксует)', A.t50 <= F.t50 && A.t50 <= Rr.t50, [A.t50.toFixed(2), F.t50.toFixed(2), Rr.t50.toFixed(2)]);
    // покрытие: на гравии тормозной путь длиннее
    const brake = (fm) => {
      const c = freeCar('sedan');
      const i = Math.floor(c.y / TILE) * map.w + Math.floor(c.x / TILE), old = map.fl[i];
      map.fl[i] = fm;
      road(c, { thr: 1, steer: 0, hb: 0 }, 10, () => (kmh(c) >= 50 ? false : undefined));
      let d = 0;
      road(c, { thr: -1, steer: 0, hb: 0 }, 6, () => { d += carSpeed(c) / 120; return kmh(c) < 0.3 ? false : undefined; });
      map.fl[i] = old;
      return d / PX_M;
    };
    const asph = brake(FM.ASPHALT), grav = brake(FM.GRAVEL);
    check('на гравии тормозной путь длиннее, чем на асфальте', grav > asph * 1.25, [asph.toFixed(1), grav.toFixed(1)]);
  });

  run('сесть, выйти, оружие водителя', () => {
    startRange();
    const p = me(), c = map.cars[0], bot = makeBot(1, 0, 0, 0, 0);
    G.enemies = [];
    const side = toWorld(c, 0, -(vSize(c).hw + M(0.7)));
    put(p, side.x, side.y);
    G.cam.x = p.x; G.cam.y = p.y;
    pressed.KeyF = true; step(1);
    check('F у машины — сел за руль', p.veh === c && p.seat === 0 && c.seats[0] === p.id);
    check('водитель — только пистолет', p.gun === p.kit[2] && WEAPONS[p.gun.t].cls === 'pistol');
    pressed.Digit1 = true; step(30);
    check('сменить на автомат за рулём нельзя', p.gun === p.kit[2] && p.cur === 2);
    G.players.push(bot); put(bot, side.x + M(1), side.y);
    check('второй — на пассажирское место', enterCar(bot, c) && bot.seat > 0);
    pressed.KeyF = true; step(1);
    check('F — вышел, в руках снова своё оружие', !p.veh && !c.seats[0] && p.cur === 0 && carDist(c, p.x, p.y) > 0);
    exitCar(bot);
    G.players = G.players.filter((q) => q !== bot);
  });

  run('вождение, стоянка, стены, наезд', () => {
    startMap('big', 0, solo, false);
    const p = me(), c = carAt(map.cars[0], openSpot(14));
    parkCar(c);
    G.enemies = [];
    enterCar(p, c, 0);
    const x0 = c.x, y0 = c.y, st0 = c.stamp.slice();
    keys.KeyW = true; step(60); keys.KeyW = false;
    check('газ — поехала, стоянка снята (клетки — пол)', Math.hypot(c.x - x0, c.y - y0) > M(1) && !c.parked && st0.every((i) => map.grid[i] === T.FLOOR),
      (Math.hypot(c.x - x0, c.y - y0) / PX_M).toFixed(1));
    check('сидящий — вместе с машиной', Math.hypot(p.x - seatPos(c, 0).x, p.y - seatPos(c, 0).y) < 1);
    keys.KeyS = true; step(40); keys.KeyS = false;          // тормоз (дольше — уже задний ход)
    for (let i = 0; i < 60 * 8 && !c.parked; i++) step(1);
    check('встала — снова стоянка (укрытие)', c.parked && c.stamp.length >= 3, c.stamp.length);
    // в стену: не проезжает
    keys.KeyW = true;
    let inWall = false;
    for (let i = 0; i < 60 * 8; i++) { step(1); if (carOutline(c).some((q) => tileAt(Math.floor(q.x / TILE), Math.floor(q.y / TILE)) === T.WALL)) inWall = true; }
    keys.KeyW = false; step(120);
    check('стены не проезжает (контур не заходит в стену)', !inWall);
    // наезд на человека
    exitCar(p, true);
    const e = makeEnemy(0, 0, 0, null); e.hp = 100; G.enemies = [e];
    Object.assign(c, { a: 0, vx: M(10), vy: 0, w: 0, parked: false, stamp: [] });
    unparkCar(c);
    put(e, c.x + vSize(c).hl + PR - 2, c.y);
    for (let i = 0; i < 3; i++) { c.x += c.vx / 60; carPeople(c, 1 / 60); }
    check('наезд на 36 км/ч — человек ранен / убит, отброшен', e.hp < 100 || e.dead, e.hp);
    // второй таран того же человека (прошло больше VEH.hitGap) — снова урон
    const e2 = makeEnemy(0, 0, 0, null); e2.hp = 1000; G.enemies = [e2];
    const ram = () => { put(e2, c.x + vSize(c).hl + PR - 2, c.y); for (let i = 0; i < 3; i++) { c.x += c.vx / 60; carPeople(c, 1 / 60); } };
    ram(); const h1 = e2.hp;
    G.time += VEH.hitGap + 0.1; ram();
    check('второй таран того же человека — снова урон', h1 < 1000 && e2.hp < h1, [h1, e2.hp]);
    // на скорости центр уже внутри кузова (проскочил кромку) — урон всё равно
    const e3 = makeEnemy(0, 0, 0, null); e3.hp = 1000; G.enemies = [e3];
    Object.assign(c, { vx: M(15), vy: 0, w: 0 });
    put(e3, c.x + vSize(c).hl - 4, c.y + 3);
    carPeople(c, 1 / 60);
    check('человек внутри кузова на 54 км/ч — урон', e3.hp < 1000, e3.hp);
  });

  run('пули: кузов, сидящие, двигатель, свои', () => {
    startMap('big', 0, solo, false);
    const p = me(), c = carAt(map.cars[0], openSpot(18) || openSpot(14));
    put(p, 2 * TILE, 2 * TILE);
    G.enemies = [];
    const shooter = makeEnemy(0, 0, 0, null); G.enemies.push(shooter);
    const fire = (t, from, to, n = 1, who = shooter) => {
      giveKit(who, t, null);
      who.gun.mag = 99; who.gun.chamber = 1; who.gun.pouch = [];
      put(who, from.x, from.y);
      who.a = Math.atan2(to.y - from.y, to.x - from.x);
      for (let i = 0; i < n; i++) { who.gun.chamber = 1; who.gun.cd = 0; fireRound(who, 0); for (let k = 0; k < 20; k++) updateBullets(1 / 60); }
    };
    // сидящий пассажир: пуля в дверь (M4) — ранит
    const bot = makeBot(1, 0, 0, 0, 0); G.players.push(bot);
    enterCar(bot, c, 1); bot.hp = 100; bot.god = false;
    const seat = seatPos(c, 1), out = toWorld(c, toLocal(c, seat.x, seat.y).x, vSize(c).hw + M(8));
    const h0 = c.holes.length, eng0 = c.hp;
    fire('m4a1', out, seat, 1);
    check('пуля в дверь — пробоина и ранение сидящего', c.holes.length > h0 && (bot.hp < 100 || bot.down || bot.dead), [c.holes.length - h0, bot.hp]);
    const back = toWorld(c, -vSize(c).hl - M(8), 0), rear = toWorld(c, -vSize(c).hl * 0.8, 0);
    fire('m1911', back, rear, 4);                 // пистолетная пуля гаснет в салоне — до моторного отсека не доходит
    check('попадания в двери и багажник двигатель не трогают', c.hp === eng0, [eng0, c.hp]);
    // броня машины: Бр4 держит M4 и АКМ
    exitCar(bot, true); bot.dead = false; bot.down = false; bot.hp = 100; enterCar(bot, c, 1);
    c.armor = 'br4';
    fire('akm', out, seat, 3);
    check('Бр4: автоматная пуля не проходит (сидящий цел, вмятины)', bot.hp === 100 && !bot.down, bot.hp);
    fire('m2', out, seat, 1);
    check('Бр4: 12,7 — пробивает', bot.hp < 100 || bot.down || bot.dead, bot.hp);
    exitCar(bot, true); bot.dead = false; bot.down = false; bot.hp = 100; enterCar(bot, c, 1);
    c.armor = 'br6';
    fire('m2', out, seat, 2);
    check('Бр6: держит и 12,7', bot.hp === 100, bot.hp);
    c.armor = 'civil';
    exitCar(bot, true);
    // двигатель: 12,7 убивает быстрее 5,56
    const eng = toWorld(c, vSize(c).hl * 0.7, 0), front = toWorld(c, vSize(c).hl + M(10), 0);
    const kill = (t) => { c.hp = VEHICLES[c.model].engineHp; let n = 0; while (c.hp > 0 && n < 200) { fire(t, front, eng, 1); n++; } return n; };
    const n556 = kill('m4a1'), n127 = kill('m2');
    check('двигатель: 12,7 глушит за меньше попаданий, чем 5,56', n127 < n556 && n556 < 200, [n556, n127]);
    check('машина не взрывается (на месте, просто заглохла)', map.cars.includes(c) && c.hp === 0);
    G.parts = []; G.cam.x = c.x; G.cam.y = c.y;
    for (let i = 0; i < 30; i++) vehSmoke(1 / 60);
    check('заглохла — из-под капота чёрный дым', G.parts.length > 3, G.parts.length);
    // свои: из машины — по своей машине и соседям не попадает
    c.hp = 50; c.holes = [];
    const p2 = makeBot(2, 0, 0, 0, 0); G.players.push(p2);
    enterCar(bot, c, 1); enterCar(p2, c, 2); bot.hp = 100; p2.hp = 100;
    const sb = seatPos(c, 2), target = toWorld(c, toLocal(c, sb.x, sb.y).x, -(vSize(c).hw + M(10)));
    giveKit(p2, 'm4a1', null);
    const hp0 = bot.hp;
    p2.a = Math.atan2(target.y - p2.y, target.x - p2.x); p2.gun.chamber = 1; p2.gun.cd = 0;
    for (let i = 0; i < 5; i++) { p2.gun.chamber = 1; p2.gun.cd = 0; fireRound(p2, 0); for (let k = 0; k < 20; k++) updateBullets(1 / 60); }
    check('пассажир стреляет из машины: ни пробоин в своей, ни ранений соседу', c.holes.length === 0 && bot.hp === hp0, [c.holes.length, bot.hp]);
    exitCar(bot, true); exitCar(p2, true);
    G.players = G.players.filter((q) => q !== bot && q !== p2);
  });

  run('удары: моторным отсеком — урон двигателю, задом и бортом — нет', () => {
    startMap('big', 0, solo, false);
    const p = me(), c = map.cars[0], sp = openSpot(18);
    G.enemies = [];
    const tx = Math.floor(sp.x / TILE), ty = Math.floor(sp.y / TILE);
    for (let y = ty - 6; y <= ty + 6; y++) { map.grid[y * map.w + tx + 6] = T.WALL; map.wm[y * map.w + tx + 6] = WM.CONCRETE; }
    for (let x = tx - 6; x <= tx + 6; x++) { map.grid[(ty + 6) * map.w + x] = T.WALL; map.wm[(ty + 6) * map.w + x] = WM.CONCRETE; }
    const hit = (a, vx, vy) => {
      carAt(c, sp, a); c.model = 'sedan'; c.hp = VEHICLES.sedan.engineHp;
      enterCar(p, c, 0);
      c.vx = M(vx); c.vy = M(vy);
      for (let i = 0; i < 120; i++) { c.ctrl = { thr: 0, steer: 0, hb: 0 }; updateVehicles(1 / 60); }
      exitCar(p, true);
      return VEHICLES.sedan.engineHp - c.hp;
    };
    const fr = hit(0, 15, 0), bk = hit(Math.PI, 15, 0), sd = hit(-Math.PI / 2, 0, 12);
    check('передом в стену на 54 км/ч — двигатель повреждён (20–80)', fr > 20 && fr < 80, fr.toFixed(0));
    check('задом в стену — двигатель цел', bk === 0, bk);
    check('боком в стену — двигатель цел', sd === 0, sd);
    // машина в машину: лоб в лоб — обе, в борт — только ударившая
    const b = map.cars[1];
    const two = (ab) => {
      carAt(c, { x: sp.x - M(4), y: sp.y - M(2) }, 0); c.hp = VEHICLES[c.model].engineHp;
      carAt(b, { x: sp.x + M(3), y: sp.y - M(2) }, ab); b.hp = VEHICLES[b.model].engineHp;
      c.vx = M(12); b.vx = ab === Math.PI ? -M(6) : 0;
      for (let i = 0; i < 60; i++) updateVehicles(1 / 60);
      return [VEHICLES[c.model].engineHp - c.hp, VEHICLES[b.model].engineHp - b.hp];
    };
    const hh = two(Math.PI), tb = two(Math.PI / 2);
    check('лоб в лоб — двигатели обеих повреждены', hh[0] > 5 && hh[1] > 5, hh.map(Math.round));
    check('в борт — урон только ударившей', tb[0] > 5 && tb[1] === 0, tb.map(Math.round));
  });

  run('ручник: занос без резкой остановки', () => {
    for (const model of ['sedan', 'hatch', 'suv']) {
      const c = freeCar(model);
      road(c, { thr: 1, steer: 0, hb: 0 }, 20, () => (kmh(c) >= 60 ? false : undefined));
      let prev = carSpeed(c) / PX_M, jerk = 0, rot = 0, at05 = 0;
      const a0 = c.a;
      road(c, { thr: 0, steer: 1, hb: 1 }, 2.5, (t) => {
        const v = carSpeed(c) / PX_M;
        jerk = Math.max(jerk, (prev - v) * 120); prev = v;
        rot = Math.max(rot, Math.abs(angDiff(c.a, a0)));
        if (Math.abs(t - 0.5) < 0.005) at05 = v;
      });
      check(`${model}: ручник с рулём — развернуло (> 60°), замедление плавное (≤ 13 м/с²), через 0,5 с ещё > 8 м/с`,
        rot * 57.3 > 60 && jerk <= 13 && at05 > 8, [Math.round(rot * 57.3), jerk.toFixed(1), at05.toFixed(1)]);
    }
    // развернуло боком на скорости (ручник) — скользит и гасит скорость шинами, а не встаёт на месте
    const c = freeCar('sedan');
    c.vx = 0; c.vy = M(12); c.a = 0;           // едет боком (вправо по машине) 43 км/ч
    let prev = carSpeed(c) / PX_M, jerk = 0;
    road(c, { thr: 0, steer: 0, hb: 1 }, 0.5, () => { const v = carSpeed(c) / PX_M; jerk = Math.max(jerk, (prev - v) * 120); prev = v; });
    check('боком на 43 км/ч — тормозит трением шин (≤ 13 м/с²), не встаёт сразу', jerk <= 13 && carSpeed(c) / PX_M > 4, [jerk.toFixed(1), (carSpeed(c) / PX_M).toFixed(1)]);
  });

  run('резина: обычная, гоночная, внедорожная', () => {
    check('по классу машины: обычным — обычная, внедорожнику — внедорожная, спорткару — гоночная, армейской — внедорожная',
      tiresOf({ model: 'sedan' }) === 'road' && tiresOf({ model: 'hatch' }) === 'road' && tiresOf({ model: 'van' }) === 'road' &&
      tiresOf({ model: 'suv' }) === 'offroad' && tiresOf({ model: 'sport' }) === 'race' && TIRE_FOR.military === 'offroad');
    const brake = (tires, fm) => {
      const c = freeCar('sedan');
      c.tires = tires;
      const i = Math.floor(c.y / TILE) * map.w + Math.floor(c.x / TILE), old = map.fl[i];
      map.fl[i] = fm;
      c.vx = M(50 / 3.6);
      let d = 0;
      road(c, { thr: -1, steer: 0, hb: 0 }, 8, () => { d += carSpeed(c) / 120; return kmh(c) < 0.3 ? false : undefined; });
      map.fl[i] = old;
      return d / PX_M;
    };
    const A = { road: brake('road', FM.ASPHALT), race: brake('race', FM.ASPHALT), off: brake('offroad', FM.ASPHALT) };
    const Gr = { road: brake('road', FM.DIRT), race: brake('race', FM.DIRT), off: brake('offroad', FM.DIRT) };
    const f = (o) => [o.race, o.road, o.off].map((v) => v.toFixed(1));
    check('асфальт: гоночная тормозит лучше всех, внедорожная — чуть хуже обычной', A.race < A.road * 0.93 && A.off > A.road && A.off < A.road * 1.15, f(A));
    check('грунт: внедорожная — намного лучше, гоночная — хуже всех', Gr.off < Gr.road * 0.85 && Gr.race > Gr.road * 1.25, f(Gr));
    const sp = freeCar('sport');
    const t100 = road(sp, { thr: 1, steer: 0, hb: 0 }, 30, () => (kmh(sp) >= 100 ? false : undefined));
    road(sp, { thr: 1, steer: 0, hb: 0 }, 90);
    check('спорткар: 0–100 км/ч за 5–7 с, максимальная 230–290 км/ч', t100 > 5 && t100 < 7 && kmh(sp) > 230 && kmh(sp) < 290, [t100.toFixed(1), kmh(sp).toFixed(0)]);
  });

  run('колёса: пробить пулей, пулестойкие, спущенное тянет', () => {
    startMap('big', 0, solo, false);
    const c = carAt(map.cars[0], openSpot(18) || openSpot(14));
    Object.assign(c, { model: 'sedan', armor: 'civil', hp: VEHICLES.sedan.engineHp, flats: 0, bpTires: false });
    put(me(), 2 * TILE, 2 * TILE);
    const sh = makeEnemy(0, 0, 0, null); G.enemies = [sh];
    const shoot = (lx, side) => {
      giveKit(sh, 'm4a1', null); sh.gun.mag = 30; sh.gun.chamber = 1;
      const to = toWorld(c, lx, side * (vSize(c).hw - M(0.1))), from = toWorld(c, lx, side * (vSize(c).hw + M(8)));
      put(sh, from.x, from.y); sh.a = Math.atan2(to.y - from.y, to.x - from.x);
      sh.gun.chamber = 1; sh.gun.cd = 0; fireRound(sh, 0); for (let k = 0; k < 20; k++) updateBullets(1 / 60);
    };
    const wb = M(VEHICLES.sedan.wb) / 2;
    shoot(wb, -1);
    check('пуля в переднее левое колесо — спущено', c.flats === 1, c.flats);
    shoot(-wb, 1);
    check('пуля в заднее правое — спущено и оно (навылет может достать и левое)', (c.flats & 8) && (c.flats & 1) && !(c.flats & 2), c.flats);
    const f0 = c.flats, h0 = c.holes.length; shoot(0, -1);
    check('пуля в дверь — колёса целы, пробоина', c.flats === f0 && c.holes.length > h0, c.flats);
    c.flats = 0; c.bpTires = true;
    shoot(wb, -1); shoot(-wb, -1);
    check('пулестойкие покрышки — не спускают', c.flats === 0, c.flats);
    const st = carState(c); c.flats = 5; applyCarState([st]);
    check('спущенные колёса — в снимке', c.flats === 0);
    // спущенное переднее левое: тянет влево, медленнее
    const drift = (flats) => {
      const q = freeCar('sedan'); q.flats = flats;
      road(q, { thr: 0.6, steer: 0, hb: 0 }, 4);
      return { a: angDiff(q.a, 0), v: kmh(q) };
    };
    const ok = drift(0), fl = drift(1), all = drift(15);
    check('спущено переднее левое — уводит влево', fl.a < -0.1 && Math.abs(ok.a) < 0.01, [fl.a.toFixed(2), ok.a.toFixed(2)]);
    check('все спущены — едет заметно медленнее', all.v < ok.v * 0.85, [all.v.toFixed(0), ok.v.toFixed(0)]);
  });

  run('камера за машиной', () => {
    startRange();
    const p = me(), c = map.cars[0];
    enterCar(p, c, 0);
    OPTS.carCam = 'car';
    for (let i = 0; i < 120; i++) step(1);
    check('камера повернулась: перед машины — вверх экрана', Math.abs(angDiff(G.camRot, -Math.PI / 2 - c.a)) < 0.05, [G.camRot.toFixed(2), (-Math.PI / 2 - c.a).toFixed(2)]);
    const s = worldToScreen(c.x + 100, c.y + 40), w = screenToWorld(s.x, s.y);
    check('экран ↔ мир с поворотом сходятся', Math.abs(w.x - c.x - 100) < 0.01 && Math.abs(w.y - c.y - 40) < 0.01);
    const f = worldToScreen(c.x + Math.cos(c.a) * 100, c.y + Math.sin(c.a) * 100), o = worldToScreen(c.x, c.y);
    check('вперёд по машине — вверх по экрану', f.y < o.y - 50 && Math.abs(f.x - o.x) < 10, [f.x - o.x, f.y - o.y]);
    let err = null; try { render(1 / 60); } catch (e2) { err = String(e2); }
    check('кадр с повёрнутой камерой — без ошибок', !err, err);
    keys.KeyW = true; keys.KeyD = true; step(1);
    check('камера за машиной: W — газ, D — руль вправо (не смешиваются поворотом камеры)', c.ctrl.thr === 1 && c.ctrl.steer === 1, [c.ctrl.thr, c.ctrl.steer]);
    keys.KeyW = false; keys.KeyD = false; step(1);
    pressed.KeyC = true; step(1);
    check('C в машине — камера обычная', OPTS.carCam === 'std');
    for (let i = 0; i < 120; i++) step(1);
    check('камера вернулась без поворота', Math.abs(G.camRot) < 0.02, G.camRot);
    exitCar(p, true);
  });

  run('сеть: снимок машин', () => {
    startRange();
    const p = me(), c = map.cars[1];
    enterCar(p, c, 0);
    c.hp = 33;
    const st = map.cars.map(carState);
    p.veh = null; p.seat = -1;
    applyCarState(st);
    check('машины и кто где сидит доходят', p.veh === c && p.seat === 0 && c.hp === 33);
    exitCar(p, true);
  });

  run('союзные боты садятся к ведущему', () => {
    startMap('big', 0, solo, true);
    const p = me(), bots = G.players.filter((q) => q.ai), c = map.cars[0];
    G.enemies = [];
    enterCar(p, c, 0);
    bots.forEach((b, i) => put(b, c.x + M(4 + i), c.y + M(4)));
    for (let i = 0; i < 60 * 10; i++) tick(1);
    const inside = bots.filter((b) => b.veh === c).length;
    check('ведущий в машине — боты садятся (сколько есть мест)', inside === Math.min(bots.length, c.seats.length - 1), [inside, bots.length]);
    exitCar(p, true);
    for (let i = 0; i < 60; i++) tick(1);
    check('ведущий вышел — выходят и они', bots.every((b) => !b.veh));
  });
  return T_.checks;
})();
