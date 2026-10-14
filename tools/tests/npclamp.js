// Фонари противников: включены (ENEMY.lamps); в темноте горят,
// светят по направлению взгляда, помогают разглядеть цель, гаснут, когда противник прячется.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const e = G.enemies[0];
  G.enemies = [e];
  const sim = (n) => { for (let i = 0; i < n; i++) { G.time += 1 / 60; updateEnemyLamp(e, 1 / 60); } };
  const C = (tx, ty) => [(tx + 0.5) * TILE, (ty + 0.5) * TILE];
  run('включено по умолчанию', () => {
    check('флаг ENEMY.lamps включён', ENEMY.lamps === true);
    at(e, 62, 46); e.a = Math.PI; e.crouch = false; e.lamp = false;
    sim(120);
    check('в тёмном гараже противник включает фонарь', e.lamp);
    // днём у противников на улице фонари не горят
    G.enemies = [e]; at(e, 36, 20); e.a = 0; e.lamp = false;
    at(p, 6, 27);
    for (let i = 0; i < 60; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('на улице днём фонарь не горит', !e.lamp);
    // механику можно выключить флагом
    ENEMY.lamps = false; at(e, 62, 46); e.a = Math.PI; sim(120);
    check('при ENEMY.lamps = false не включается', !e.lamp);
  });
  run('включено', () => {
    ENEMY.lamps = true;
    at(e, 62, 46); e.a = Math.PI; e.crouch = false; e.lamp = false;
    sim(3);
    check('включает не мгновенно', !e.lamp);
    sim(60);
    check('в тёмном гараже фонарь горит', e.lamp);
    at(e, 36, 22); e.a = 0;
    sim(60);
    check('на улице выключает', !e.lamp);
    at(e, 34, 40); e.a = Math.PI / 2;     // в дверях сарая, смотрит внутрь, в темноту
    sim(60);
    check('смотрит в тёмное помещение — включает', e.lamp);
    at(e, 62, 46); e.a = Math.PI; sim(60);
    const ahead = lightAt(...C(59, 46)), behind = lightAt(...C(65, 46));
    check('светит туда, куда смотрит', ahead > ambientAt(...C(59, 46)) + 0.3 && behind - ambientAt(...C(65, 46)) < 0.05, [ahead.toFixed(2), behind.toFixed(2)]);
    // цель в луче видна, без фонаря — нет (оба в глухой части гаража)
    const t = makePerson('p', 0, 0);
    at(t, 61, 44); at(e, 64, 46); e.a = Math.atan2(t.y - e.y, t.x - e.x);
    const lit = seenBrightness(e, t);
    e.lamp = false;
    const dark = seenBrightness(e, t);
    check('с фонарём цель в темноте видно лучше', lit > dark * 2 && lit > LIGHT.seeMin, [lit.toFixed(2), dark.toFixed(2)]);
    e.lamp = true;
    e.crouch = true; sim(1);
    check('присел за укрытием — сразу гасит фонарь', !e.lamp);
    e.crouch = false; e.hp = 0; e.dead = true;
    check('у убитого фонарь не светит', !lampOn(e));
    e.dead = false; e.hp = 100;
    // фонарь в лицо игроку ослепляет: глаз подстраивается под свет, темнота вокруг пропадает
    at(p, 60, 46); p.a = 0; p.lamp = false; at(e, 64, 46); e.a = Math.PI;
    e.lamp = false;
    G.expo = null; for (let i = 0; i < 300; i++) updateExposure(p, 1 / 60);
    const gDark = G.expo.gain;
    e.lamp = true;
    for (let i = 0; i < 120; i++) updateExposure(p, 1 / 60);
    check('фонарь противника в лицо ослепляет (усиление глаза падает)', G.expo.gain < gDark * 0.5, [G.expo.gain.toFixed(2), gDark.toFixed(2)]);
    G.cam.x = p.x; G.cam.y = p.y;
    render(1 / 60);
    check('кадр с фонарём противника рисуется', true);
    ENEMY.lamps = true;
  });
  run('луч за стеной (в тумане войны) не виден', () => {
    ENEMY.lamps = true;
    G.enemies = [e];
    at(e, 62, 46); e.a = Math.PI; e.crouch = false; e.dead = false;
    const spot = { x: (59 + 0.5) * TILE, y: (46 + 0.5) * TILE };      // сюда светит
    // свет в буфере на месте луча (игрок в p): фонарь горит минус не горит
    const lit = (on) => {
      e.lamp = on; G.shake = 0; G.noFog = false; G.cam.x = p.x; G.cam.y = p.y;
      render(1 / 60);
      const z = G.zoom, offX = Math.round(VW / 2 - G.cam.x * z), offY = Math.round(VH / 2 - G.cam.y * z);
      const bx = Math.floor((spot.x * z + offX) / LQ), by = Math.floor((spot.y * z + offY) / LQ);
      return lightX.getImageData(bx, by, 1, 1).data[0];
    };
    const diff = () => lit(true) - lit(false);
    // место, откуда луча не видно (стена между), но он на экране — ищем рядом
    let hidden = null;
    for (let r = 4; r < 13 && !hidden; r++) for (let dy = -r; dy <= r && !hidden; dy++) for (let dx = -r; dx <= r && !hidden; dx++) {
      const tx = 59 + dx, ty = 46 + dy;
      if (!walkable(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (!los(cx, cy, spot.x, spot.y) && !los(cx, cy, e.x, e.y)) hidden = [tx, ty];
    }
    check('нашлось место за стеной от луча', !!hidden, hidden);
    if (!hidden) return;
    at(p, ...hidden); p.a = Math.atan2(spot.y - p.y, spot.x - p.x); p.crouch = false; p.leanPx = 0; p.lean = 0;
    const dHidden = diff();
    at(p, 57, 46); p.a = 0;
    const dSeen = diff();
    check('из-за стены луча нет (в буфере света), на виду — есть', dHidden <= 2 && dSeen > 20, [dHidden, dSeen, hidden]);
    G.noFog = true;
    at(p, ...hidden);
    const dDebug = (() => { e.lamp = true; G.cam.x = p.x; G.cam.y = p.y; render(1 / 60);
      const z = G.zoom, offX = Math.round(VW / 2 - G.cam.x * z), offY = Math.round(VH / 2 - G.cam.y * z);
      const a = lightX.getImageData(Math.floor((spot.x * z + offX) / LQ), Math.floor((spot.y * z + offY) / LQ), 1, 1).data[0];
      e.lamp = false; render(1 / 60);
      const b = lightX.getImageData(Math.floor((spot.x * z + offX) / LQ), Math.floor((spot.y * z + offY) / LQ), 1, 1).data[0];
      return a - b; })();
    G.noFog = false;
    check('отладка ] (без тумана) — луч виден и за стеной', dDebug > 20, dDebug);
    // вспышка выстрела там же (в гараже): свет вокруг неё в буфере и язык пламени поверх
    e.lamp = false;
    const flash = (on) => {
      G.muzzle = on ? [{ x: spot.x, y: spot.y, a: Math.PI, t: 0.05 }] : [];
      G.shake = 0; G.cam.x = p.x; G.cam.y = p.y;
      render(1 / 60);
      const z = G.zoom, offX = Math.round(VW / 2 - G.cam.x * z), offY = Math.round(VH / 2 - G.cam.y * z);
      const buf = lightX.getImageData(Math.floor((spot.x * z + offX) / LQ), Math.floor((spot.y * z + offY) / LQ), 1, 1).data[0];
      const scr = ctx.getImageData(Math.round(spot.x * z + offX + 2 * z), Math.round(spot.y * z + offY), 1, 1).data;
      return [buf, scr[0] + scr[1] + scr[2]];
    };
    const fd = () => { const a = flash(true), b = flash(false); return [a[0] - b[0], a[1] - b[1]]; };
    at(p, ...hidden);
    const fHidden = fd();
    at(p, 57, 46); p.a = 0;
    const fSeen = fd();
    G.muzzle = [];
    check('вспышка из-за стены не видна (ни свет, ни пламя), на виду — видна', fHidden[0] <= 2 && Math.abs(fHidden[1]) <= 6 && fSeen[0] > 20 && fSeen[1] > 60,
      [fHidden, fSeen]);
  });
  return T_.checks;
})();
