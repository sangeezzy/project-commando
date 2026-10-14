// Двери: открыть/закрыть, заперта — ключ, выбить (дерево легко, металл трудно, броня никогда),
// пули по материалу, свет, звук, ИИ открывает незапертые двери. Ключи ко всем запертым дверям — на уровне.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  G.enemies = [];
  const D = (x, y) => map.doorAt.get(y * map.w + x);
  const stepAct = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateAct(p, 1 / 60); updateDoors(1 / 60); } };
  // встать перед дверью лицом к ней
  const before = (d, side) => {
    if (d.horiz) at(p, d.x, d.y + side); else at(p, d.x + side, d.y);
    p.a = Math.atan2(d.cy - p.y, d.cx - p.x); p.act = null;
  };

  run('набор дверей и ключей', () => {
    const types = new Set(map.doors.map((d) => d.type + (d.locked ? '-locked' : d.open ? '-open' : '')));
    check('все варианты дверей на уровне', ['wood', 'wood-locked', 'wood-open', 'metal', 'metal-locked', 'armored', 'armored-locked'].every((t) => types.has(t)), [...types]);
    const locked = map.doors.filter((d) => d.locked);
    check('к каждой запертой двери есть ключ', locked.every((d) => map.keys.some((k) => k.id === d.key)), locked.map((d) => d.key));
    // до ключа можно дойти от старта, не отпирая его дверь (через незапертые)
    const f = bfsFrom(map.start.x * TILE, map.start.y * TILE, 1e9, true);
    check('до каждого ключа можно дойти', map.keys.every((k) => f.f[tileIndex(k.x, k.y)] < 1e9), map.keys.map((k) => k.id + ':' + (f.f[tileIndex(k.x, k.y)] < 1e9)));
  });

  run('открыть и закрыть', () => {
    const d = D(13, 16);                       // деревянная, не заперта
    before(d, 1);
    check('закрытая: не пройти и не видно сквозь', solidTile(d.x, d.y) && !los(p.x, p.y, d.cx, d.cy - TILE));
    check('игрок видит дверь рядом', doorNear(p) === d);
    useDoor(p, d);
    check('E открывает', d.open && !solidTile(d.x, d.y) && los(p.x, p.y, d.cx, d.cy - TILE));
    stepAct(10);
    check('створка поворачивается плавно', d.ang > 0.3 && d.ang < 0.99, d.ang.toFixed(2));
    at(p, d.x, d.y);
    useDoor(p, d);
    check('стоя в проёме, закрыть нельзя', d.open);
    before(d, 1);
    useDoor(p, d);
    check('E закрывает', !d.open && solidTile(d.x, d.y));
  });

  run('ключи', () => {
    const d = D(20, 11);                       // деревянная, заперта, красный ключ
    p.keys = new Set();
    before(d, 1);
    useDoor(p, d);
    check('без ключа заперто', d.locked && !d.open && !p.act);
    // подобрать ключ: подойти к нему
    const k = map.keys.find((q) => q.id === 'red');
    p.x = k.x; p.y = k.y;
    updateKeys();
    check('ключ подбирается, проходя мимо', k.taken && p.keys.has('red'));
    before(d, 1);
    useDoor(p, d);
    check('с ключом начинает отпирать', p.act && p.act.kind === 'unlock');
    stepAct(30);
    check('отпирание занимает время', d.locked);
    stepAct(60);
    check('за 1,2 с отперто и открыто', !d.locked && d.open);
    before(d, 1); useDoor(p, d);
    check('отпертую можно закрыть и открыть', !d.open);
    useDoor(p, d);
    check('…и снова открыть', d.open);
  });

  run('выбить', () => {
    check('шансы: дерево легко, металл трудно, броня никогда', DOOR_TYPES.wood.kick > 0.4 && DOOR_TYPES.metal.kick > 0 && DOOR_TYPES.metal.kick < 0.25 && DOOR_TYPES.armored.kick === 0,
      [DOOR_TYPES.wood.kick, DOOR_TYPES.metal.kick, DOOR_TYPES.armored.kick]);
    // деревянная запертая (гараж, зелёный ключ): выбивается за несколько ударов
    const w = D(56, 42);
    p.keys = new Set();
    before(w, -1);
    let kicks = 0;
    while (!w.broken && kicks < 20) { startKick(p, w); stepAct(40); kicks++; }
    check('запертую деревянную выбивают ногой', w.broken && !w.locked && !solidTile(w.x, w.y), kicks);
    useDoor(p, w);
    check('выбитую деревянную не закрыть', !solidTile(w.x, w.y));
    // металлическая запертая: шанс малый, но выбить можно
    const m = D(9, 6);
    // доля удачных ударов по запертой двери (дверь возвращаем в запертое состояние)
    const rate = (d, n) => {
      let ok = 0;
      for (let i = 0; i < n; i++) {
        d.locked = true; d.open = false; d.broken = false; map.grid[d.i] = T.DOOR;
        if (kickDoor(d, p) === 'broke') ok++;
      }
      return ok / n;
    };
    const rm = rate(m, 400), rw = rate(w, 400);
    check('металлическую выбить можно, но трудно (~15% ударов)', rm > 0.08 && rm < 0.23, rm.toFixed(2));
    check('деревянную — примерно каждым вторым ударом', rw > 0.45 && rw < 0.65, rw.toFixed(2));
    m.locked = true; m.open = false; map.grid[m.i] = T.DOOR;
    while (kickDoor(m, p) !== 'broke');
    check('выбитая металлическая распахнута, замок сломан', !m.locked && m.open && !m.broken);
    closeDoor(m, null);
    check('у выбитой металлической сломан замок: закрывается, но не заперта', !m.open && !m.locked);
    // бронированная запертая: никогда
    const a = D(39, 44);
    let res = new Set();
    for (let i = 0; i < 50; i++) res.add(kickDoor(a, p));
    check('бронированную не выбить', res.size === 1 && res.has('never') && a.locked && !a.open);
    // незапертую бронированную удар просто распахивает
    const a2 = D(66, 47);
    check('незапертую любую удар распахивает', kickDoor(a2, p) === 'open' && a2.open);
    // ключ к бронедвери открывает её
    p.keys.add('yellow');
    before(a, 1); useDoor(p, a); stepAct(90);
    check('бронированную отпирает только ключ', !a.locked && a.open);
  });

  run('шум и противники', () => {
    const e = makeEnemy(0, 0, 0, null);
    G.enemies = [e];
    const d = D(20, 11); closeDoor(d, null); d.locked = true; d.broken = false; map.grid[d.i] = T.DOOR;
    at(e, 30, 20); e.st = 0;
    at(p, 21, 11);
    kickDoor(d, p);
    check('удар в дверь слышно сквозь стены: противник в 12 м настораживается', e.st >= 1, e.st);
    // ИИ открывает незапертую дверь на пути
    const g = D(52, 46);                        // металлическая, не заперта
    if (g.open) closeDoor(g, null);
    at(e, 54, 46); e.st = 1; e.notice = 0; e.seeing = false; e.investigate = true; e.lastX = 48 * TILE; e.lastY = 46.5 * TILE; e.goal = null; e.a = Math.PI;
    at(p, 36, 27);
    for (let i = 0; i < 6 * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('противник открывает незапертую дверь и выходит', g.open && e.x < 52 * TILE, [g.open, (e.x / TILE).toFixed(1)]);
    Object.assign(d, { locked: true, open: false, broken: false }); map.grid[d.i] = T.DOOR;   // удар мог её выбить
    check('сквозь запертую дверь ИИ путь не строит, сквозь незапертую — строит', !walkable(20, 11, true) && walkable(13, 16, true) && !walkable(13, 16, false));
    G.enemies = [];
  });

  run('пули и свет', () => {
    const t = makePerson('e', 0, 0);
    G.enemies = [t];
    const vital = WEAPONS.m4a1.vital; WEAPONS.m4a1.vital = 0;
    const shoot = (from, to) => {
      at(p, ...from); at(t, ...to); t.hp = 1e6; t.dead = false;
      p.a = Math.atan2(t.y - p.y, t.x - p.x); p.gun.chamber = 1; p.gun.mag = 10;
      fireRound(p, 0); for (let i = 0; i < 10; i++) updateBullets(1 / 60);
      return 1e6 - t.hp;
    };
    const d = D(13, 16); if (d.open) closeDoor(d, null);
    const wood = shoot([13, 19], [13, 14]);
    check('закрытую деревянную дверь пуля прошивает (с потерей)', wood > 20 && wood < 50, Math.round(wood));
    const a = D(66, 47); closeDoor(a, null);
    const arm = shoot([68, 47], [64, 47]);
    check('бронированную дверь пуля не берёт', arm === 0, arm);
    WEAPONS.m4a1.vital = vital;
    // свет из открытой двери затекает внутрь, закрыли — темнее
    const s = D(34, 40);
    if (!s.open) openDoor(s, null);
    const lit = ambientAt(34.5 * TILE, 41.5 * TILE);
    closeDoor(s, null);
    const dark = ambientAt(34.5 * TILE, 41.5 * TILE);
    check('закрытая дверь не пускает свет с улицы', lit > 0.4 && dark < 0.15, [lit.toFixed(2), dark.toFixed(2)]);
    openDoor(s, null);
    G.enemies = [];
  });

  run('отрисовка', () => {
    at(p, 34, 38); G.cam.x = p.x; G.cam.y = p.y; p.act = { kind: 'kick', d: D(34, 40), t: 0.3, dur: 0.6 };
    render(1 / 60);
    p.act = null;
    check('кадр с дверями, ключами и ударом ногой рисуется', true);
  });
  return T_.checks;
})();
