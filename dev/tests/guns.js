// Новое оружие: АК-74, РПК-74, FN FAL, M249 SAW, ТТ, Browning Hi-Power — характеристики, пулы ИИ (полноразмерные и пистолеты),
// стол в хабе (два ствола + пистолет), стрельба и перезарядка, броня по калибру, вид сверху, сеть (номера стволов).
window.__result = (() => {
  const { check, run, at, tick } = T_;
  const NEW = ['ak74', 'rpk74', 'fal', 'm249'], NEWP = ['tt', 'hipower'];
  const W = WEAPONS;
  const solo = [{ slot: 0, human: true, name: 'Тест' }];

  run('характеристики', () => {
    check('все стволы описаны и есть в сети (WEAPON_IDS)', Object.keys(W).every((t) => WEAPON_IDS.includes(t)) && WEAPON_IDS.every((t) => W[t]), WEAPON_IDS);
    check('АК-74: 5,45×39, 650 выстр/мин, 30, 900 м/с', /5,45×39/.test(W.ak74.cal) && W.ak74.rpm === 650 && W.ak74.mag === 30 && W.ak74.v0 === 900);
    check('АК-74 отдача мягче АКМ (дульный тормоз)', W.ak74.kick < W.akm.kick);
    check('РПК-74: магазин на 45, ствол длиннее — пуля быстрее АК-74, кучнее', W.rpk74.mag === 45 && W.rpk74.v0 > W.ak74.v0 && W.rpk74.mech < W.ak74.mech && W.rpk74.lmg);
    check('FN FAL: 7,62×51, магазин на 20, основной режим — одиночный, урон и пробитие — сильнее всех',
      /7,62×51/.test(W.fal.cal) && W.fal.mag === 20 && W.fal.modes[0] === 'semi' && W.fal.dmg[1] > W.akm.dmg[1] && W.fal.penExp < W.akm.penExp);
    check('M249: лента на 200, только автомат, 800 выстр/мин, перезарядка долгая', W.m249.mag === 200 && W.m249.belt && W.m249.modes.join() === 'auto' &&
      W.m249.rpm === 800 && W.m249.reloadTac > 5);
    check('ТТ: 7,62×25, 8 патронов, 420 м/с — быстрее других пистолетов', /7,62×25/.test(W.tt.cal) && W.tt.mag === 8 && W.tt.v0 > W.m1911.v0 && W.tt.v0 > W.hipower.v0);
    check('Hi-Power: 9×19, 13 патронов', /9×19/.test(W.hipower.cal) && W.hipower.mag === 13);
    check('броня IIIA держит 9 мм и .45, но не ТТ (стальной сердечник)', W.hipower.threat <= 1 && W.m1911.threat <= 1 && W.tt.threat > 1);
  });

  run('пулы ИИ', () => {
    check('полноразмерные — все 7, пистолеты — 3', NEW.every((t) => PRIMARY_IDS.includes(t)) && PRIMARY_IDS.length === 7 &&
      PISTOL_IDS.join() === 'm1911,tt,hipower');
    const e = makeEnemy(0, 0, 0, null), rnd = makeRng(11);
    const prim = new Set(), pist = new Set();
    let ok = true;
    for (let i = 0; i < 600; i++) {
      randomKit(e, rnd);
      prim.add(e.kit[0].t); if (e.kit[1]) prim.add(e.kit[1].t); pist.add(e.kit[2].t);
      if (!PISTOL_IDS.includes(e.kit[2].t) || (e.kit[1] && e.kit[1].t === e.kit[0].t)) ok = false;
    }
    check('случайный набор: встречаются все полноразмерные', PRIMARY_IDS.every((t) => prim.has(t)), [...prim]);
    check('случайный пистолет из пула: встречаются все три', PISTOL_IDS.every((t) => pist.has(t)) && ok, [...pist]);
    const w1 = new Set();
    for (let i = 0; i < 200; i++) { kitForWave(e, 1, rnd); w1.add(e.gun.t); }
    check('«Выживание», волна 1 (только пистолеты) — тоже из пула', PISTOL_IDS.every((t) => w1.has(t)) && [...w1].every((t) => PISTOL_IDS.includes(t)), [...w1]);
    // союзные боты на карте — тоже случайный пистолет
    const bp = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      startMap('clear', seed, solo, true);
      for (const b of G.players.filter((q) => q.ai)) bp.add(b.kit[2].t);
    }
    check('союзные боты — случайный пистолет из пула', [...bp].every((t) => PISTOL_IDS.includes(t)) && bp.size >= 2, [...bp]);
  });

  run('стол в хабе', () => {
    G.kits = {};
    startMap('hub', 0, solo, false);
    const h = me();
    at(h, HUB_TABLE.x0 + 2, HUB_TABLE.y1 + 2);
    openLoadout();
    const opts = (id) => [...document.getElementById(id).options].map((o) => o.value).filter(Boolean);
    check('на столе все полноразмерные (оба слота) и все пистолеты', opts('lo1').join() === PRIMARY_IDS.join() && opts('lo2').join() === PRIMARY_IDS.join() &&
      opts('lo3').join() === PISTOL_IDS.join(), [opts('lo1'), opts('lo3')]);
    document.getElementById('lo1').value = 'fal'; document.getElementById('lo2').value = 'm249'; document.getElementById('lo3').value = 'tt';
    document.getElementById('loOk').click();
    check('взял FN FAL + M249 + ТТ', h.kit.map((k) => k && k.t).join() === 'fal,m249,tt', h.kit.map((k) => k && k.t));
    check('запомнено за местом (с пистолетом)', G.kits[h.slot].join() === 'fal,m249,tt');
    applyKitAct(h, 'kit:ak74,,bad');
    check('чужой пистолет не принимается', h.kit[0].t === 'fal');
    applyKitAct(h, 'kit:ak74,');
    check('без пистолета — Colt M1911 (старый формат)', h.kit[0].t === 'ak74' && h.kit[2].t === 'm1911');
    applyKitAct(h, 'kit:rpk74,akm,hipower');
    startMap('clear', 3, solo, false);
    check('на карте — снаряжение со стола, полный боекомплект', me().kit.map((k) => k && k.t).join() === 'rpk74,akm,hipower' &&
      ammoTotal(me().kit[0]) === W.rpk74.mag * W.rpk74.mags && ammoTotal(me().kit[2]) === W.hipower.mag * W.hipower.mags,
      me().kit.map((k) => k && [k.t, ammoTotal(k)]));
    G.kits = {};
    let err = null;
    try { const c = document.createElement('canvas').getContext('2d'); drawTable(c, HUB_TABLE); } catch (e) { err = String(e); }
    check('стол со всеми стволами рисуется', !err, err);
  });

  run('стрельба, перезарядка, вид', () => {
    startRange();
    const q = me();
    G.enemies = [];
    at(q, 36, 40); q.sprintLock = 0;
    for (const t of [...NEW, ...NEWP]) {
      const pist = W[t].cls === 'pistol';
      giveKit(q, pist ? null : t, null, pist ? t : 'm1911');
      const g = q.gun, m0 = g.mag;
      let shots = 0;
      for (let i = 0; i < 30; i++) { if (pullTrigger(q, true, true, 1)) shots++; tick(1); }
      check(`${W[t].name}: стреляет, патроны тратятся`, g.t === t && shots > 0 && g.mag < m0, [g.t, shots, g.mag]);
    }
    giveKit(q, 'm249', null);
    q.gun.mag = 50;
    check('M249: быстрой перезарядки нет (лента)', quickReload(q) === false);
    startReload(q);
    check('M249: смена короба — 6,5 с', Math.abs(q.gun.reloadDur - W.m249.reloadTac) < 0.01, q.gun.reloadDur);
    let err = null;
    try { const c = document.createElement('canvas').getContext('2d'); for (const t of WEAPON_IDS) for (const mo of [1, 0.5]) drawGunShape(t, mo, c); } catch (e) { err = String(e); }
    check('вид сверху: все стволы рисуются (и с выходящим магазином)', !err, err);
    for (const t of [...NEW, ...NEWP]) { const pist = W[t].cls === 'pistol'; giveKit(q, pist ? null : t, null, pist ? t : 'm1911'); render(1 / 60); }
    check('кадр с каждым новым стволом в руках — без ошибок', true);
  });

  run('ИИ: пулемёт очередями длиннее, FN FAL — одиночными', () => {
    const e = makeEnemy(0, 0, 0, null);
    const bursts = (t) => {
      const out = [];
      for (let i = 0; i < 40; i++) {
        giveKit(e, t, null);
        Object.assign(e, { burst: 0, pause: 0, react: 0, aimT: 1, a: 0, blind: 0, supp: 0, speed: 0, kneel: false });
        const m0 = e.gun.mag;
        shootAt(e, { x: e.x + M(12), y: e.y, speed: 0 }, M(12), 1 / 60, false);
        out.push(e.burst + (m0 - e.gun.mag));
      }
      return out;
    };
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const lmg = bursts('rpk74'), rifle = bursts('ak74'), fal = bursts('fal');
    check('РПК-74 — очереди длиннее, чем у АК-74', avg(lmg) > avg(rifle) + 2, [avg(lmg).toFixed(1), avg(rifle).toFixed(1)]);
    check('FN FAL (одиночный) — по одному', fal.every((b) => b <= 1), fal.slice(0, 8));
  });

  run('сеть: снимок со всеми стволами', () => {
    startRange();
    const q = me();
    giveKit(q, 'm249', 'fal', 'tt');
    const st = personState(q);
    q.kit = [null, null, null];
    let err = null;
    try { applyKit(q, st[16]); } catch (e) { err = String(e); }
    check('снимок бойца: M249 + FN FAL + ТТ доходят', !err && q.kit.map((k) => k && k.t).join() === 'm249,fal,tt', err || q.kit.map((k) => k && k.t));
  });
  return T_.checks;
})();
