// Колёсико мыши (масштаб камеры) и отладочные клавиши: [ — бессмертие, ] — без тумана войны (только у нажавшего)
window.__result = (() => {
  const { check, step, at, run, dummy } = T_;
  const p = me();
  const wheel = (dy) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, cancelable: true }));
  const press = (code) => { pressed[code] = true; step(1); };

  run('колёсико', () => {
    const v0 = G.viewT, z0 = G.zoom;
    wheel(100);
    check('вниз — камера отдаляется (видно больше метров)', G.viewT > v0, [v0, G.viewT]);
    step(60);
    check('масштаб меняется плавно и доходит до цели', G.zoom < z0 && Math.abs(G.view - G.viewT) < 0.05, [z0, G.zoom, G.view, G.viewT]);
    for (let i = 0; i < 40; i++) wheel(-100);
    check(`вверх — приближается, не ближе ${CAM.viewMin} м`, G.viewT === CAM.viewMin, G.viewT);
    for (let i = 0; i < 40; i++) wheel(100);
    check(`вниз — не дальше ${CAM.viewMax} м`, G.viewT === CAM.viewMax, G.viewT);
    check('масштаб запоминается в браузере', +localStorage.getItem('pcr-view') === CAM.viewMax, localStorage.getItem('pcr-view'));
    G.viewT = VIEW_M; step(90);
    check('вернулся к обычному', Math.abs(G.view - VIEW_M) < 0.05, G.view);
  });

  run('бессмертие ([)', () => {
    G.enemies.forEach(dummy);
    at(p, 36, 27);
    press('BracketLeft');
    check('[ включает бессмертие своему бойцу', p.god === true);
    damagePerson(p, 500, p.x + 100, p.y, 0, null);
    check('урон не проходит совсем', p.hp === HP && !p.down && !p.dead, [p.hp, p.down]);
    press('BracketLeft');
    check('[ ещё раз — выключено', !p.god);
    goDown(p, 0);
    press('BracketLeft');
    check('включил раненым — сразу на ногах, здоровье полное', p.god && !p.down && p.hp === HP, [p.god, p.down, p.hp]);
    press('BracketLeft');
    damagePerson(p, 30, p.x + 100, p.y, 0, null);
    check('выключил — урон снова проходит', p.hp < HP, p.hp);
    goDown(p, 0); p.god = true; p.bleed = 0.5;
    step(120);
    check('бессмертный раненый не истекает кровью', !p.dead && p.down, [p.dead, p.bleed]);
    reviveUp(p); p.god = false; p.hp = HP;
  });

  run('без тумана войны (])', () => {
    const e = G.enemies[0];
    at(p, 14, 27); p.a = Math.PI; at(e, 6, 27); e.a = 0;       // между ними кирпичная стена
    G.cam.x = p.x; G.cam.y = p.y;
    let fog = 0;
    const f0 = window.drawFog;
    window.drawFog = (...a) => { fog++; return f0(...a); };
    for (let i = 0; i < 10; i++) render(1 / 60);
    check('обычно: противник за стеной не виден, туман рисуется', !playerSees(p, e) && e.va < 0.05 && fog === 10, [e.va, fog]);
    press('BracketRight');
    fog = 0;
    G.cam.x = p.x; G.cam.y = p.y;
    for (let i = 0; i < 10; i++) render(1 / 60);
    check('] — противник за стеной виден, тумана нет', G.noFog && e.va > 0.9 && fog === 0, [G.noFog, e.va, fog]);
    press('BracketRight');
    check('] ещё раз — туман снова', !G.noFog);
    window.drawFog = f0;
  });
  return T_.checks;
})();
