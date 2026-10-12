// Видимость и туман: в светлых зонах ограничивают только стены, в тёмных — радиус и стены.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  const c = (tx, ty) => [tx * TILE + 16, ty * TILE + 16];
  try {
    // visibility() врага и альфа тумана в его пикселе (0 — открыто, ~230 — темно)
    const probe = (cls, ptile, etile) => {
      G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, cls)]; startLevel(1);
      const p = me();
      [p.x, p.y] = c(...ptile); p.rx = p.x; p.ry = p.y; p.a = Math.PI / 2;
      const [ex, ey] = c(...etile);
      const vis = visibility(ex, ey, fogViewers());
      const offX = Math.round(VW / 2 - p.x), offY = Math.round(VH / 2 - p.y);
      drawFog(offX, offY, fogViewers());
      const fog = fogX.getImageData(ex + offX, ey + offY, 1, 1).data[3];
      return { vis: +vis.toFixed(2), fog };
    };
    let r;
    r = probe('smuggler', [1, 4], [21, 4]);  check('свет: 640px по прямой — видно', r.vis === 1 && r.fog < 30, r);
    r = probe('smuggler', [1, 2], [9, 2]);   check('свет: за стеной рядом — не видно', r.vis === 0 && r.fog > 150, r);
    r = probe('smuggler', [1, 1], [6, 5]);   check('свет: другой конец комнаты — видно', r.vis === 1, r);
    r = probe('smuggler', [3, 8], [6, 9]);   check('тьма: ~100px — видно', r.vis === 1, r);
    r = probe('smuggler', [3, 8], [9, 13]);  check('тьма: ~250px — не видно', r.vis === 0, r);
    r = probe('smuggler', [3, 8], [3, 3]);   check('из тьмы в светлый проём по прямой — видно', r.vis === 1, r);
    // нижняя средняя тёмная комната: враг за стеной в 128px (баг из-за радиуса без учёта стен)
    r = probe('smuggler', [10, 9], [10, 13]); check('тьма за стеной, 128px — не видно', r.vis === 0 && r.fog > 150, r);
    r = probe('jedi', [10, 9], [10, 13]);     check('тьма за стеной, меч горит — не видно', r.vis === 0 && r.fog > 150, r);
    r = probe('smuggler', [8, 12], [10, 13]); check('внутри тёмной комнаты, 72px — видно', r.vis === 1 && r.fog < 30, r);

    // производительность тумана (для информации, порог щедрый)
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) render(1 / 60);
    const ms = +((performance.now() - t0) / 30).toFixed(1);
    check('кадр рендера < 25 мс', ms < 25, ms + ' мс');
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
