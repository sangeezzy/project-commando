// Камера по взгляду на сенсоре (?touch=1): правый стик вбок — поворот, вверх за кольцо — огонь без поворота, левый стик — по экрану
window.__result = (() => {
  const { check, run, at, step, dummy } = T_;
  const p = me();
  G.enemies.forEach(dummy);
  const RS = touchR() * TOUCH.stickK, X = VW - 300, Y = VH - 200;
  run('правый стик', () => {
    touchReset(); at(p, 36, 27); p.a = -Math.PI / 2;
    setCamMode('look'); step(2);
    const s = worldToScreen(p.x, p.y);
    check('боец внизу посередине', Math.abs(s.x - VW / 2) < 1 && Math.abs(s.y - VH * (1 - CAM.bottom)) < 1, [s.x, s.y]);
    let a0 = p.a;
    touchStart(5, X, Y); touchMove(5, X + RS * 0.9, Y); step(30);
    const turned = angDiff(p.a, a0), want = 0.81 * TOUCH.lookTurn * 0.5;
    check('стик вправо — поворот вправо, скорость по отклонению', Math.abs(turned - want) < 0.1, [turned, want]);
    a0 = p.a; touchMove(5, X - RS * 0.5, Y); step(30);
    check('влево — назад, слабее', angDiff(p.a, a0) < -0.1 && angDiff(p.a, a0) > -0.5, angDiff(p.a, a0));
    a0 = p.a; touchMove(5, X + RS * 0.05, Y); step(30);
    check('у центра — не поворачивает', Math.abs(angDiff(p.a, a0)) < 1e-6);
    a0 = p.a; touchMove(5, X, Y - RS * (TOUCH.fireAt + 0.2)); step(2);
    check('вверх за кольцо — огонь без поворота', mouse.l && Math.abs(angDiff(p.a, a0)) < 1e-6, [mouse.l]);
    touchEnd(5); step(2);
    const s2 = worldToScreen(p.x, p.y);
    check('боец всё там же на экране', Math.abs(s2.x - VW / 2) < 1 && Math.abs(s2.y - VH * (1 - CAM.bottom)) < 1);
    check('прицел — на линии взгляда над бойцом', Math.abs(mouse.x - VW / 2) < 1 && mouse.y < s2.y, [mouse.x, mouse.y]);
    const x0 = p.x, y0 = p.y, a1 = p.a;
    touchStart(6, 200, VH - 150); touchMove(6, 200, VH - 150 - RS * 0.95); step(40); touchEnd(6); step(1);
    check('левый стик вверх — вперёд по взгляду', Math.abs(angDiff(Math.atan2(p.y - y0, p.x - x0), a1)) < 0.06, [Math.atan2(p.y - y0, p.x - x0), a1]);
  });
  run('раненым', () => {
    touchReset(); at(p, 36, 27); setCamMode('look');
    goDown(p, 0); p.bleed = 99; step(2);
    const a0 = p.a;
    touchStart(7, X, Y); touchMove(7, X + RS * 0.9, Y); step(30);
    check('раненый поворачивается правым стиком', angDiff(p.a, a0) > 0.5, angDiff(p.a, a0));
    const s = worldToScreen(p.x, p.y);
    check('камера за ним: внизу посередине', Math.abs(s.x - VW / 2) < 1 && Math.abs(s.y - VH * (1 - CAM.bottom)) < 1, [s.x, s.y]);
    touchEnd(7); step(1);
    const x0 = p.x, y0 = p.y, a1 = p.a;
    touchStart(8, 200, VH - 150); touchMove(8, 200, VH - 150 - RS * 0.95); step(60); touchEnd(8); step(1);
    check('ползёт вперёд по взгляду', Math.hypot(p.x - x0, p.y - y0) > 5 && Math.abs(angDiff(Math.atan2(p.y - y0, p.x - x0), a1)) < 0.1, [p.x - x0, p.y - y0]);
    reviveUp(p); p.hp = 100;
  });
  run('меню ≡', () => {
    openTouchMenu();
    check('камера «по взгляду» отмечена', document.querySelector('#tmuCam-look').classList.contains('on'));
    document.querySelector('#tmuCam-std').click();
    check('кнопка «ОБЫЧНАЯ» переключает', OPTS.cam === 'std' && document.querySelector('#tmuCam-std').classList.contains('on'));
    OPTS.sight = 70; document.querySelector('#tmuSightDn').click();
    check('видимость −: 65 м', sightM() === 65 && document.querySelector('#tmuSight').textContent === '65 м', document.querySelector('#tmuSight').textContent);
    document.querySelector('#tmuSightUp').click();
    check('видимость +: 70 м', sightM() === 70);
    closeTouchMenu();
  });
  return T_.checks;
})();
