// Настройки игрока (OPTS, меню ≡ на телефоне): аим ассист мягкий / жёсткий, ограничение 60 к/с (frameDue), упрощённый свет
// (gainPass вместо фильтра, буфер грубее, без засветки; пелена погоды — в маленький буфер).
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
  const pool = G.enemies.slice();
  G.enemies = [];
  const RS = touchR() * TOUCH.stickK;
  const opts0 = { ...OPTS };

  check('телефон: ограничение 60 к/с включено по умолчанию', OPTS.fps60 === true);
  check('по умолчанию: свет полный, ассист мягкий', OPTS.simpleLight === false && OPTS.assist === 'soft');

  run('меню: галочки и режим ассиста', () => {
    openTouchMenu();
    const fps = document.getElementById('tmuFps'), light = document.getElementById('tmuLight');
    check('галочки показывают текущие настройки', fps.checked === OPTS.fps60 && light.checked === OPTS.simpleLight);
    light.click(); fps.click();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('pcr-opts') || '{}'); } catch (e) { /* ignore */ }
    check('галочки меняют настройки и запоминаются', OPTS.simpleLight === true && OPTS.fps60 === false && saved.simpleLight === true && saved.fps60 === false, saved);
    document.getElementById('tmuAssist-hard').click();
    check('«ЖЁСТКИЙ» — режим ассиста жёсткий, кнопка подсвечена', OPTS.assist === 'hard' && document.getElementById('tmuAssist-hard').classList.contains('on') &&
      !document.getElementById('tmuAssist-soft').classList.contains('on'));
    document.getElementById('tmuAssist-soft').click();
    check('«МЯГКИЙ» — обратно', OPTS.assist === 'soft');
    closeTouchMenu();
    Object.assign(OPTS, opts0);
    try { localStorage.removeItem('pcr-opts'); } catch (e) { /* ignore */ }
  });

  run('аим ассист: мягкий и жёсткий', () => {
    touchReset();
    at(p, 36, 45); p.dead = p.down = false; G.state = 'play';
    const e = pool[0];
    G.enemies = [e];
    Object.assign(e, { dead: false, down: false, hp: 1e9, lean: 0, va: 1 });
    G.noFog = true;
    const d = M(12);
    const put = (a) => { e.x = e.px = p.x + Math.cos(a) * d; e.y = e.py = p.y + Math.sin(a) * d; };
    let tgt = 0;
    const aim = () => { touchStart(2, VW - 400, VH - 150); touchMove(2, VW - 400 + RS * 0.6, VH - 150); step(2); const a = p.a; tgt = Math.atan2(e.y - p.y, e.x - p.x); touchEnd(2); step(1); return a; };
    OPTS.assist = 'soft';
    put(0.04); const s1 = aim();
    put(0.15); const s2 = aim();
    OPTS.assist = 'hard';
    put(0.04); const h1 = aim(), t1 = tgt;
    put(0.15); const h2 = aim();
    put(0.5); const h3 = aim();
    check('мягкий: близко к линии — подтягивает не до конца', s1 > 0.01 && s1 < 0.035, s1.toFixed(3));
    check('мягкий: 1,8 м вбок — уже нет', Math.abs(s2) < 1e-6, s2.toFixed(4));
    check('жёсткий: близко к линии — взгляд ровно на цели', Math.abs(h1 - t1) < 2e-3, [h1.toFixed(4), t1.toFixed(4)]);
    check('жёсткий: 1,8 м вбок — ещё тянет', h2 > 0.02, h2.toFixed(3));
    check('жёсткий: далеко от линии — нет', Math.abs(h3) < 1e-6, h3.toFixed(4));
    OPTS.assist = 'soft'; G.noFog = false; G.enemies = [];
  });

  run('ограничение 60 к/с', () => {
    const count = (hz, on) => {
      OPTS.fps60 = on; nextFrame = 0;
      let n = 0;
      for (let i = 0; i < hz * 2; i++) if (frameDue(1000 + i * 1000 / hz)) n++;
      return n / 2;
    };
    const r = { 60: count(60, true), 90: count(90, true), 120: count(120, true), 144: count(144, true), off120: count(120, false) };
    check('60 Гц — все 60 кадров', r[60] >= 59 && r[60] <= 61, r);
    check('90 Гц — 60 (не 45)', r[90] >= 58 && r[90] <= 61, r);
    check('120 Гц — 60', r[120] >= 59 && r[120] <= 61, r);
    check('144 Гц — около 60', r[144] >= 55 && r[144] <= 62, r);
    check('выключено — все 120', r.off120 === 120, r);
    OPTS.fps60 = opts0.fps60; nextFrame = 0;
  });

  run('упрощённый свет', () => {
    // усиление сложением копий = фильтр brightness (до насыщения)
    const w = 64, h = 16;
    lightC.width = w; lightC.height = h;
    const gx = lightX;
    gx.setTransform(1, 0, 0, 1, 0, 0); gx.globalCompositeOperation = 'source-over'; gx.globalAlpha = 1; gx.filter = 'none';
    for (let x = 0; x < w; x++) { const v = Math.round(x * 2); gx.fillStyle = `rgb(${v},${v},${v})`; gx.fillRect(x, 0, 1, h); }
    let worst = 0;
    for (const gain of [1.6, 3.3, 7.2]) {
      const a = lightPass(0, w, h, `brightness(${gain})`).getContext('2d').getImageData(0, 8, w, 1).data.slice();
      const b = gainPass(w, h, gain).getContext('2d').getImageData(0, 8, w, 1).data;
      for (let i = 0; i < w * 4; i += 4) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    }
    check('усиление без фильтра совпадает с фильтром (±6 из 255)', worst <= 6, worst);
    // кадр целиком: тёмное место (усиление > 1), погода с пеленой и дождём — без ошибок
    at(p, 36, 45); G.cam.x = p.x; G.cam.y = p.y;
    G.weather = null;
    initWeather('storm'); Object.assign(G.weather, { vis: 0.5, fog: 0.3, rain: 1 });
    for (const simple of [false, true]) {
      OPTS.simpleLight = simple;
      for (let i = 0; i < 3; i++) render(1 / 60);
    }
    check('кадр с упрощённым светом и погодой — без ошибок', lightC.width === Math.ceil(VW / LQ_SIMPLE), [lightC.width, VW]);
    OPTS.simpleLight = false; G.weather = null;
    render(1 / 60);
    check('обычный свет — буфер прежний', lightC.width === Math.ceil(VW / LQ));
  });
  return T_.checks;
})();
