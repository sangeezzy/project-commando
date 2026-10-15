// Игровое меню на ПК (Esc) — то же, что ≡ на телефоне: открыть/закрыть, пауза одиночки, пункты только для сенсора скрыты,
// выход в главное меню — кнопкой; чувствительность поворота камеры по взгляду (ползунок только в этой камере; мышь).
window.__result = (() => {
  const { check, step, at, run, dummy } = T_;
  const p = me();
  const esc = () => { dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape' })); };
  const el = (id) => document.getElementById(id);
  const shown = (id) => { const e = el(id); return !!e && e.offsetParent !== null; };
  const move = (dx, dy) => canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, clientX: 5, clientY: 5 }));
  G.enemies.forEach(dummy);

  run('Esc — меню', () => {
    check('ПК (не сенсор)', !TouchUI.on);
    G.state = 'play'; G.role = 'solo';
    esc();
    check('Esc в игре — меню открыто, не выход', touchMenuOpen() && G.state === 'play' && !!map);
    check('управление стоит, одиночка на паузе', uiOpen() && touchPaused());
    const e = G.enemies[0], ex = e.x, ey = e.y;
    G.bullets = [{ x: 100, y: 100, sx: 100, sy: 100, mx: 100, my: 100, vx: 1000, vy: 0, owner: -1, side: 'e', e: 1, dist: 0, max: 1e6, car: 0, tile: -1, near: [], t: WEAPONS.m4a1 }];
    step(10);
    check('мир стоит (пуля не летит)', G.bullets.length === 1 && G.bullets[0].x === 100 && e.x === ex && e.y === ey, G.bullets[0] && G.bullets[0].x);
    G.bullets = [];
    check('видны: продолжить, выход, масштаб, камера, видимость', ['tmuResume', 'tmuLeave', 'tmuOut', 'tmuCam-std', 'tmuSightDn', 'tmuFull'].every(shown));
    check('скрыты пункты сенсора: кнопки, ТТХ, аим ассист', !shown('tmuLayout') && !shown('tmuSpecs') && !shown('tmuAssist-soft'));
    esc();
    check('Esc ещё раз — закрыто, игра идёт', !touchMenuOpen() && !touchPaused(), [touchMenuOpen(), touchPaused(), G.state, G.role, G.lockMenuAt, performance.now() | 0, uiOpen()]);
    esc(); el('tmuResume').click();
    check('«Продолжить» — закрыто', !touchMenuOpen());
    // окно стола открыто — Esc закрывает его, а не открывает меню
    loadoutEl.classList.remove('hidden');
    esc();
    check('Esc при открытом окне стола — закрыто окно, меню не открыто', !loadoutOpen() && !touchMenuOpen());
  });

  run('чувствительность поворота', () => {
    OPTS.cam = 'std'; OPTS.turnK = 1;
    esc();
    check('обычная камера — ползунка и прицела нет', !shown('tmuTurn') && !shown('tmuAim-laser'));
    el('tmuCam-look').click();
    check('«по взгляду» — ползунок и выбор прицела появились', OPTS.cam === 'look' && shown('tmuTurn') && shown('tmuAim-laser'));
    const r = el('tmuTurn');
    r.value = '2'; r.dispatchEvent(new Event('input'));
    check('ползунок — OPTS.turnK, подпись', OPTS.turnK === 2 && el('tmuTurnV').textContent === '×2,00', [OPTS.turnK, el('tmuTurnV').textContent]);
    check('запомнено', JSON.parse(localStorage.getItem('pcr-opts')).turnK === 2);
    el('tmuAim-laser').click();
    check('прицел из меню — лазер', OPTS.laser === true);
    el('tmuAim-cross').click();
    el('tmuResume').click();
    at(p, 36, 27); p.a = 0; step(1);
    const a0 = p.a; move(100, 0); step(1);
    check('мышь: поворот × чувствительность', Math.abs(angDiff(p.a, a0) - 100 * CAM.turn * 2) < 1e-6, [angDiff(p.a, a0), 100 * CAM.turn * 2]);
    OPTS.turnK = 0.5;
    const a1 = p.a; move(100, 0); step(1);
    check('×0,5 — вдвое медленнее обычного', Math.abs(angDiff(p.a, a1) - 100 * CAM.turn * 0.5) < 1e-6);
    esc(); el('tmuCam-std').click();
    check('обычная камера — ползунок снова скрыт', !shown('tmuTurn'));
    el('tmuResume').click();
    OPTS.turnK = 1; saveOpts();
  });

  run('камера по взгляду: меню закрывается с первого раза', () => {
    OPTS.cam = 'look';
    G.state = 'play';
    // захват мыши снят Esc → меню открыто
    G.menuClosedAt = -1e9; G.lockDrop = false;
    document.dispatchEvent(new Event('pointerlockchange'));
    check('снятие захвата — меню', touchMenuOpen());
    // тот же Esc сразу после — не закрывает (открыто им же)
    esc();
    check('тот же Esc (в пределах 0,4 с) меню не закрывает', touchMenuOpen());
    G.lockMenuAt = -1e9;
    esc();
    check('следующий Esc — закрыто', !touchMenuOpen());
    // захват, запрошенный при закрытии, тут же снялся — меню не открывается снова
    document.dispatchEvent(new Event('pointerlockchange'));
    check('потеря захвата сразу после закрытия — меню не открывается', !touchMenuOpen());
    // щелчок без захвата — только захват, не выстрел
    mouse.l = false;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    check('щелчок без захвата мыши — не выстрел', !mouse.l && !mouse.lPressed);
    OPTS.cam = 'std';
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    check('обычная камера — щелчок стреляет', mouse.l);
    dispatchEvent(new MouseEvent('mouseup', { button: 0 })); mouse.lPressed = false;
  });

  run('выход в главное меню', () => {
    esc();
    el('tmuLeave').click();
    check('кнопка «Выйти» — главное меню', G.state === 'menu' && !touchMenuOpen(), G.state);
  });
  return T_.checks;
})();
