// Звук сквозь двери и стрельба через дверь: деревянная пропускает часть звука, металлическая почти нет, бронированная — нет.
// Противник в тревоге, не видя цели и услышав шум за закрытой дверью, даёт очередь веером по двери (не в цель).
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const e = makeEnemy(0, 0, 0, null);
  G.enemies = [e];
  const D = (x, y) => map.doorAt.get(y * map.w + x);
  const wood = D(13, 16), metal = D(52, 46), armor = D(66, 47);   // закрыты, не заперты
  const reset = (st, tx, ty, a) => {
    at(e, tx, ty); e.a = e.want = a; e.st = st; e.notice = st === 2 ? 1 : 0; e.seeing = false;
    e.doorFire = null; e.doorFireCd = 0; e.goal = null; e.investigate = false; e.searchT = 0; e.lastSeen = -99;
    e.gun = makeGun('m4a1', ENEMY.mags); e.cover = null; e.patrol = null; e.home = { x: e.x, y: e.y, a };
  };
  const walk = () => makeNoise(p.x, p.y, M(NOISE.step), 'step', p);
  const sprint = () => makeNoise(p.x, p.y, M(NOISE.sprint), 'step', p);

  run('звук сквозь двери', () => {
    p.hp = 1e9;
    reset(0, 13, 18, -Math.PI / 2); at(p, 13, 15); walk();
    check('деревянная: шаги вплотную к двери слышно с той стороны', e.st === 1, e.st);
    reset(0, 13, 18, -Math.PI / 2); at(p, 13, 12); walk();
    check('деревянная: шаги в 4 м от двери не слышно', e.st === 0, e.st);
    reset(0, 13, 20, -Math.PI / 2); at(p, 13, 12); sprint();
    check('деревянная: бег слышно и подальше', e.st === 1, e.st);
    reset(0, 50, 46, 0); at(p, 53, 46); walk();
    check('металлическая: шаги рядом не слышно', e.st === 0, e.st);
    reset(0, 50, 46, 0); at(p, 53, 46); sprint();
    check('металлическая: бег вплотную слышно', e.st === 1, e.st);
    reset(0, 68, 47, Math.PI); at(p, 65, 47); sprint();
    check('бронированная: не слышно ничего', e.st === 0, e.st);
  });

  // прогнать до конца веера; вернуть углы выстрелов
  function sweep(sec = 3) {
    const shots = [];
    const orig = window.fireRound;
    window.fireRound = (o, s) => { if (o === e) shots.push(o.a); orig(o, s); };
    try {
      for (let i = 0; i < sec * 60 && (e.doorFire || !shots.length); i++) { G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60); }
    } finally { window.fireRound = orig; }
    return shots;
  }

  run('стрельба через дверь', () => {
    // противник снаружи в 4 м, смотрит на дверь; игрок внутри сбоку от двери
    reset(2, 13, 20, -Math.PI / 2); at(p, 11, 14); p.hp = 1e9; sprint();
    check('в тревоге услышал шум за дверью — начинает обстрел двери', !!e.doorFire);
    const a = sweep();
    const doorA = Math.atan2(wood.cy - e.y, wood.cx - e.x), playerA = Math.atan2(p.y - e.y, p.x - e.x);
    const diffs = a.slice(1).map((v, i) => angDiff(v, a[i]));
    const mono = diffs.every((d) => d > 0) || diffs.every((d) => d < 0);
    const span = Math.abs(angDiff(a[a.length - 1], a[0]));
    check('очередь 6–10 выстрелов', a.length >= 6 && a.length <= 10, a.length);
    check('ведёт стволом в одну сторону (веер)', mono, diffs.map((d) => d.toFixed(3)));
    check('веер на всю ширину двери', span > 0.3, span.toFixed(2));
    const mid = a[Math.floor(a.length / 2)];
    check('стреляет по двери, а не в игрока', Math.abs(angDiff(mid, doorA)) < 0.1 && Math.abs(angDiff(mid, playerA)) > 0.2, [mid.toFixed(2), doorA.toFixed(2), playerA.toFixed(2)]);
    check('дверь осталась закрытой (не пошёл открывать)', !doorPassable(wood));
    // направление веера — случайное
    let lr = 0, rl = 0;
    for (let k = 0; k < 16; k++) {
      reset(2, 13, 20, -Math.PI / 2); at(p, 13, 14); sprint();
      const s = sweep();
      if (s.length > 1) { if (angDiff(s[s.length - 1], s[0]) > 0) lr++; else rl++; }
    }
    check('слева направо и справа налево — случайно', lr > 0 && rl > 0, [lr, rl]);
    // стоящего прямо за дверью пули находят
    p.hp = 1e9;
    for (let k = 0; k < 6; k++) { reset(2, 13, 20, -Math.PI / 2); at(p, 13, 15); sprint(); sweep(); }
    check('стоящего прямо за деревянной дверью задевает', p.hp < 1e9, Math.round(1e9 - p.hp));
    // в ответ на выстрел из-за двери
    reset(2, 13, 20, -Math.PI / 2); at(p, 12, 13); p.a = 0; p.gun.chamber = 1; fireRound(p, 0); G.bullets = [];
    check('выстрел из-за двери тоже вызывает обстрел двери', !!e.doorFire);
  });

  run('когда не стреляет', () => {
    reset(0, 13, 18, -Math.PI / 2); at(p, 13, 15); sprint();
    check('спокойный — не стреляет, идёт проверить', !e.doorFire && e.st === 1);
    reset(2, 50, 46, 0); at(p, 53, 46); sprint();
    check('металлическая: в тревоге тоже стреляет сквозь неё (пуля пробивает)', !!e.doorFire);
    reset(2, 68, 47, Math.PI); at(p, 65, 47); sprint();
    check('бронированная: не стреляет (не слышно, не пробить)', !e.doorFire);
    openDoor(wood, null);
    reset(2, 13, 20, -Math.PI / 2); at(p, 11, 14); sprint();
    check('открытая дверь — не обстрел двери, а обычный поиск', !e.doorFire);
    closeDoor(wood, null);
    // дверь не видно (стоит за углом здания)
    reset(2, 22, 15, Math.PI); at(p, 13, 15); sprint();
    check('дверь не в поле зрения — не стреляет вслепую', !e.doorFire);
  });
  G.enemies = [];
  return T_.checks;
})();
