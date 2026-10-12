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
  return T_.checks;
})();
