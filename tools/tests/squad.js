// Групповая тактика (один подавляет, другой обходит), фланг в одиночку, тела убитых, реакция спокойных на выбивание двери.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const pool = G.enemies.slice();
  const prep = (e, tx, ty, a, st = 0) => {
    at(e, tx, ty); e.a = e.want = a; e.st = st; e.notice = st === 2 ? 1 : 0; e.seeing = false; e.lastSeen = -99; e.target = null;
    e.goal = null; e.searchT = 0; e.cover = null; e.patrol = null; e.home = { x: e.x, y: e.y, a }; e.look = a; e.lookT = 99;
    e.peek = null; e.peekCd = 0; e.flank = null; e.role = null; e.fightT = 0; e.flankCd = 0; e.huntFlank = false; e.bodies = new Set();
    e.investigate = false; e.doorFire = null; e.dead = false; e.hp = 100; e.react = 0; e.barkT = 0; e.lamp = false;
    e.gun = makeGun('m4a1', ENEMY.mags);
  };
  const face = (o, x, y) => { o.a = Math.atan2(y - o.y, x - o.x); };
  const sim = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60); updateWorldFx(); if (fn && fn(i) === false) return; } };
  const updateWorldFx = () => { if (G.barks) for (const b of G.barks) b.t -= 1 / 60; };
  // реплики: каждая — один раз (объект висит на экране несколько секунд)
  const seenB = new Set();
  const barks = () => (G.barks || []).filter((b) => !seenB.has(b) && seenB.add(b)).map((b) => b.text);
  const allBarks = () => (G.barks || []).map((b) => b.text);
  const outOfView = (x, y) => Math.abs(angDiff(Math.atan2(y - p.y, x - p.x), p.a)) > PLAYER_FOV;

  run('группа: один подавляет, другой обходит', () => {
    const [A, B] = pool;
    G.enemies = [A, B]; G.squad = { t: 0, flankCd: 0 }; G.barks = [];
    prep(A, 30, 17, Math.PI / 2, 2); prep(B, 42, 17, Math.PI / 2, 2);
    at(p, 36, 27); p.hp = 1e9; p.crouch = false; face(p, A.x, A.y);
    let roles = null, heard = [];
    sim(4, () => {
      heard.push(...barks());
      const f = [A, B].find((e) => e.flank), s = [A, B].find((e) => e.role === 'suppress');
      if (f && s && !roles) roles = { f, s, F: f.flank, goal: { x: f.flank.x, y: f.flank.y } };
    });
    check('назначены роли: подавляющий и обходящий', !!roles, [A.role, B.role]);
    check('переговариваются: «Прикрываю!» и «Обхожу!»', heard.includes('Прикрываю!') && heard.includes('Обхожу!'), [...new Set(heard)]);
    check('обход — к точке вне поля зрения игрока', roles && outOfView(roles.goal.x, roles.goal.y), roles && roles.goal);
    // обходящий уходит с линии огня и дальше идёт скрытно
    let broke = false;
    if (roles) sim(4, () => { if (roles.F.broke) { broke = true; return false; } });
    check('обходящий уходит из поля зрения игрока', broke);
  });

  run('подавление: цель скрылась — огонь по её месту', () => {
    const [A, B] = pool;
    G.enemies = [A, B]; G.squad = { t: 0, flankCd: 0 }; G.barks = [];
    prep(A, 32, 16, Math.PI / 2, 2); prep(B, 38, 15, Math.PI * 0.6, 2);
    at(p, 32, 24); p.hp = 1e9; p.crouch = false; p.supp = 0; face(p, A.x, A.y);
    sim(1.5);
    p.crouch = true;                                     // присел за бетонным блоком
    let shots = 0, maxSupp = 0;
    const last = new Map([[A, A.gun.lastShot], [B, B.gun.lastShot]]);
    sim(4, () => {
      for (const e of [A, B]) {
        if (e.gun.lastShot !== last.get(e)) { if (e.role === 'suppress' && !e.seeing) shots++; last.set(e, e.gun.lastShot); }
      }
      maxSupp = Math.max(maxSupp, p.supp);
    });
    check('подавляющий продолжает стрелять, не видя цель', shots >= 3, shots);
    check('пули ложатся рядом — игрок под подавлением', maxSupp > 0.2, maxSupp.toFixed(2));
  });

  run('фланг в одиночку', () => {
    const [A] = pool;
    G.enemies = [A]; G.squad = { t: 0, flankCd: 0 }; G.barks = [];
    const rate = ENEMY.flank.rate, hc = ENEMY.flank.huntChance;
    // затянувшийся бой с целью за укрытием: шанс поднят, чтобы не ждать
    ENEMY.flank.rate = 60;
    prep(A, 32, 17, Math.PI / 2, 2);
    at(p, 32, 24); p.hp = 1e9; p.crouch = false; face(p, A.x, A.y);
    let startT = null, goal = null, lasted = 0;
    sim(9, (i) => {
      if (A.flank && startT === null) { startT = i / 60; goal = { x: A.flank.x, y: A.flank.y }; }
      if (startT !== null) { if (A.flank) lasted = i / 60 - startT; else return false; }
    });
    check('бой затянулся, цель за укрытием — уходит во фланг', startT !== null && startT >= ENEMY.flank.after - 0.1, startT);
    check('фланг — точка вне поля зрения игрока', goal && outOfView(goal.x, goal.y), goal);
    check('с линии огня уходит, не бросая манёвр', lasted > 0.5, lasted.toFixed(2));
    // цель только что скрылась — заходит сбоку (продвижение с огнём здесь выключено, чтобы проверить именно обход)
    const adv = ENEMY.fireMove.advanceChance;
    ENEMY.flank.rate = 0; ENEMY.flank.huntChance = 1; ENEMY.fireMove.advanceChance = 0;
    prep(A, 30, 17, Math.PI / 2, 2);
    at(p, 36, 27); p.crouch = false; face(p, A.x, A.y);
    sim(1);
    at(p, 15, 12);                                       // ушёл в здание
    let flanked = false;
    sim(5, () => { if (A.flank) { flanked = true; return false; } });
    check('цель скрылась — заходит сбоку, а не в лоб', flanked && allBarks().includes('Захожу сбоку!'), allBarks());
    ENEMY.flank.rate = rate; ENEMY.flank.huntChance = hc; ENEMY.fireMove.advanceChance = adv;
  });

  run('тела убитых', () => {
    const [E1, E2, E3, dead] = pool;
    G.enemies = [E1, E2, E3, dead]; G.squad = { t: 0, flankCd: 0 }; G.barks = [];
    prep(dead, 36, 25, 0); dead.dead = true; dead.hp = 0; dead.deadT = G.time - 5; dead.deadA = 0; dead.bodyFound = false;
    prep(E1, 36, 19, Math.PI / 2);                       // смотрит на юг, на тело
    prep(E2, 44, 19, 0);                                 // рядом, смотрит в другую сторону
    prep(E3, 62, 40, 0);                                 // далеко
    at(p, 15, 12);
    const d0 = Math.hypot(E1.x - dead.x, E1.y - dead.y);
    let heard = [];
    sim(0.3, () => { heard.push(...barks()); });
    check('увидел тело — тревога', E1.st === 2, E1.st);
    check('кричит своим', heard.includes('Тут труп! Тревога!'), [...new Set(heard)]);
    check('ближний (не видевший тело) поднят по тревоге', E2.st === 2, E2.st);
    check('дальний не слышал', E3.st === 0, E3.st);
    sim(6, () => { heard.push(...barks()); });
    check('идёт к телу', Math.hypot(E1.x - dead.x, E1.y - dead.y) < d0 - M(2), (Math.hypot(E1.x - dead.x, E1.y - dead.y) / PX_M).toFixed(1));
    check('одно и то же тело — тревога один раз', heard.filter((t) => t === 'Тут труп! Тревога!').length === 1);
  });

  run('выбивание двери: спокойные идут проверить', () => {
    const [A, B] = pool;
    G.enemies = [A, B]; G.squad = { t: 0, flankCd: 0 };
    const door = map.doorAt.get(11 * map.w + 20);       // деревянная, заперта
    Object.assign(door, { locked: true, open: false, broken: false }); map.grid[door.i] = T.DOOR;
    prep(A, 25, 9, 0, 0);                               // спокоен, 5 м
    prep(B, 25, 14, 0, 1);                              // уже насторожен, 5 м
    at(p, 21, 11); face(p, door.cx, door.cy);
    kickDoor(door, p);
    check('спокойный в 5 м — не бой, а идёт проверить', A.st === 1 && A.investigate, [A.st, A.investigate]);
    check('настороженный рядом — сразу бой', B.st === 2, B.st);
    const d0 = Math.hypot(A.x - door.cx, A.y - door.cy);
    at(p, 15, 12);
    sim(3);
    check('спокойный идёт к источнику шума', Math.hypot(A.x - door.cx, A.y - door.cy) < d0 - M(1), (Math.hypot(A.x - door.cx, A.y - door.cy) / PX_M).toFixed(1));
  });

  run('отрисовка', () => {
    G.barks = [{ text: 'Обхожу!', t: 2 }];
    G.cam.x = p.x; G.cam.y = p.y; render(1 / 60);
    check('кадр с репликами рисуется', true);
  });
  G.enemies = [];
  return T_.checks;
})();
