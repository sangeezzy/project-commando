// Оптимизации отрисовки не меняют картинку: свет умножается только там, где не полный день (darkScreenRect), — кадр совпадает
// с умножением на весь экран; карта кусками (drawMapView) — без швов; пелена погоды в буфере 1/4 — почти как во весь экран.
window.__result = (() => {
  const { check, run, at } = T_;
  const shot = () => { render(1 / 60); return ctx.getImageData(0, 0, VW, VH).data.slice(); };
  const diff = (a, b) => { let m = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d > m) m = d; if (d > 3) n++; } return { max: m, n }; };
  const full = darkScreenRect;

  run('свет: только затемнённая часть — кадр тот же', () => {
    startRange();
    G.noFog = true; G.shake = 0; G.weather = null;
    const p = me();
    for (const [tx, ty, name] of [[36, 46, 'улица'], [20, 14, 'у здания с полумраком']]) {
      at(p, tx, ty); G.cam.x = p.x; G.cam.y = p.y; G.expo = { gain: 1 };
      for (let i = 0; i < 30; i++) render(1 / 60);                 // прогрев: плавные проявления (противники, значки) — до конца
      G.time = 100; Math.random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      const a = shot();
      window.darkScreenRect = (cm, q, w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });     // как раньше: на весь экран
      G.time = 100; Math.random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      const b = shot();
      window.darkScreenRect = full;
      const d = diff(a, b);
      check(`${name}: совпадает с умножением на весь экран`, d.max <= 2, d);
    }
  });

  run('засветка: только где возможна (brightScreenRect) — кадр тот же', () => {
    startRange();
    G.noFog = true; G.shake = 0; G.weather = null;
    const p = me(), bright = brightScreenRect;
    for (const [tx, ty, gain, lamp, name] of [[20, 14, 3, false, 'полумрак, глаз привык (×3)'], [20, 14, 6, true, 'темно, свой фонарь (×6)'], [36, 46, 2, false, 'улица, ×2']]) {
      at(p, tx, ty); G.cam.x = p.x; G.cam.y = p.y; p.lamp = lamp;
      for (let i = 0; i < 30; i++) { G.expo = { gain }; render(1 / 60); }
      const rnd = () => { G.time = 100; G.expo = { gain }; Math.random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(); };
      rnd(); const a = shot();
      window.brightScreenRect = (cm, q, w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });     // как раньше: на весь экран
      rnd(); const b = shot();
      window.brightScreenRect = bright;
      const d = diff(a, b);
      check(`${name}: совпадает с засветкой на весь экран`, d.max <= 2, d);
    }
    p.lamp = false;
  });

  run('карта кусками', () => {
    startMap('race', 0, [{ slot: 0, human: true, name: 'Т' }], false);
    G.noFog = true; render(1 / 60);
    check('автодром: кусков в памяти не больше предела', map.chunks.size <= MAP_CHUNK_KEEP && map.chunks.size > 0, map.chunks.size);
    check('нет одной огромной картинки карты', !(map.canvas instanceof HTMLCanvasElement));
    for (let i = 0; i < 40; i++) { G.cam.x = (10 + i * 4.5) * TILE; G.cam.y = (10 + (i % 5) * 25) * TILE; render(1 / 60); }
    check('прокатил камеру по всей карте — в памяти по-прежнему не больше предела', map.chunks.size <= MAP_CHUNK_KEEP, map.chunks.size);
  });
  return T_.checks;
})();
