'use strict';
// ---------- Тюнинг и справочники ----------

const PEER_PREFIX = 'project-commando-v1-';
const MAX_PLAYERS = 4;
const SNAP_MS = 55;            // хост -> гости, ~18 Гц
const INPUT_MS = 33;           // гость -> хост, 30 Гц
const SAVE_KEY = 'project-commando-progress-v1';

// Режимы движения и шум (радиус в px «по пути»: звук огибает стены)
const MV = { IDLE: 0, SLOW: 1, WALK: 2, SPRINT: 3 };
const NOISE = {
  walk: 150, sprint: 340, death: 110, enemyShot: 260, boom: 650, flash: 560,
  debris: 330, speeder: 420, melee: 60, decoy: 320, alarm: 900,
};
const SPRINT_MUL = 1.6, SLOW_MUL = 0.45;
const STAMINA_DRAIN = 2.5, STAMINA_REGEN = 3;

// Здоровье героев: падение при 0, напарник поднимает, если постоит рядом
const PLAYER_HP = 4;
const REVIVE_TIME = 2;
const REVIVE_HP = 2;
const REGEN_DELAY = 6, REGEN_STEP = 4;   // через 6 с без урона +1 hp каждые 4 с

// Видимость
const ENEMY_SIGHT = 450;       // в светлых местах или если героя выдаёт свет
const DARK_SIGHT = 110;        // герой в темноте без света — замечают только вблизи
const DARK_SIGHT_ALERT = 160;
const LIGHT_NOTICE = 260;      // включённый фонарь замечают с любой стороны в этом радиусе
const MUZZLE_FLASH_T = 0.6;    // сколько секунд после выстрела стрелок виден в темноте
const FLASH_RANGE = 340;       // дальность нашлемного фонаря
const FLASH_HALF = 0.5;        // половина угла конуса фонаря (рад)
const AMBIENT_R = 62;          // в темноте без фонаря герой видит вокруг себя только это
const FOG_SHARED = true;       // видно то, что видят все герои

// Тревога: если заметивший отряд враг живёт с «!» дольше этого — поднимается тревога по району
const ALARM_DELAY = 4;
const COMM_CALL_TIME = 2.2;    // дроид-связист вызывает подкрепление за это время

const BOSS_TIME = 300;         // супер-B2 выключается через 5 минут
const BOSS_HEAT_MAX = 5;       // суммарно 5 с стрельбы — оружие клинит
const BOSS_JAM_TIME = 10;
const RIDE_SPEED = 360;

// Персонажи отряда «Омега». Временные имена А, Б, В, Г. squad — отряд в пещерах (0 — западный, 1 — восточный)
const CHARS = [
  { letter: 'А', role: 'КОМАНДИР', color: '#33ccff', squad: 0, speed: 180, weapon: 'rifle', special: 'flash',
    desc: 'Винтовка DC: точная, средний темп. ПКМ — светошумовая граната, оглушает врагов в радиусе. Громко.' },
  { letter: 'Б', role: 'СНАЙПЕР', color: '#9dff3a', squad: 0, speed: 175, weapon: 'sniper', special: 'mark',
    desc: 'Снайперская винтовка: мощный выстрел навылет, долгая перезарядка, лазерный прицел. ПКМ — метка: враг подсвечен для всего отряда.' },
  { letter: 'В', role: 'ПОДРЫВНИК', color: '#ff9f1a', squad: 1, speed: 172, weapon: 'scatter', special: 'nade',
    desc: 'Дробовой бластер — смертелен вблизи. ПКМ — термальный детонатор.' },
  { letter: 'Г', role: 'ТЕХНИК', color: '#c77dff', squad: 1, speed: 185, weapon: 'smg', special: 'decoy',
    desc: 'Пистолет-пулемёт с глушителем — тише всех. ПКМ — приманка, уводит врагов шумом. Взламывает и настраивает технику вдвое быстрее.' },
];

