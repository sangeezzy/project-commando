// Меч: F гасит/зажигает, ЛКМ зажигает погашенный, удар только с выдвинутым клинком,
// свет и раскрытие тумана исчезают, зажигание шумит.
window.__result = (() => {
  const checks = [];
  const check = (name, ok, got) => checks.push({ name, ok: !!ok, got });
  try {
    initAudio();
    G.role = 'solo'; G.myIdx = 0; G.players = [makePlayer(0, 'jedi')]; startLevel(1);
    const p = me();
    const step = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; update(1 / 60); } };
    for (const e of G.enemies) e.dead = true;
    step(5);
    check('на старте меч горит и светит', p.saberOn && p.saberLen === 1 && !!saberLight(p), { on: p.saberOn, len: p.saberLen });
    const eyes = fogViewers().length;

    saberKeyPressed = true; step(20);
    check('F гасит меч: клинок убран, света нет', !p.saberOn && p.saberLen === 0 && !saberLight(p), { on: p.saberOn, len: p.saberLen });
    check('погашенный меч не раздвигает туман', fogViewers().length === eyes - 1, fogViewers().length);

    mouse.l = true; step(1); mouse.l = false;
    check('ЛКМ при погашенном — зажигает без удара', p.saberOn && p.swing === 0, { on: p.saberOn, swing: p.swing });
    step(3);
    mouse.l = true; step(1); mouse.l = false;
    check('пока клинок выдвигается — удара нет', p.swing === 0, { swing: p.swing, len: +p.saberLen.toFixed(2) });
    step(20);
    mouse.l = true; step(1); mouse.l = false;
    check('с выдвинутым клинком — удар', p.swing > 0, p.swing);

    startLevel(1);
    const e = G.enemies[0];
    for (const o of G.enemies) if (o !== e) o.dead = true;
    p.saberOn = false; p.saberLen = 0;
    // клетка в 2 шагах от врага по пути (звук зажигания ~4 клетки)
    const f = bfsFrom(e.x, e.y).f;
    const i = f.findIndex((d) => d === 2);
    p.x = (i % map.w) * TILE + 16; p.y = Math.floor(i / map.w) * TILE + 16;
    toggleSaber(p);
    check('зажигание рядом настораживает врага', e.st >= 1, e.st);
  } catch (err) { check('без исключений', false, String(err) + ' ' + err.stack); }
  return checks;
})();
