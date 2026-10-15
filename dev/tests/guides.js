// Стрелки на переход (зелёная) и грузовик (синяя): горят 10 с после события и по Tab, на экране цели — нет; реплики на огонь по своим;
// покачивание оружия на бегу; двигатель с повреждением слабее и «чихает»; звуки игры (дождь, мотор) в меню молчат;
// мышь: камера по взгляду поворачивается только от захваченной мыши, в машине захваченная мышь двигает курсор.
window.__result = (() => {
  const { check, step, tick, at, run } = T_;
  const squad = [{ slot: 0, human: true, name: 'Тест' }];

  run('стрелка на переход «Штурма»', () => {
    G.assaultCarry = null;
    startMap('assault', assaultSeed(4321, 1), squad, false);
    const p = me(); p.god = true;
    step(1);
    let g = guideTargets();
    check('локация началась — стрелка на переход горит', g.some((q) => q.label === 'ПЕРЕХОД'), g.map((q) => q.label));
    G.time += GUIDE.t + 0.1;
    check('через 10 с — гаснет', !guideTargets().some((q) => q.label === 'ПЕРЕХОД'));
    pressed.Tab = true; step(1);
    check('Tab — снова горит', guideTargets().some((q) => q.label === 'ПЕРЕХОД'));
    let err = null; try { render(1 / 60); } catch (e) { err = String(e); }
    check('рисуется без ошибок', !err, err);
    G.time += GUIDE.t + 0.1;
    G.enemies.forEach((e) => { e.dead = true; }); tick(2);
    check('ворота открылись — снова горит', map.gate.open && guideTargets().some((q) => q.label === 'ПЕРЕХОД'));
    // цель на экране — стрелки нет (drawGuides пропускает): проверка — угол зоны на экране
    const ex = map.exit; G.cam.x = (ex.x0 + 2) * TILE; G.cam.y = (ex.y0 + 1) * TILE; render(1 / 60);
    const s = worldToScreen((ex.x0 + 1) * TILE, (ex.y0 + 1) * TILE);
    check('камера на переходе — зона на экране (стрелка не рисуется)', s.x > 0 && s.x < VW && s.y > 0 && s.y < VH);
  });

  run('стрелка на грузовик', () => {
    G.assaultCarry = null;
    startMap('assault', assaultSeed(4321, 3), squad, false);
    const p = me(); p.god = true;
    G.enemies.forEach((e) => { e.dead = true; }); tick(2);
    check('грузовик едет — стрелки нет', !guideTargets().some((q) => q.label === 'ГРУЗОВИК'));
    tick(60 * (SURV.drive + 0.5));
    const g = guideTargets();
    check('встал — синяя стрелка горит', truckParked() && g.some((q) => q.label === 'ГРУЗОВИК' && q.col[2] > q.col[0]), g.map((q) => q.label));
    G.time += GUIDE.t + 0.1;
    check('через 10 с — гаснет', !guideTargets().some((q) => q.label === 'ГРУЗОВИК'));
    guideShow();
    check('Tab (guideShow) — снова горит', guideTargets().some((q) => q.label === 'ГРУЗОВИК'));
  });

  run('огонь по своим — реплики', () => {
    startRange();
    const e = G.enemies[0], e2 = G.enemies[1];
    G.barks = [];
    Object.assign(e, { dead: false, down: false, hp: 1000, ffBarkT: -99 }); Object.assign(e2, { dead: false, ffBarkT: -99 });
    at(e, 30, 30); at(e2, 32, 30);
    damagePerson(e, 5, e2.x, e2.y, 0, e2);
    const texts = (G.barks || []).map((b) => b.text);
    check('попавший под огонь своего — возмущается', texts.some((t) => FF_HIT_LINES.includes(t)), texts);
    check('стрелявший — извиняется', texts.some((t) => FF_SORRY_LINES.includes(t)), texts);
    G.barks = [];
    damagePerson(e, 5, e2.x, e2.y, 0, e2);
    check('не чаще раза в 3 с', !(G.barks || []).length);
    G.barks = []; e.ffBarkT = -99;
    damagePerson(e, 5, me().x, me().y, 0, me());
    check('от чужого (игрока) — без реплик про своих', !(G.barks || []).some((b) => FF_HIT_LINES.includes(b.text)));
  });

  run('покачивание оружия в такт шагам', () => {
    startRange();
    const p = me(); at(p, 36, 27); p.a = 0;
    updateAnim(p, 1 / 60);
    keys.ShiftLeft = true; keys.KeyD = true;
    const ph0 = p.an.ph || 0;
    step(40);
    keys.ShiftLeft = false; keys.KeyD = false;
    check('бег — фаза шагов идёт, скорость в анимации', p.an.ph !== ph0 && p.an.mv > 0.5, [p.an.ph, p.an.mv]);
    step(60);
    check('стоит — покачивание затихает', p.an.mv < 0.05, p.an.mv);
    let err = null; try { render(1 / 60); } catch (e) { err = String(e); }
    check('кадр без ошибок', !err, err);
  });

  run('повреждённый двигатель', () => {
    startMap('race', 0, squad, false);
    const p = me(), c = map.cars[0];
    unparkCar(c);
    const V = VEHICLES[c.model];
    c.hp = V.engineHp;
    check('целый — полная мощность', engineK(c) === 1);
    c.hp = V.engineHp * 0.5;
    const k5 = engineK(c);
    check('половина — слабее, но едет', k5 < 0.9 && k5 > ENGINE_DMG.min, k5.toFixed(2));
    c.hp = V.engineHp * 0.1; c.misNext = 0; c.misEnd = 0;
    let mis = 0, n = 0;
    for (let i = 0; i < 600; i++) { G.time += 1 / 60; engineK(c); if (engineMisfire(c)) mis++; n++; }
    check('сильно повреждён — «чихает» (провалы тяги)', mis > 10 && mis < n * 0.7, [mis, n]);
    // разгон: целая против повреждённой (одна и та же машина с места на 4 с)
    const accel = (hp) => {
      Object.assign(c, { hp, x: c.x0 ?? (c.x0 = c.x), y: c.y0 ?? (c.y0 = c.y), a: c.a0 ?? (c.a0 = c.a), vx: 0, vy: 0, w: 0, steer: 0, misNext: 0, misEnd: 0 });
      enterCar(p, c, 0); c.ctrl = { thr: 1, steer: 0, hb: 0 };
      for (let i = 0; i < 60 * 4; i++) { G.time += 1 / 60; stepCar(c, 1 / 60); }
      exitCar(p, true);
      return carSpeed(c) / PX_M;
    };
    const vFull = accel(V.engineHp), vHurt = accel(V.engineHp * 0.2);
    check('повреждённый разгоняется заметно хуже', vHurt < vFull * 0.8, [vFull.toFixed(1), vHurt.toFixed(1)]);
  });

  run('звуки игры в меню молчат; мышь', () => {
    initAudio();
    startRange();
    G.weather = { kind: 'storm', vis: 0.6, hear: 0.8, rain: 1, fog: 0, bolt: 0, flash: 0, thunder: [] };
    step(5);
    let err = null;
    try { G.state = 'menu'; window.__testStep && window.__testStep(); rainSoundOff(); engineSoundOff(); } catch (e) { err = String(e); }
    check('глушение дождя и мотора — без ошибок', !err, err);
    G.state = 'play';
    // камера по взгляду: без захвата мыши движение не поворачивает (в тестах захват считается включённым — проверяем ветку машины)
    const p = me(); OPTS.cam = 'look';
    const c = map.cars[0]; enterCar(p, c, 0);
    check('в машине камера по взгляду выключена', !lookCam(p));
    mouse.x = 200; mouse.y = 200;
    const lockEl = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 50, movementY: -20, clientX: 5, clientY: 5 }));
    check('мышь захвачена, а камера обычная (машина) — курсор двигается по смещению', mouse.x === 250 && mouse.y === 180, [mouse.x, mouse.y]);
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX: 900, movementY: 0, clientX: 5, clientY: 5 }));
    check('одиночный скачок (> 400 px) — отброшен', mouse.x === 250, mouse.x);
    delete document.pointerLockElement;
    if (lockEl) Object.defineProperty(Document.prototype, 'pointerLockElement', lockEl);
    exitCar(p, true); OPTS.cam = 'std';
  });
  return T_.checks;
})();
