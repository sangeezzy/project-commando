'use strict';
// ---------- Уровни ----------
// Карты строятся кодом (детерминированно, одинаково у всех игроков).
// Координаты в конструкторе — в клетках, в игре — в пикселях (ent.px, ent.py).

const LEVELS = [
  { name: 'ФЛАГМАН «ПРАВОСУДИЕ» · АНГАР', hub: true, color: '#9d8cff', stages: { 0: buildHub } },
  {
    name: 'ГЛАВА 1 · ПЛАНЕТА N', short: 'ПЛАНЕТА N', color: '#ffb000',
    stages: { 1: buildCaves, 2: buildTown },
    stageNames: { 1: 'ПЕЩЕРЫ', 2: 'ПОСЕЛЕНИЕ' },
    briefing: [
      'Отряд «Омега» высадился на планете N, но посадку засекли — челнок сел в горах, отряд разделился.',
      'Две пары коммандос пробиваются через пещеры. Рации под скалой молчат.',
      'Точка рандеву — мини-лагерь в долине. Оттуда на спидерах — к клонам, штурмующим поселение.',
    ],
  },
];

function buildStageMap(lv, stage) {
  const L = LEVELS[lv];
  const fn = L.stages[stage];
  const meta = fn.meta;
  const mb = fn();
  return finishMap(mb, {
    lv, stage, hub: !!L.hub, color: L.color,
    name: L.hub ? L.name : `${L.short} · ${L.stageNames[stage]}`, ...meta,
  });
}

// ---------- База ----------
function buildHub() {
  const mb = new MapBuilder(32, 20, 7);
  mb.box(0, 0, 31, 19, WM.BASE, FM.METAL);
  mb.wallRect(5, 7, 6, 8, WM.BASE); mb.wallRect(25, 7, 26, 8, WM.BASE);
  mb.wallRect(5, 13, 6, 14, WM.BASE); mb.wallRect(25, 13, 26, 14, WM.BASE);
  mb.low(10, 15, 12, 16, WM.CRATE); mb.low(20, 15, 22, 16, WM.CRATE);
  for (let i = 0; i < 4; i++) mb.ent('spawn', 12.5 + i * 2, 12.5, { idx: i });
  mb.ent('pad', 16, 5, { lv: 1 });
  return mb;
}

