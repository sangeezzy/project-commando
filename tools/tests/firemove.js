// Огонь на ходу: отход с огнём (ранен и открыт / цель вплотную), продвижение с подавлением (цель прижата, перезаряжается,
// или её держит наш подавляющий). Шагом, со штрафом точности moveAim; бегом не стреляют. Правила общие — и для ботов.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const [A, B] = G.enemies;
  const prep = (e, tx, ty) => {
    at(e, tx, ty); e.a = e.want = Math.atan2(p.y - e.y, p.x - e.x); e.st = 2; e.notice = 1; e.seeing = false; e.react = 0;
    e.cover = null; e.coverT = 1e9; e.flank = null; e.flankCd = 1e9; e.role = null; e.peek = null; e.patrol = null;
    e.fm = null; e.fmCd = 0; e.fmDecide = 0; e.kneel = false; e.crouch = false; e.dead = false; e.hp = 100; e.gun = makeGun('m4a1', 5);
    e.lamp = false; e.doorFire = null; e.target = null; e.lastSeen = -99; e.barkT = 0;
  };
  // n секунд; shots — выстрелы ИИ с его скоростью и бегом в момент выстрела
  function sim(sec, every) {
    const shots = [];
    const orig = window.pullTrigger;
    window.pullTrigger = (o, h, pr, s) => { const r = orig(o, h, pr, s); if (r && o.ai) shots.push({ o, v: o.speed / PX_M, sprint: o.sprint, s }); return r; };
    try { for (let i = 0; i < sec * 60; i++) { if (every) every(); G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60); for (const e of G.enemies) trackSpeed(e, 1 / 60); } }
    finally { window.pullTrigger = orig; }
    return shots;
  }
  const dist = (e) => Math.hypot(e.x - p.x, e.y - p.y) / PX_M;

  run('штраф на ходу', () => {
    G.enemies = [A];
    at(p, 36, 27); prep(A, 36, 17);
    const one = (speed) => {
      let got = null;
      const orig = window.pullTrigger;
      window.pullTrigger = (o, h, pr, sp) => { got = sp; return false; };
      try { A.speed = speed; A.aimT = 10; A.gun.bloom = 0; A.supp = 0; A.blind = 0; A.burst = 1; A.a = Math.atan2(p.y - A.y, p.x - A.x); shootAt(A, p, dist(A) * PX_M, 1 / 60, false); }
      finally { window.pullTrigger = orig; }
      return got;
    };
    const still = one(0), walk = one(M(ENEMY.speed.walk));
    check('на ходу (шагом) разброс больше на moveAim', Math.abs(walk - still - ENEMY.moveAim) < 0.5, [still.toFixed(1), walk.toFixed(1)]);
  });

  run('отход с огнём', () => {
    G.enemies = [A];
    at(p, 36, 27); p.hp = 1e9; p.crouch = false;
    prep(A, 36, 17); A.hp = 40;                      // ранен, стоит открыто
    const d0 = dist(A);
    const shots = sim(3);
    const moving = shots.filter((s) => s.o === A && s.v > 0.8);
    check('ранен и открыт — отходит', dist(A) > d0 + 1, [d0.toFixed(1), dist(A).toFixed(1)]);
    check('…ведя огонь на ходу', moving.length > 0, [moving.length, shots.length]);
    check('отходит шагом, лицом к цели (не бегом)', moving.every((s) => !s.sprint));
    // цель вплотную — отступает, даже не раненый
    prep(A, 36, 24); A.hp = 100;
    const c0 = dist(A);
    const s2 = sim(2);
    check('цель вплотную (3 м) — отступает с огнём', dist(A) > c0 + 0.8 && s2.some((s) => s.o === A && s.v > 0.5), [c0.toFixed(1), dist(A).toFixed(1)]);
  });

  run('продвижение с подавлением', () => {
    G.enemies = [A];
    at(p, 36, 27); p.hp = 1e9; p.crouch = false;
    prep(A, 20, 27);                                 // 16 м по дороге, открыто
    const d0 = dist(A);
    const shots = sim(4, () => { p.supp = 1; });     // цель прижата огнём
    const moving = shots.filter((s) => s.o === A && s.v > 0.8);
    check('цель прижата — идёт на неё', dist(A) < d0 - 2, [d0.toFixed(1), dist(A).toFixed(1)]);
    check('…стреляя на ходу, шагом', moving.length > 0 && moving.every((s) => !s.sprint), moving.length);
    sim(6, () => { p.supp = 1; });
    check(`ближе ${ENEMY.fireMove.advanceMin / PX_M} м не лезет`, dist(A) > ENEMY.fireMove.advanceMin / PX_M - 1.5, dist(A).toFixed(1));
    // из хорошего укрытия в одиночку на прижатую цель не идёт; если цель держит подавляющий напарник — идёт
    G.enemies = [A, B];
    prep(A, 32, 22); A.cover = { x: A.x, y: A.y };   // за бетонным блоком (32, 23)
    at(p, 32, 34);
    prep(B, 44, 22); B.role = 'suppress'; B.target = p;
    B.hp = 1e9;
    const a0 = dist(A);
    sim(4, () => { p.supp = 0; B.role = 'suppress'; B.target = p; B.cover = { x: B.x, y: B.y }; });
    check('цель держит под огнём напарник — идёт вперёд', dist(A) < a0 - 1, [a0.toFixed(1), dist(A).toFixed(1)]);
    check('подавляющий сам вперёд не идёт', Math.hypot(B.x - 44.5 * TILE, B.y - 22.5 * TILE) < M(1.5));
  });

  run('союзные боты — те же правила', () => {
    G.enemies = [A];
    const bot = makeBot(1, 0, 0, 0, 0);
    G.players.push(bot);
    at(p, 6, 27);                                    // человек в стороне
    at(A, 36, 27); A.st = 0; A.hp = 1e9; A.supp = 1; A.patrol = null; A.home = { x: A.x, y: A.y, a: 0 }; A.a = A.want = Math.PI;
    at(bot, 20, 27); bot.a = bot.want = 0; bot.st = 2; bot.notice = 1; bot.react = 0; bot.cover = null; bot.coverT = 1e9; bot.flankCd = 1e9; bot.leader = -1;
    const d0 = Math.hypot(bot.x - A.x, bot.y - A.y);
    let advanced = false;
    sim(4, () => { A.supp = 1; A.st = 0; A.notice = 0; if (bot.fm && bot.fm.kind === 'advance') advanced = true; });
    check('бот продвигается на прижатого противника с огнём', advanced && Math.hypot(bot.x - A.x, bot.y - A.y) < d0 - M(1.5), (Math.hypot(bot.x - A.x, bot.y - A.y) / PX_M).toFixed(1));
    G.players = G.players.filter((q) => q !== bot);
  });
  G.enemies = [];
  return T_.checks;
})();
