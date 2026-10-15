// Старт из лобби: люди — только случайный пистолет; боты — по галочке «случайное оружие у ботов» (выкл. — только пистолет).
// Снаряжение союзного бота: панель справа от меню стола (стрелка, переключатель ботов) — запоминается и выдаётся на картах;
// у грузовика — из того, что он привёз.
window.__result = (() => {
  const { check, tick, step, at, run } = T_;
  const el = (id) => document.getElementById(id);
  const startFromLobby = (botGuns) => {
    G.role = 'solo'; G.mySlot = 0;
    Lobby.size = 4; Lobby.slots = emptySlots(4);
    Object.assign(Lobby.slots[0], { human: true, name: 'Тест', ready: true });
    Lobby.bots = true; Lobby.botGuns = botGuns;
    G.state = 'lobby';
    startGameFromLobby();
  };
  const bots = () => G.players.filter((q) => q.ai);

  run('старт из лобби', () => {
    startFromLobby(false);
    const p = me();
    check('хаб', G.mapId === 'hub');
    check('у игрока — только случайный пистолет', !p.kit[0] && !p.kit[1] && PISTOL_IDS.includes(p.kit[2].t) && p.cur === 2, p.kit.map((k) => k && k.t));
    check('галочка выкл. — боты только с пистолетом', bots().length === 3 && bots().every((b) => !b.kit[0] && !b.kit[1] && PISTOL_IDS.includes(b.kit[2].t)), bots().map((b) => b.kit.map((k) => k && k.t)));
    startFromLobby(true);
    check('галочка вкл. — боты со случайным оружием (как раньше)', bots().every((b) => !!b.kit[0]), bots().map((b) => b.kit.map((k) => k && k.t)));
    check('игрок по-прежнему с пистолетом', !me().kit[0]);
    G.state = 'lobby'; G.role = 'host'; renderLobby();
    check('галочка в лобби — у хоста', !!el('lobbyBotGuns') && !el('lobbyBotGuns').disabled);
    G.role = 'guest'; onGuestData({ t: 'lobby', slots: Lobby.slots, bots: true, ff: 1, bg: 0 });
    check('гостю — значение хоста, галочка недоступна', Lobby.botGuns === false && (renderLobby(), el('lobbyBotGuns').disabled));
    G.role = 'solo';
  });

  run('снаряжение бота на оружейном столе', () => {
    startFromLobby(false);
    const p = me();
    at(p, HUB_TABLE.x0 + 2, HUB_TABLE.y1 + 2);
    openLoadout();
    const lo = el('loadout'), arrow = lo.querySelector('.sidearrow'), side = lo.querySelector('.botside');
    check('стрелка справа от меню, панель бота свёрнута', arrow && !arrow.classList.contains('hidden') && side.classList.contains('hidden'));
    arrow.click();
    check('стрелка — панель открыта, первый бот', !side.classList.contains('hidden') && side.querySelector('.bn').textContent === bots()[0].name);
    side.querySelector('.bnext').click();
    const b = bots()[1];
    check('переключатель — следующий бот', side.querySelector('.bn').textContent === b.name);
    side.querySelector('.b1').value = 'fal'; side.querySelector('.b2').value = ''; side.querySelector('.b3').value = 'tt'; side.querySelector('.b4').value = 'III';
    side.querySelector('.bok').click();
    check('выдано боту: FN FAL + ТТ, броня III', b.kit[0].t === 'fal' && !b.kit[1] && b.kit[2].t === 'tt' && b.armor && b.armor.cls === 'III', [b.kit.map((k) => k && k.t), b.armor]);
    const bk = G.botKits[b.slot];
    check('запомнено за ботом', bk[0] === 'fal' && !bk[1] && bk[2] === 'tt' && bk[3] === 'III', bk);
    check('у игрока не поменялось', !p.kit[0]);
    side.querySelector('.b1').value = 'akm'; side.querySelector('.b2').value = 'akm';
    side.querySelector('.bok').click();
    check('два одинаковых — не выдаёт', b.kit[0].t === 'fal' && side.querySelector('.berr').textContent.length > 0);
    closeLoadout();
    // далеко от стола — не выдаётся
    at(p, 19, 17);
    applyBotKitAct(p, `botkit:${b.slot}:m4a1,,m1911,`);
    check('не у стола — нельзя', b.kit[0].t === 'fal');
    // на карте — выбранное
    launchMap('clear', 3);
    const b2 = G.players.find((q) => q.slot === b.slot);
    check('на карте у бота — выбранное на столе (и броня)', b2.kit[0].t === 'fal' && b2.kit[2].t === 'tt' && b2.armor && b2.armor.cls === 'III', [b2.kit.map((k) => k && k.t), b2.armor]);
    check('остальные боты — только пистолет (галочка выкл.)', G.players.filter((q) => q.ai && q.slot !== b.slot).every((q) => !q.kit[0]));
    let err = null; try { render(1 / 60); } catch (e) { err = String(e); }
    check('кадр без ошибок', !err, err);
  });

  run('снаряжение бота у грузовика', () => {
    startFromLobby(false);
    launchMap('surv', 777);
    const p = me(); p.god = true;
    G.surv.wave = 2; G.surv.phase = 'break'; G.surv.t = 0; tick(2);
    G.enemies.forEach((e) => { e.dead = true; }); G.surv.toSpawn = 0; tick(2);
    tick(60 * (SURV.drive + SURV.medicWalk) + 30);
    const r = truckRear(); p.x = p.px = r.x; p.y = p.py = r.y + M(0.3);
    openTruckMenu();
    const tm = el('truckMenu'), arrow = tm.querySelector('.sidearrow'), side = tm.querySelector('.botside');
    arrow.click();
    const b = bots().find((q) => q.name === side.querySelector('.bn').textContent);
    const opts = [...side.querySelector('.b1').options].map((o) => o.value).filter(Boolean);
    check('у грузовика — стволы, открытые к волне (ружьё на 3-й), не все', opts.includes('w1300') && !opts.includes('m249'), opts);
    side.querySelector('.b1').value = 'w1300'; side.querySelector('.b4').value = 'IIIA';
    side.querySelector('.bok').click();
    check('выдано боту из грузовика: ружьё, броня IIIA, пополнен', b.kit[0].t === 'w1300' && b.armor && b.armor.cls === 'IIIA' && b.supplied === G.surv.stop,
      [b.kit.map((k) => k && k.t), b.armor, b.supplied]);
    closeTruckMenu();
  });
  return T_.checks;
})();