// ---------- Миссия 1, этап 1: пещеры и долина ----------
function buildCaves() {
  const mb = new MapBuilder(110, 80, 1701);
  // Западная пещера (отряд 1: А и Б)
  const westMain = [[12, 73], [13, 67], [18, 62], [23, 60], [22, 55], [20, 51], [25, 47], [28, 44], [25, 39], [26, 35], [30, 31], [29, 26], [30, 21], [30, 17]];
  mb.path(westMain, 1.5, 2.2, FM.CAVE);
  mb.disc(13, 70, 3.5, FM.CAVE); mb.disc(24, 47, 3.2, FM.CAVE); mb.disc(27, 32, 3, FM.CAVE);
  mb.path([[23, 60], [30, 63], [36, 66], [40, 70]], 1.3, 1.9, FM.CAVE); mb.disc(40, 70, 2.6, FM.CAVE);
  mb.path([[20, 51], [13, 49], [8, 45], [7, 40]], 1.3, 1.9, FM.CAVE); mb.disc(7, 39, 2.4, FM.CAVE);
  mb.path([[28, 44], [36, 45], [41, 42]], 1.3, 1.8, FM.CAVE); mb.disc(42, 41, 2.2, FM.CAVE);
  // Восточная пещера (отряд 2: В и Г)
  const eastMain = [[97, 73], [96, 67], [91, 63], [86, 62], [87, 57], [89, 52], [84, 48], [80, 45], [83, 40], [82, 36], [78, 31], [80, 26], [79, 21], [79, 17]];
  mb.path(eastMain, 1.5, 2.2, FM.CAVE);
  mb.disc(96, 70, 3.5, FM.CAVE); mb.disc(85, 48, 3.2, FM.CAVE); mb.disc(80, 32, 3, FM.CAVE);
  mb.path([[86, 62], [78, 65], [72, 69], [68, 72]], 1.3, 1.9, FM.CAVE); mb.disc(68, 72, 2.6, FM.CAVE);
  mb.path([[89, 52], [96, 50], [101, 46], [102, 41]], 1.3, 1.9, FM.CAVE); mb.disc(102, 40, 2.4, FM.CAVE);
  mb.path([[80, 45], [73, 46], [69, 41]], 1.3, 1.8, FM.CAVE); mb.disc(68, 40, 2.2, FM.CAVE);

  // Долина (поверхность, светло, рация работает)
  mb.path([[6, 14], [14, 11], [24, 13], [34, 10], [44, 12], [55, 9], [66, 12], [76, 10], [86, 13], [96, 11], [104, 14]], 4, 6, FM.SAND);
  mb.fill(12, 7, 98, 17, FM.SAND);

  // камни в пещерах и в долине
  mb.scatterRocks(9, 64, 17, 69, 2);
  mb.scatterRocks(21, 44, 28, 50, 3);
  mb.scatterRocks(24, 29, 30, 35, 2);
  mb.scatterRocks(91, 64, 100, 69, 2);
  mb.scatterRocks(82, 45, 89, 51, 3);
  mb.scatterRocks(77, 29, 83, 35, 2);
  mb.scatterRocks(8, 6, 102, 20, 46, [[55, 9, 9], [30, 18, 4], [79, 18, 4]]);

  // Завалы — разбирать вдвоём
  mb.debris('w1', 22.5, 57, 2.7);
  mb.debris('w2', 25.6, 37, 2.7);
  mb.debris('e1', 87, 58.4, 2.7);
  mb.debris('e2', 82.5, 38, 2.7);

  // Старт отрядов
  mb.ent('spawn', 12.5, 72.5, { squad: 0 }); mb.ent('spawn', 14.5, 72.5, { squad: 0 });
  mb.ent('spawn', 95.5, 72.5, { squad: 1 }); mb.ent('spawn', 97.5, 72.5, { squad: 1 });
  mb.ent('marker', 30.5, 18.5, { name: 'exit0' });
  mb.ent('marker', 79.5, 18.5, { name: 'exit1' });

  // Точка рандеву: потушенный костёр, кусты, два спидера
  mb.ent('rv', 55.5, 10.5, { r: 5 });
  mb.ent('fire', 55.5, 10.5);
  mb.low(52, 12, 53, 12, WM.CRATE);
  for (const [x, y] of [[48, 6], [49.5, 5.5], [47, 7.5], [61, 6], [62.5, 5.8], [63.5, 7.4], [57, 6]]) mb.ent('bush', x, y);
  mb.ent('speeder', 49.5, 8, { a: 0 });
  mb.ent('speeder', 61.5, 8, { a: Math.PI });

  // Жуки-сепаратисты
  for (const [x, y] of [[23, 46], [26, 48], [40, 70], [26, 31], [29, 33], [7, 40]]) mb.enemy('S', x, y);
  for (const [x, y] of [[84, 47], [87, 49], [68, 72], [79, 31], [82, 33], [102, 40]]) mb.enemy('S', x, y);
  mb.enemy('S', 38, 12, { patrol: [[38, 12], [46, 15], [38, 15]] });
  mb.enemy('S', 70, 12, { patrol: [[70, 12], [64, 15], [72, 15]] });
  mb.enemy('S', 20, 12); mb.enemy('S', 90, 12);

  mb.zone('cave', 0, 20, 109, 79);
  mb.zone('valley', 0, 0, 109, 19);
  return mb;
}
buildCaves.meta = { radioNote: 'В пещерах нет связи' };

