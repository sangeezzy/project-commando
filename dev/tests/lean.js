// Выглядывание (Q/E) и раскладка: L — фонарь, F — взаимодействие (двери).
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
  const t = makeEnemy(0, 0, 0, null);
  G.enemies = [t];
  const press = (code, n = 2) => { keys[code] = true; pressed[code] = true; step(n); keys[code] = false; };
  const hold = (code, n) => { keys[code] = true; step(n); };
  const release = () => { for (const k in keys) keys[k] = false; };
  // мышь — строго вверх от бойца
  const lookUp = () => { G.cam.x = p.x; G.cam.y = p.y; mouse.x = VW / 2; mouse.y = VH / 2 - 200; };

  run('раскладка', () => {
    release(); at(p, 36, 27); lookUp(); p.lamp = false;
    press('KeyL');
    check('L — фонарь', p.lamp === true);
    press('KeyL'); p.lamp = false;
    const d = map.doorAt.get(16 * map.w + 13);       // деревянная, не заперта, закрыта
    if (d.open) closeDoor(d, null);
    at(p, 13, 17); G.cam.x = p.x; G.cam.y = p.y; mouse.x = VW / 2; mouse.y = VH / 2 - 200;
    press('KeyE');
    check('E больше не открывает дверь', !d.open);
    press('KeyF');
    check('F — взаимодействие: открывает дверь', d.open);
    press('KeyF');
    check('F — и закрывает', !d.open);
    release();
  });

  // угол кирпичного здания: стена x = 20 (y 6..16); игрок прижат к углу снизу, смотрит на север вдоль стены
  const atCorner = () => { p.x = p.px = 21 * TILE - PR + 4; p.y = p.py = 17.5 * TILE; p.speed = 0; };
  run('выглядывание из-за угла', () => {
    release();
    atCorner(); lookUp(); p.crouch = false; p.crouchToggle = false;
    at(t, 21, 10); t.st = 0; t.notice = 0; t.a = Math.PI / 2;
    step(5);
    check('из-за угла цель не видно', !playerSees(p, t));
    hold('KeyE', 20);
    check('E — наклон вправо', p.lean > 0.9 && p.leanPx > M(0.4), [p.lean.toFixed(2), (p.leanPx / PX_M).toFixed(2)]);
    check('глаза сместились вправо (на восток), тело на месте', p.lx > p.x + M(0.4) && Math.abs(p.x - (21 * TILE - PR + 4)) < 1);
    check('выглянув, видно цель за углом', playerSees(p, t));
    check('тело по-прежнему за стеной', !sightLine(p, t));
    // стреляет из-за угла
    t.hp = 1e6; p.a = Math.atan2(t.y - p.ly, t.x - p.lx); p.gun.chamber = 1; p.gun.mag = 10;
    fireRound(p, 0); for (let i = 0; i < 6; i++) updateBullets(1 / 60);
    check('выглянув, попадает по цели за углом', t.hp < 1e6, Math.round(1e6 - t.hp));
    release(); step(20);
    check('отпустил — вернулся за угол', Math.abs(p.lean) < 0.05 && !playerSees(p, t));
    t.hp = 1e6; p.a = Math.atan2(t.y - p.y, t.x - p.x); p.gun.chamber = 1;
    fireRound(p, 0); for (let i = 0; i < 6; i++) updateBullets(1 / 60);
    check('без выглядывания пуля в стену', t.hp === 1e6);
    hold('KeyQ', 20);
    check('Q — наклон влево', p.lean < -0.9);
    release(); step(20);
  });

  run('сквозь стену не высунуться', () => {
    release();
    p.x = p.px = 21 * TILE + PR + 0.5; p.y = p.py = 12.5 * TILE; G.cam.x = p.x; G.cam.y = p.y; mouse.x = VW / 2; mouse.y = VH / 2 - 200;   // прижат к стене слева
    hold('KeyQ', 20);
    check('у стены наклон упирается в неё', Math.abs(p.leanPx) < M(0.2) && !solidAt(p.lx, p.ly), (p.leanPx / PX_M).toFixed(2));
    at(t, 17, 12);
    check('сквозь стену не видно', !playerSees(p, t));
    release(); step(20);
  });

  run('противник видит только голову', () => {
    release();
    atCorner(); lookUp(); hold('KeyE', 20);
    at(t, 21, 10); t.a = Math.PI / 2; t.st = 0; t.notice = 0; t.seeing = false;
    const s = perceive(t);
    check('противник видит высунувшегося', s && s.partial && Math.abs(s.px - p.lx) < 1, s && [s.partial, s.px, p.lx]);
    const part = noticeTime(t, p, s.d, s.off, true), full = noticeTime(t, p, s.d, s.off, false);
    check('замечает дольше, чем стоящего открыто', part >= full * 1.7, [part.toFixed(2), full.toFixed(2)]);
    // попадание в высунувшуюся голову и плечо
    p.hp = 1e6;
    t.a = Math.atan2(p.ly - t.y, p.lx - t.x); t.gun.chamber = 1; t.gun.mag = 10;
    fireRound(t, 0); for (let i = 0; i < 6; i++) updateBullets(1 / 60);
    check('в высунувшуюся голову можно попасть', p.hp < 1e6);
    release(); step(20);
    p.hp = 1e6;
    t.a = Math.atan2(p.y - t.y, p.x - t.x); t.gun.chamber = 1;
    fireRound(t, 0); for (let i = 0; i < 6; i++) updateBullets(1 / 60);
    check('спрятавшегося за углом не достать', p.hp === 1e6);
    check('и не видно', !perceive(t));
  });

  run('движение', () => {
    release();
    at(p, 36, 27); lookUp();
    keys.KeyE = true; keys.KeyW = true;
    step(10);
    const y0 = p.y; step(30);
    const v = (y0 - p.y) / 0.5 / PX_M;
    check('наклонившись, идёт не быстрее, чем с прицелом', v <= LEAN.speed + 0.05, v.toFixed(2));
    keys.ShiftLeft = true; step(15);
    check('бег отменяет выглядывание', p.sprint && Math.abs(p.lean) < 0.2, p.lean.toFixed(2));
    release(); step(10);
    keys.KeyE = true; step(20);
    G.cam.x = p.x; G.cam.y = p.y;
    render(1 / 60);
    check('кадр с выглядывающим бойцом рисуется', true);
    release();
  });
  G.enemies = [];
  return T_.checks;
})();
