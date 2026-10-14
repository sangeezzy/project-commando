// Погода: частоты (ясно чаще всего, туман реже всего), плавная смена, видимость (ИИ и игрок), слышимость (шум), гроза
window.__result = (() => {
  const { check, run, at, dummy } = T_;
  const p = me();
  run('частоты', () => {
    const rnd = makeRng(99), n = {};
    for (let i = 0; i < 20000; i++) { const k = rollWeather(rnd); n[k] = (n[k] || 0) + 1; }
    check('ясно — чаще всего, слабый дождь — второй, сильный и гроза — третьи, туман — реже всего',
      n.clear > n.rain && n.rain > n.heavy && n.rain > n.storm && n.heavy > n.fog && n.storm > n.fog, n);
  });
  run('плавная смена', () => {
    initWeather('clear');
    setWeather('fog');
    updateWeather(1 / 60);
    const v1 = G.weather.vis;
    for (let i = 0; i < 60 * 2; i++) updateWeather(1 / 60);
    const v2 = G.weather.vis;
    for (let i = 0; i < 60 * 20; i++) updateWeather(1 / 60);
    check('видимость меняется постепенно (не скачком) и доходит до тумана', v1 > 0.95 && v2 < v1 && v2 > WEATHER.fog.vis + 0.05 && Math.abs(G.weather.vis - WEATHER.fog.vis) < 0.01,
      [v1, v2, G.weather.vis].map((v) => v.toFixed(2)));
  });
  run('видимость и слышимость', () => {
    const e = G.enemies[0];
    G.enemies.forEach(dummy);
    e._dummy = false;
    // игрок и противник на дороге (y = 27), лицом друг к другу, на расстоянии dx м
    const place = (dx) => { at(p, 20, 27); at(e, 20 + dx, 27); e.a = Math.PI; p.a = 0; p.crouch = false; p.speed = 0; e.st = 0; e.notice = 0; };
    initWeather('clear'); place(30); const c30 = !!perceive(e);
    initWeather('fog'); place(17); const f17 = !!perceive(e); place(30); const f30 = !!perceive(e);
    check('противник: в ясно видит в 30 м; в туман — в 17 м да, в 30 м нет', c30 && f17 && !f30, [c30, f17, f30]);
    initWeather('clear'); place(30); const pc = playerSees(p, e);
    initWeather('fog'); place(30); const pf = playerSees(p, e);
    check('игрок: в 30 м противник виден в ясно и не виден в туман', pc && !pf, [pc, pf]);
    // шум: выстрел (уменьшенный радиус ~37 м) — в ясно долетает до 30 м, в грозу (×0,65) — нет
    const hear = (kind) => { initWeather(kind); place(30); makeNoise(p.x, p.y, M(37), 'shot', p); return e.st; };
    const hc = hear('clear'), hs = hear('storm');
    check('гроза глушит: выстрел, слышный в ясно, в грозу не долетает', hc === 2 && hs === 0, [hc, hs]);
    G.weather = null;
  });
  run('гроза', () => {
    initWeather('storm');
    const b0 = G.weather.bolt;
    for (let i = 0; i < 60 * 70; i++) { updateWeather(1 / 60); weatherFx(1 / 60); }
    check('молнии в грозу — раз в 12–30 с', G.weather.bolt - b0 >= 2 && G.weather.bolt - b0 <= 6, G.weather.bolt - b0);
    G.weather.flash = 1;
    G.cam.x = p.x; G.cam.y = p.y; render(1 / 60);
    check('кадр с дождём и вспышкой рисуется без ошибок', true);
    G.weather = null;
  });
  return T_.checks;
})();
