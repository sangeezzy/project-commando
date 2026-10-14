// Освещение: тёмные помещения, свет из дверей, рассеянный фонарь, автоэкспозиция, зрение противников в темноте.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  G.enemies = [];
  const C = (tx, ty) => [(tx + 0.5) * TILE, (ty + 0.5) * TILE];
  const amb = (tx, ty) => ambientAt(...C(tx, ty));
  run('карта освещённости', () => {
    check('на улице день (1)', Math.abs(amb(36, 27) - 1) < 0.01, amb(36, 27));
    check('в глубине бетонного сарая темно (< 0,1)', amb(31, 44) < 0.1, amb(31, 44).toFixed(3));
    check('в глухой части гаража почти ничего (< 0,06)', amb(62, 44) < 0.06, amb(62, 44).toFixed(3));
    check('в комнате с окнами полумрак (0,2–0,5)', amb(8, 12) > 0.2 && amb(8, 12) < 0.5, amb(8, 12).toFixed(3));
    check('у двери внутрь затекает свет', amb(34, 41) > 0.4, amb(34, 41).toFixed(3));
    check('свет из двери гаснет вглубь', amb(34, 41) > amb(34, 42) && amb(34, 42) > amb(34, 43), [amb(34, 41), amb(34, 42), amb(34, 43)].map((v) => v.toFixed(2)));
    check('стена не пропускает уличный свет внутрь', amb(30, 41) < 0.2, amb(30, 41).toFixed(3));
  });
  run('фонарь', () => {
    at(p, 31, 44); p.a = 0; p.lamp = true;
    const ahead = lightAt(...C(35, 44));
    check('фонарь освещает тёмный сарай впереди (4 м)', ahead > 0.35, ahead.toFixed(2));
    const k = (off) => lampK(p, p.x + Math.cos(off) * M(4), p.y + Math.sin(off) * M(4));
    const v = [0, 0.2, 0.4, 0.6, 0.75, 0.9].map(k);
    check('конус плавно гаснет к краям', v[0] >= v[1] && v[1] > v[2] && v[2] > v[3] && v[3] > v[4] && v[4] > 0, v.map((x) => x.toFixed(3)));
    check('рассеянный: на 23° от оси ещё 25–75% яркости', v[2] / v[0] > 0.25 && v[2] / v[0] < 0.75, (v[2] / v[0]).toFixed(2));
    check('за 50° от оси луча нет', v[5] === 0, v[5]);
    // перегородка в кирпичном здании (13, 7..10)
    at(p, 8, 9); p.a = 0;
    check('сквозь стену фонарь не светит', Math.abs(lightAt(...C(15, 9)) - amb(15, 9)) < 1e-6);
    p.lamp = false;
    check('выключенный фонарь не светит', Math.abs(lightAt(...C(11, 9)) - amb(11, 9)) < 1e-6);
  });
  // зайти/выйти: n кадров на месте, взгляд в стену помещения
  function stay(tx, ty, a, n) { at(p, tx, ty); p.a = a; for (let i = 0; i < n; i++) { G.time += 1 / 60; updateExposure(p, 1 / 60); } }
  run('автоэкспозиция', () => {
    p.lamp = false; G.expo = null;
    stay(36, 27, 0, 120);
    check('на улице после привыкания — обычная картинка (усиление 1)', Math.abs(G.expo.gain - 1) < 0.01, G.expo.gain);
    stay(31, 44, Math.PI, 1);
    const enter = perceivedAt(p.x, p.y);
    check('вошёл в тёмный сарай — почти ничего не видно', enter < LIGHT.seeMin, enter.toFixed(3));
    stay(31, 44, Math.PI, 60);
    const mid = perceivedAt(p.x, p.y);
    stay(31, 44, Math.PI, 8 * 60 - 60);
    const adapted = perceivedAt(p.x, p.y);
    check('глаза привыкают постепенно', mid > enter && adapted > mid, [enter, mid, adapted].map((v) => v.toFixed(2)));
    check('через 8 с в темноте видно (≥ 0,3)', adapted >= 0.3, adapted.toFixed(2));
    stay(34, 37, -Math.PI / 2, 1);
    const blown = perceivedAt(p.x, p.y) - 1;
    check('вышел на свет — засветка', blown > 0.8, blown.toFixed(2));
    stay(34, 37, -Math.PI / 2, 60);
    const blown1 = perceivedAt(p.x, p.y) - 1;
    stay(34, 37, -Math.PI / 2, 120);
    const blown3 = perceivedAt(p.x, p.y) - 1;
    check('засветка проходит за ~3 с', blown1 < blown && blown3 < 0.1, [blown1.toFixed(2), blown3.toFixed(2)]);
    // тот же путь, но комната с окнами (0,25): эффект слабее
    stay(36, 27, 0, 300);
    stay(8, 12, Math.PI, 1);
    const enterDim = perceivedAt(p.x, p.y);
    stay(8, 12, Math.PI, 8 * 60);
    const gainDim = G.expo.gain;
    stay(13, 18, Math.PI / 2, 1);
    const blownDim = perceivedAt(p.x, p.y) - 1;
    check('в полумраке сразу видно лучше, чем в темноте', enterDim > enter * 2, [enterDim.toFixed(2), enter.toFixed(2)]);
    check('чем темнее было, тем сильнее засветка на выходе', blownDim < blown && blownDim > 0, [blownDim.toFixed(2), blown.toFixed(2)]);
    check('к полумраку глаз подстраивается слабее, чем к темноте', gainDim < LIGHT.maxGain, gainDim.toFixed(2));
  });
  run('засветка улицы из тёмного помещения', () => {
    G.expo = null; p.lamp = false;
    // худший случай: глаза полностью привыкли к темноте (смотрел в стену в глубине сарая)
    stay(31, 44, Math.PI, 10 * 60);
    const worst = perceivedAt(...C(34, 37));
    check('после полной темноты улица ярче нормы в разы', worst > 4, worst.toFixed(2));
    check('но белого добавляется не больше 45%', overAmount(worst) <= 0.45 + 1e-9, overAmount(worst).toFixed(2));
    // обычный случай: стоит в сарае и смотрит в дверь на улицу — глаз подстраивается под проём
    stay(34, 43, -Math.PI / 2, 10 * 60);
    const door = perceivedAt(...C(34, 37));
    check('глядя в дверь, засветка улицы слабая (< 15%)', overAmount(door) < 0.15, [door.toFixed(2), overAmount(door).toFixed(2)]);
    check('чуть ярче нормы — засветка едва заметна', overAmount(1.3) < 0.06, overAmount(1.3).toFixed(3));
  });
  run('противники в темноте', () => {
    const e = makePerson('e', 0, 0), t = makePerson('p', 0, 0);
    e.st = 0; t.speed = 0; t.gun.lastShot = -99;
    at(e, 36, 27); at(t, 31, 44);
    check('с улицы в тёмном сарае человека не разглядеть', seenBrightness(e, t) < LIGHT.seeMin, seenBrightness(e, t).toFixed(3));
    at(e, 64, 44); at(t, 61, 44);
    const darkT = noticeTime(e, t, M(3), 0);
    at(e, 36, 22); at(t, 36, 25);
    const litT = noticeTime(e, t, M(3), 0);
    check('в темноте замечают заметно дольше', darkT > litT * 2, [darkT.toFixed(2), litT.toFixed(2)]);
    at(e, 64, 44); at(t, 61, 44); t.lamp = true; t.a = 0;
    check('включённый фонарь в лицо выдаёт сразу', seenBrightness(e, t) >= 1);
    t.lamp = false;
    at(e, 31, 44); at(t, 34, 38);
    check('из темноты силуэт на свету виден отлично', seenBrightness(e, t) >= 1, seenBrightness(e, t).toFixed(2));
  });
  run('фонарь днём', () => {
    // средняя яркость экрана в секторе перед бойцом: фонарь выкл/вкл на улице
    G.enemies = []; at(p, 36, 27); p.a = 0; p.crouch = false; G.expo = null;
    for (let i = 0; i < 60; i++) updateExposure(p, 1 / 60);
    G.cam.x = p.x; G.cam.y = p.y; G.shake = 0;
    const sample = () => {
      render(0);
      const d = ctx.getImageData(Math.round(VW / 2 + M(1.5) * G.zoom), Math.round(VH / 2 - 15), Math.round(M(3) * G.zoom), 30).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s / (d.length / 4) / 3;
    };
    p.lamp = false; const off = sample();
    p.lamp = true; const on = sample();
    check('на свету луч фонаря немного виден', on - off > 4 && on - off < 45, [off.toFixed(1), on.toFixed(1)]);
    p.lamp = false;
  });
  run('ослепление только в темноте', () => {
    const e = makeEnemy(0, 0, 0, null);
    G.enemies = [e];
    const face = (a, b) => { a.a = Math.atan2(b.y - a.y, b.x - a.x); };
    // глухая часть гаража: игрок светит противнику в лицо
    at(p, 57, 46); at(e, 62, 46); face(p, e); face(e, p); p.lamp = true; e.lamp = false;
    const dark = glareAt(e);
    check('в темноте фонарь в лицо слепит', dark > 0.3, dark.toFixed(2));
    e.st = 0; e.blind = 0;
    for (let i = 0; i < 10; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('ослеплённый противник хуже целится', e.blind > 0.5, e.blind.toFixed(2));
    p.lamp = false;
    for (let i = 0; i < 90; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('выключил фонарь — ослепление проходит за ~1 с', e.blind < 0.05, e.blind.toFixed(2));
    // комната с окнами (полумрак 0,25): слабее
    p.lamp = true; at(p, 7, 12); at(e, 12, 12);   // те же 5 м face(p, e); face(e, p);
    const dim = glareAt(e);
    // улица
    at(p, 30, 27); at(e, 34, 27); face(p, e); face(e, p);
    const day = glareAt(e);
    e.blind = 0; for (let i = 0; i < 10; i++) { G.time += 1 / 60; updateAI(1 / 60); }
    check('в полумраке слепит слабее, чем в темноте', dim > 0 && dim < dark * 0.7, [dim.toFixed(2), dark.toFixed(2)]);
    check('днём фонарь не слепит', day === 0 && e.blind === 0, [day, e.blind]);
    // игрока: противник светит в лицо на улице — глаз не «пересвечивается», в темноте потом привыкает как обычно
    p.lamp = false; e.lamp = true;
    const adaptInShed = (withLamp) => {
      e.lamp = withLamp; at(p, 30, 27); at(e, 33, 27); face(p, e); face(e, p);
      G.expo = null; for (let i = 0; i < 180; i++) updateExposure(p, 1 / 60);
      const g0 = G.expo.gain, A0 = G.expo.A;
      e.lamp = false;
      at(p, 31, 44); p.a = Math.PI;
      for (let i = 0; i < 120; i++) updateExposure(p, 1 / 60);
      return { g0, A0, after: G.expo.gain };
    };
    const lit = adaptInShed(true), plain = adaptInShed(false);
    check('днём фонарь в лицо не меняет экспозицию', lit.g0 === 1 && Math.abs(lit.A0 - plain.A0) < 0.01, [lit.A0.toFixed(2), plain.A0.toFixed(2)]);
    check('и не мешает потом привыкнуть к темноте', Math.abs(lit.after - plain.after) < 0.01, [lit.after.toFixed(2), plain.after.toFixed(2)]);
    e.lamp = false; G.enemies = [];
  });
  run('отрисовка', () => {
    at(p, 31, 44); p.lamp = true; G.cam.x = p.x; G.cam.y = p.y;
    render(1 / 60);
    check('кадр в темноте с фонарём рисуется', true);
  });
  run('дверь: свет пересчитывается куском, как целиком', () => {
    startMap('assault', assaultSeed(4321, 6), [{ slot: 0, human: true, name: 'Т' }], false);
    const px = () => map.lightCanvas.getContext('2d').getImageData(0, 0, map.lw, map.lh).data;
    let worst = [0, 0, 0], n = 0;
    for (const d of map.doors.filter((q) => !q.locked).slice(0, 6)) {
      d.open = !d.open; syncDoorTile(d);                    // кусок вокруг двери
      const part = { L: map.light.slice(), S: map.lightSub.slice(), P: px() };
      buildLightMap(map.lightBase);                         // целиком
      const full = { L: map.light, S: map.lightSub, P: px() };
      let dl = 0, ds = 0, dp = 0;
      for (let i = 0; i < full.L.length; i++) dl = Math.max(dl, Math.abs(full.L[i] - part.L[i]));
      for (let i = 0; i < full.S.length; i++) ds = Math.max(ds, Math.abs(full.S[i] - part.S[i]));
      for (let i = 0; i < full.P.length; i++) dp = Math.max(dp, Math.abs(full.P[i] - part.P[i]));
      worst = [Math.max(worst[0], dl), Math.max(worst[1], ds), Math.max(worst[2], dp)];
      n++;
    }
    check(`${n} дверей: освещённость и ячейки — те же, текстура — до 2/255`, n >= 3 && worst[0] < 1e-6 && worst[1] < 1e-6 && worst[2] <= 2, [n, worst]);
  });
  return T_.checks;
})();