const WEAPONS = {
  rifle:   { name: 'ВИНТОВКА DC', cd: 0.15, dmg: 1, n: 1, spread: 0.035, speed: 1000, life: 1.1, noise: 420, sfx: 'rifle' },
  sniper:  { name: 'СНАЙПЕРСКАЯ', cd: 0.95, dmg: 5, n: 1, spread: 0, speed: 1900, life: 0.9, noise: 520, pierce: 2, sfx: 'sniper' },
  scatter: { name: 'ДРОБОВИК', cd: 0.6, dmg: 1, n: 6, spread: 0.2, speed: 820, life: 0.4, noise: 420, sfx: 'scatter' },
  smg:     { name: 'ПП С ГЛУШИТЕЛЕМ', cd: 0.1, dmg: 1, n: 1, spread: 0.075, speed: 950, life: 0.85, noise: 230, sfx: 'smg' },
};

const SPECIALS = {
  flash: { name: 'СВЕТОШУМОВАЯ', cd: 10 },
  mark:  { name: 'МЕТКА', cd: 6 },
  nade:  { name: 'ДЕТОНАТОР', cd: 7 },
  decoy: { name: 'ПРИМАНКА', cd: 9 },
};

// Враги. fac: sep — сепаратисты и их союзники, fauna — дикая фауна тоннелей (враждебна всем).
// fire — пауза между очередями, burst — выстрелов в очереди, spread — разброс, bolt — скорость заряда, lead — доля упреждения
const ETYPES = {
  S: { name: 'жук-воин', fac: 'sep', kind: 'bug', hp: 3, r: 11, speed: 90, chase: 165, color: '#b4ff3a',
       fire: [0.55, 0.95], burst: 2, burstGap: 0.16, spread: 0.17, bolt: 470, lead: 0.2, dodge: 0.6, score: 100 },
  D: { name: 'B1', fac: 'sep', kind: 'droid', hp: 2, r: 11, speed: 55, chase: 80, color: '#e8cf9a',
       fire: [0.9, 1.5], burst: 2, burstGap: 0.28, spread: 0.11, bolt: 480, lead: 0.35, score: 80 },
  C: { name: 'B1-связист', fac: 'sep', kind: 'droid', comm: true, unarmed: true, hp: 2, r: 11, speed: 55, chase: 115,
       color: '#ffd27a', score: 120 },
  K: { name: 'B2', fac: 'sep', kind: 'droid', hp: 8, r: 15, speed: 65, chase: 100, color: '#8fb0ff',
       fire: [0.75, 1.05], burst: 3, burstGap: 0.1, spread: 0.035, bolt: 540, lead: 0.95, armor: true, strafe: true, score: 300 },
  W: { name: 'пещерный червь', fac: 'fauna', kind: 'worm', hp: 2, r: 10, speed: 70, chase: 205, color: '#d07dff',
       melee: true, fearLight: true, pack: true, score: 60 },
  X: { name: 'супер-B2', fac: 'sep', kind: 'boss', hp: 120, r: 26, speed: 70, chase: 120, color: '#ff5a5a',
       boss: true, bolt: 560, spread: 0.07, score: 3000 },
};

// Союзники: клоны и наёмники
const ATYPES = {
  clone: { name: 'клон', hp: 8, r: 11, speed: 125, color: '#f4f6ff', mark: '#4da6ff',
           cd: [0.3, 0.45], spread: 0.03, bolt: 1000, lead: 1, dodge: true, noise: 420 },
  merc:  { name: 'наёмник', hp: 4, r: 11, speed: 135, color: '#ffe14d', mark: '#ff7a2f',
           cd: [0.12, 0.2], spread: 0.045, bolt: 900, lead: 0.8, dodge: false, noise: 420 },
};

const ENEMY_BOLT = '#ff3344';
const ALLY_BOLT = '#4da6ff';
const charColor = (ch) => (CHARS[ch] ? CHARS[ch].color : '#ffffff');