// ---------- Миссия 1, этап 2: дорога, лагерь клонов, поселение, тоннели ----------
const TOWN = {
  out: [40, 6, 132, 82],         // окраины (внешняя стена)
  cen: [72, 22, 112, 62],        // центральный район (внутренняя стена)
};
function buildTown() {
  const mb = new MapBuilder(160, 120, 4242);
  // Равнина и дорога к лагерю клонов
  mb.path([[2, 50], [10, 49], [20, 50], [30, 48], [38, 44]], 5, 7, FM.SAND);
  mb.fill(3, 36, 39, 64, FM.SAND);
  // Лагерь клонов
  mb.fill(12, 40, 32, 60, FM.CAMP);
  for (const [x, y] of [[14, 41], [14, 57], [26, 41], [26, 57]]) mb.low(x, y, x + 3, y + 2, WM.TENT);
  mb.low(31, 45, 31, 47, WM.BARRICADE); mb.low(31, 53, 31, 55, WM.BARRICADE);
  mb.low(20, 49, 21, 50, WM.CRATE);
  // Дорога на юг и на восток к техническому лагерю
  mb.path([[23, 60], [22, 75], [24, 90], [23, 104]], 3.5, 4.5, FM.SAND);
  mb.path([[23, 104], [50, 106], [80, 104], [110, 106], [136, 104]], 3.5, 4.5, FM.SAND);
  // Технический лагерь клонов (юго-восток)
  mb.fill(136, 94, 155, 114, FM.CAMP);
  mb.low(139, 96, 141, 97, WM.TENT); mb.low(150, 108, 152, 110, WM.TENT); mb.low(151, 96, 153, 98, WM.TENT);
  mb.low(144, 108, 145, 109, WM.CRATE);

  // Тоннели под окраинами (темно, нет связи, фауна)
  const tunMain = [[145.5, 92], [140, 88], [130, 90], [120, 87], [110, 91], [100, 88], [92, 90], [92.5, 85], [92.5, 83]];
  mb.path(tunMain, 1.3, 1.9, FM.TUNNEL);
  mb.disc(125, 91.5, 2.8, FM.TUNNEL); mb.disc(104, 92.5, 2.8, FM.TUNNEL);
  mb.path([[110, 91], [112, 95], [118, 95.5]], 1.2, 1.7, FM.TUNNEL); mb.disc(118.5, 95, 2.2, FM.TUNNEL);
  mb.path([[100, 88], [96, 85.5], [86, 85.5]], 1.2, 1.6, FM.TUNNEL); mb.disc(85.5, 86, 2.2, FM.TUNNEL);
  mb.path([[130, 90], [133, 86], [128, 84.5]], 1.2, 1.6, FM.TUNNEL);
  // запечатываем ряд между тоннелем и лагерем: проход только через ворота
  for (let x = 136; x <= 155; x++) mb.set(x, 93, T.WALL, WM.ROCK);
  mb.gate('tunnelIn', 144, 93, 146, 93, { fm: FM.TUNNEL, label: 'вход в тоннели' });

  // Окраины: внешняя стена
  const [ox0, oy0, ox1, oy1] = TOWN.out;
  mb.fill(ox0 + 1, oy0 + 1, ox1 - 1, oy1 - 1, FM.STREET);
  for (let x = ox0; x <= ox1; x++) { mb.set(x, oy0, T.WALL, WM.TOWN); mb.set(x, oy1, T.WALL, WM.TOWN); }
  for (let y = oy0; y <= oy1; y++) { mb.set(ox0, y, T.WALL, WM.TOWN); mb.set(ox1, y, T.WALL, WM.TOWN); }
  for (let y = 41; y <= 47; y++) mb.floor(ox0, y, FM.STREET);          // главные ворота (проём)
  for (let y = 40; y <= 48; y++) mb.floor(ox0 - 1, y, FM.SAND);
  // люк из тоннелей в южные окраины
  for (let x = 86; x <= 99; x++) mb.set(x, oy1, T.WALL, WM.TOWN);
  mb.gate('hatch', 92, oy1, 93, oy1, { fm: FM.STREET, label: 'люк' });

  // Центр: внутренняя стена
  const [cx0, cy0, cx1, cy1] = TOWN.cen;
  mb.fill(cx0 + 1, cy0 + 1, cx1 - 1, cy1 - 1, FM.STREET);
  for (let x = cx0; x <= cx1; x++) { mb.set(x, cy0, T.WALL, WM.CENTER); mb.set(x, cy1, T.WALL, WM.CENTER); }
  for (let y = cy0; y <= cy1; y++) { mb.set(cx0, y, T.WALL, WM.CENTER); mb.set(cx1, y, T.WALL, WM.CENTER); }
  mb.gate('innerGate', cx0, 40, cx0, 44, { fm: FM.STREET, label: 'ворота центра' });

  // Дома окраин — запад
  mb.box(46, 10, 54, 17, WM.HOUSE, FM.INDOOR, [[50, 17]]);
  mb.box(58, 9, 67, 16, WM.HOUSE, FM.INDOOR, [[58, 12], [62, 16]]);
  mb.box(46, 22, 53, 30, WM.HOUSE, FM.INDOOR, [[53, 26]]);
  mb.box(58, 21, 67, 29, WM.HOUSE, FM.INDOOR, [[62, 21], [58, 25]]);
  mb.box(46, 57, 54, 64, WM.HOUSE, FM.INDOOR, [[50, 57]]);
  mb.box(58, 56, 67, 64, WM.HOUSE, FM.INDOOR, [[58, 60], [62, 64]]);
  mb.box(46, 69, 54, 78, WM.HOUSE, FM.INDOOR, [[54, 73]]);
  mb.box(58, 69, 67, 77, WM.HOUSE, FM.INDOOR, [[62, 69]]);
  // оборона у главных ворот
  mb.low(48, 36, 48, 39, WM.BARRICADE); mb.low(48, 49, 48, 52, WM.BARRICADE); mb.low(51, 42, 51, 46, WM.BARRICADE);
  mb.low(55, 38, 56, 39, WM.CRATE); mb.low(55, 50, 56, 51, WM.CRATE);
  // север
  mb.box(75, 9, 84, 16, WM.HOUSE, FM.INDOOR, [[79, 16]]);
  mb.box(86, 9, 92, 15, WM.HOUSE, FM.INDOOR, [[89, 15]]);
  mb.box(113, 9, 122, 17, WM.HOUSE, FM.INDOOR, [[117, 17]]);
  // второстепенный лагерь с картой патрулей
  mb.fill(95, 8, 108, 19, FM.CAMP);
  mb.low(96, 10, 98, 11, WM.TENT); mb.low(104, 9, 106, 10, WM.TENT); mb.low(99, 17, 100, 17, WM.CRATE);
  mb.low(102, 13, 103, 13, WM.CRATE);
  mb.ent('table', 102.5, 14.6);
  // восток: станция наблюдения
  mb.box(116, 24, 128, 33, WM.FACILITY, FM.INDOOR, [[116, 29]]);
  mb.ent('console', 125.5, 28.5, { id: 'station' });
  mb.box(117, 38, 127, 46, WM.HOUSE, FM.INDOOR, [[117, 42]]);
  mb.box(117, 51, 127, 59, WM.HOUSE, FM.INDOOR, [[122, 51]]);
  // юг: захолустье, люк, дом с артефактом, местные
  mb.box(75, 66, 80, 71, WM.HOUSE, FM.INDOOR, [[77, 66], [80, 69]]);
  mb.box(83, 70, 88, 75, WM.HOUSE, FM.INDOOR, [[85, 70]]);
  mb.box(96, 74, 102, 80, WM.HOUSE, FM.INDOOR, [[96, 77]]);
  mb.ent('item', 100.5, 77.5, { item: 'artifact' });
  mb.box(105, 66, 110, 71, WM.HOUSE, FM.INDOOR, [[107, 71]]);
  mb.box(113, 70, 119, 76, WM.HOUSE, FM.INDOOR, [[113, 73]]);
  mb.box(123, 65, 129, 71, WM.HOUSE, FM.INDOOR, [[126, 71]]);
  mb.box(76, 75, 82, 80, WM.HOUSE, FM.INDOOR, [[79, 75]]);
  mb.low(89, 77, 89, 78, WM.CRATE); mb.low(105, 78, 106, 78, WM.CRATE);
  mb.ent('npc', 107.5, 73.5, { role: 'glasses' });
  mb.ent('npc', 111.5, 77.5, { role: 'merc' });

  // Центральный район: площадь, объект связи, контейнер с боссом
  mb.fill(84, 33, 101, 51, FM.PLAZA);
  mb.box(88, 38, 96, 45, WM.FACILITY, FM.INDOOR, [[92, 45], [88, 41]]);
  mb.wallRect(98, 34, 100, 35, WM.FACILITY);
  mb.ent('container', 99.5, 37);
  mb.box(75, 25, 82, 31, WM.CENTER, FM.INDOOR, [[82, 28]]);
  mb.box(75, 53, 82, 59, WM.CENTER, FM.INDOOR, [[82, 56]]);
  mb.box(104, 25, 110, 31, WM.CENTER, FM.INDOOR, [[104, 28]]);
  mb.box(104, 53, 110, 59, WM.CENTER, FM.INDOOR, [[104, 56]]);
  mb.box(85, 24, 92, 29, WM.CENTER, FM.INDOOR, [[88, 29]]);
  mb.box(94, 24, 101, 29, WM.CENTER, FM.INDOOR, [[97, 29]]);
  mb.box(85, 55, 92, 60, WM.CENTER, FM.INDOOR, [[88, 55]]);
  mb.box(95, 55, 102, 60, WM.CENTER, FM.INDOOR, [[98, 55]]);
  mb.low(90, 48, 93, 48, WM.BARRICADE); mb.low(85, 40, 85, 42, WM.BARRICADE); mb.low(99, 41, 99, 43, WM.BARRICADE);

  // Камни на равнине и у дороги
  mb.scatterRocks(4, 36, 11, 64, 6, [[5, 50, 4]]);
  mb.scatterRocks(33, 36, 39, 64, 5, [[38, 44, 3]]);
  mb.scatterRocks(20, 64, 27, 100, 6);

  // Камеры наблюдения: две постоянные и несколько возможных мест для случайных
  mb.ent('camera', 44.5, 40.5, { a: Math.PI * 0.85, sweep: 0.6, fixed: true, label: 'главные ворота' });
  mb.ent('camera', 70.5, 37.5, { a: Math.PI / 2, sweep: 0.5, fixed: true, label: 'вход в центр' });
  mb.ent('camera', 56.5, 31.5, { a: Math.PI / 2, sweep: 0.8 });
  mb.ent('camera', 85.5, 17.5, { a: Math.PI * 0.25, sweep: 0.7 });
  mb.ent('camera', 113.5, 35.5, { a: 0, sweep: 0.8 });
  mb.ent('camera', 111.5, 64.5, { a: Math.PI * 0.6, sweep: 0.8 });
  mb.ent('camera', 68.5, 65.5, { a: Math.PI * 0.4, sweep: 0.8 });
  mb.ent('camera', 129.5, 49.5, { a: Math.PI, sweep: 0.7 });

  // Спидеры (этап начинается в пути) и точки появления
  mb.ent('speeder', 5, 48.5, { a: 0, start: true });
  mb.ent('speeder', 5, 52, { a: 0, start: true });
  mb.ent('cpspawn', 58.5, 48.5, { cp: 'center' });
  mb.ent('cpspawn', 86.5, 49.5, { cp: 'boss' });

  // Клоны
  mb.ent('ally', 28.5, 50.5, { t: 'clone', captain: true });
  for (const [x, y] of [[28, 47], [28, 54], [25, 46], [25, 55], [22, 52]]) mb.ent('ally', x + 0.5, y + 0.5, { t: 'clone' });
  mb.ent('ally', 144.5, 103.5, { t: 'clone', post: true, tech: true });
  mb.ent('ally', 148.5, 103.5, { t: 'clone', post: true, tech: true });
  mb.ent('crate', 146.5, 100.5, { id: 'scanner' });
  mb.ent('marker', 24.5, 50.5, { name: 'cloneCamp' });
  mb.ent('marker', 146.5, 102.5, { name: 'techCamp' });
  mb.ent('marker', 68.5, 42.5, { name: 'innerGateOut' });
  mb.ent('marker', 76.5, 42.5, { name: 'innerGateIn' });
  mb.ent('marker', 92.5, 47.5, { name: 'square' });
  for (const [x, y] of [[78.5, 44.5], [106.5, 44.5], [92.5, 32.5], [92.5, 52.5]]) mb.ent('mercspot', x, y);

  // Враги окраин: оборона ворот
  for (const [x, y] of [[52, 38], [52, 49], [53, 42], [53, 46], [54, 40]]) mb.enemy('D', x, y, { a: Math.PI });
  mb.enemy('K', 55, 44, { a: Math.PI });
  // второстепенный лагерь
  mb.enemy('D', 100, 12); mb.enemy('D', 104, 15); mb.enemy('S', 97, 15); mb.enemy('S', 107, 13);
  // станция
  mb.enemy('D', 121, 30); mb.enemy('S', 114, 30, { patrol: [[114, 30], [114, 36]] });
  // патрули улиц
  mb.enemy('S', 56, 19, { patrol: [[56, 19], [70, 19], [70, 33], [56, 33]] });
  mb.enemy('S', 74, 20, { patrol: [[74, 20], [110, 20]] });
  mb.enemy('D', 114, 19, { patrol: [[114, 19], [114, 48], [130, 48], [130, 19]] });
  mb.enemy('S', 74, 64, { patrol: [[74, 64], [130, 64]] });
  mb.enemy('D', 44, 66, { patrol: [[44, 66], [44, 80], [70, 80], [70, 66]] });
  mb.enemy('S', 66, 35); mb.enemy('S', 70, 52);
  // захолустье
  mb.enemy('S', 88, 79); mb.enemy('S', 120, 79);

  // Центр
  mb.enemy('D', 78, 40, { patrol: [[78, 34], [78, 50]] });
  mb.enemy('D', 106, 40, { patrol: [[106, 50], [106, 34]] });
  mb.enemy('D', 90, 32, { patrol: [[84, 32], [101, 32]] });
  mb.enemy('D', 90, 52, { patrol: [[101, 52], [84, 52]] });
  mb.enemy('S', 80, 46); mb.enemy('S', 104, 46); mb.enemy('S', 93, 23);
  mb.enemy('C', 86, 36); mb.enemy('C', 98, 40); mb.enemy('C', 94, 50, { a: Math.PI / 2 });
  mb.enemy('K', 90, 47, { a: Math.PI / 2 }); mb.enemy('K', 86, 42, { a: Math.PI }); mb.enemy('K', 92, 41);

  // Фауна тоннелей
  for (const [x, y] of [[124, 91], [126, 92], [125, 93], [103, 92], [105, 93], [104, 91], [118, 95], [119, 94], [85, 86], [87, 86]]) {
    mb.enemy('W', x, y);
  }

  mb.zone('cen', ...TOWN.cen);
  mb.zone('out', ...TOWN.out);
  mb.zone('tun', 40, 83, 150, 97);
  mb.zone('camp', 0, 30, 39, 70);
  mb.zone('tech', 134, 90, 159, 119);
  mb.zone('road', 0, 0, 159, 119);
  return mb;
}
buildTown.meta = {};
