// Стрельба с колена: противник, ведущий прицельный огонь с места, приседает, если присев цель видно;
// за низким укрытием (присевший не видит поверх) стреляет стоя. С колена точнее. Пока меняет стойку — не стреляет.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const A = G.enemies[0];
  G.enemies = [A];
  ENEMY.fireMove.advanceChance = 0;   // проверяем стойку на месте (огонь на ходу — в тесте firemove)
  const prep = (tx, ty) => {
    at(A, tx, ty); A.a = A.want = Math.atan2(p.y - A.y, p.x - A.x); A.st = 2; A.notice = 1; A.seeing = false; A.react = 0;
    A.cover = null; A.coverT = 1e9;                     // без перебежек в укрытие: проверяем только стойку
    A.flank = null; A.flankCd = 1e9; A.role = null; A.peek = null; A.patrol = null; A.kneel = false; A.crouch = false; A.stillT = 0;
    A.gun = makeGun('m4a1', ENEMY.mags); A.dead = false; A.hp = 100; A.lamp = false; A.doorFire = null;
  };
  // n секунд; spreads — разброс выстрелов (перехват pullTrigger), shots — выстрелы с флагами стойки
  function sim(sec) {
    const shots = [];
    const orig = window.pullTrigger;
    window.pullTrigger = (o, h, pr, s) => { const r = orig(o, h, pr, s); if (r && o === A) shots.push({ s, kneel: A.kneel, crouch: A.crouch }); return r; };
    try { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60); trackSpeed(A, 1 / 60); } }
    finally { window.pullTrigger = orig; }
    return shots;
  }

  run('открытое место', () => {
    at(p, 36, 27); p.hp = 1e9; p.crouch = false;
    prep(36, 17);
    const early = sim(0.5);
    check('сразу после остановки ещё стоя', !A.kneel && early.every((s) => !s.kneel));
    const shots = sim(2.5);
    check('стоит на месте и стреляет — присел на колено', A.kneel && A.crouch, [A.kneel, A.crouch]);
    check('с колена продолжает стрелять, цель видна', shots.some((s) => s.kneel) && sightLine({ x: A.x, y: A.y, crouch: true }, p), shots.length);
    // один и тот же прицельный выстрел стоя и с колена (прицелился, без отдачи)
    const one = (kneel) => {
      let got = null;
      const orig = window.pullTrigger;
      window.pullTrigger = (o, h, pr, sp) => { got = sp; return false; };
      try { A.kneel = kneel; A.aimT = 10; A.gun.bloom = 0; A.supp = 0; A.blind = 0; A.react = 0; A.burst = 1; A.a = Math.atan2(p.y - A.y, p.x - A.x); shootAt(A, p, Math.hypot(p.x - A.x, p.y - A.y), 1 / 60, false); }
      finally { window.pullTrigger = orig; }
      return got;
    };
    const sStand = one(false), sKneel = one(true);
    check('с колена точнее', sKneel < sStand * 0.9, [sKneel.toFixed(2), sStand.toFixed(2)]);
    // смена стойки: стоял на месте, решил присесть — 0,3 с не стреляет, потом стреляет
    prep(36, 17); A.stillT = 5; A.kneel = false; A.gun.bloom = 0;
    const during = sim(0.25), after = sim(0.6);
    check('пока меняет стойку, не стреляет; потом — с колена', during.length === 0 && after.some((q) => q.kneel), [during.length, after.length]);
  });

  run('за низким укрытием — стоя', () => {
    // противник вплотную за бетонным блоком (32, 23), цель на юге
    at(p, 32, 31); p.hp = 1e9; p.crouch = false;
    prep(32, 22);
    const shots = sim(3);
    check('стреляет', shots.length > 0, shots.length);
    check('присев, не видел бы цель — поэтому стреляет стоя', shots.every((s) => !s.crouch) && !A.kneel, shots.filter((s) => s.crouch).length);
  });

  run('фонарь с колена', () => {
    // тёмная часть гаража: цель в той же комнате
    at(p, 60, 48); p.hp = 1e9; p.crouch = false; p.lamp = false;
    prep(65, 48);
    sim(3);
    check('в темноте стреляет с колена и фонарь не гасит', A.kneel && A.lamp, [A.kneel, A.lamp]);
  });

  run('отрисовка', () => {
    G.cam.x = A.x; G.cam.y = A.y; render(1 / 60);
    check('кадр с бойцом на колене рисуется', true);
  });
  G.enemies = [];
  return T_.checks;
})();
