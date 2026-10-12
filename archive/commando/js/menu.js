'use strict';
// ---------- Меню и лобби (DOM) ----------

const menuEl = document.getElementById('menu');
const mainMenuEl = document.getElementById('mainMenu');
const lobbyEl = document.getElementById('lobby');
const statusEl = document.getElementById('status');
const lobbyStatusEl = document.getElementById('lobbyStatus');
const cardsEl = document.getElementById('cards');
const nameEl = document.getElementById('name');
const voiceChk = document.getElementById('voiceChk');
const voiceStatusEl = document.getElementById('voiceStatus');

function setStatus(t) { statusEl.textContent = t; }
function hideMenu() { menuEl.classList.add('hidden'); canvas.classList.add('playing'); setStatus(''); }
function showMenu() {
  menuEl.classList.remove('hidden'); canvas.classList.remove('playing');
  mainMenuEl.classList.remove('hidden'); lobbyEl.classList.add('hidden');
}

function enterLobby() {
  G.state = 'lobby';
  menuEl.classList.remove('hidden'); canvas.classList.remove('playing');
  mainMenuEl.classList.add('hidden'); lobbyEl.classList.remove('hidden');
  setStatus('');
  renderLobby();
}

// Карточки персонажей
const cardEls = CHARS.map((C, ch) => {
  const el = document.createElement('div');
  el.className = 'card';
  el.style.setProperty('--c', C.color);
  el.innerHTML = `<div class="letter">${C.letter}</div><div class="role">${C.role}</div>` +
    `<div class="squad">Отряд ${C.squad + 1} · ${WEAPONS[C.weapon].name} · ПКМ: ${SPECIALS[C.special].name}</div>` +
    `<div class="desc">${C.desc}</div><div class="who"></div>`;
  el.addEventListener('click', () => {
    initAudio();
    if (G.role === 'guest') send({ t: 'pick', ch });
    else pickChar(G.myIdx, ch);
  });
  cardsEl.appendChild(el);
  return el;
});

function renderLobby() {
  const mySlot = Lobby.slots[G.myIdx];
  CHARS.forEach((C, ch) => {
    const el = cardEls[ch];
    const owner = Lobby.slots.find((s) => s.human && s.ch === ch);
    el.classList.toggle('mine', !!owner && owner.idx === G.myIdx);
    el.classList.toggle('taken', !!owner && owner.idx !== G.myIdx);
    const who = el.querySelector('.who');
    who.classList.toggle('bot', !owner);
    who.textContent = owner ? `${owner.name}${owner.idx === G.myIdx ? ' (вы)' : ''}${owner.ready ? ' ✓ готов' : ''}` : 'свободно — займёт бот';
  });
  const code = G.role === 'solo' ? 'ОДИНОЧНАЯ ИГРА · ОСТАЛЬНЫЕ — БОТЫ' : `КОД КОМНАТЫ: ${Net.code} · ЛЮДЕЙ: ${Lobby.slots.filter((s) => s.human).length}/4`;
  document.getElementById('lobbyCode').textContent = code;
  const isHost = G.role !== 'guest';
  const btnStart = document.getElementById('btnStart');
  const btnReady = document.getElementById('btnReady');
  btnStart.classList.toggle('hidden', !isHost);
  btnReady.classList.toggle('hidden', isHost);
  btnReady.classList.toggle('on', !!(mySlot && mySlot.ready));
  btnReady.textContent = mySlot && mySlot.ready ? 'ГОТОВ ✓' : 'ГОТОВ';
  btnReady.disabled = !mySlot || mySlot.ch < 0;
  const humansIn = Lobby.slots.filter((s) => s.human);
  const notPicked = humansIn.filter((s) => s.ch < 0);
  const notReady = humansIn.filter((s) => s.idx !== G.myIdx && !s.ready);
  btnStart.disabled = !!notPicked.length || !!notReady.length;
  lobbyStatusEl.textContent = !mySlot || mySlot.ch < 0 ? 'Выберите персонажа' :
    isHost ? (notPicked.length ? 'Не все выбрали персонажа' : notReady.length ? `Ждём готовности: ${notReady.map((s) => s.name).join(', ')}` : 'Можно начинать') :
    mySlot.ready ? 'Ждём, когда хост начнёт' : 'Нажмите «Готов»';
}

document.getElementById('btnReady').addEventListener('click', () => {
  const s = Lobby.slots[G.myIdx];
  if (!s) return;
  send({ t: 'ready', v: !s.ready });
});
document.getElementById('btnStart').addEventListener('click', () => { initAudio(); startGameFromLobby(); });
document.getElementById('btnLeave').addEventListener('click', () => leaveToMenu(''));

voiceChk.addEventListener('change', async () => {
  if (voiceChk.checked) {
    voiceStatusEl.textContent = 'Запрашиваем микрофон…';
    const ok = await Voice.enable();
    voiceStatusEl.textContent = ok ? 'Микрофон включён. В игре: M — выкл/вкл, B — рация.' : Voice.error;
    if (!ok) voiceChk.checked = false;
  } else { Voice.disable(); voiceStatusEl.textContent = ''; }
});

// Позывной сохраняется между запусками
try { nameEl.value = localStorage.getItem('pc-name') || ''; } catch (e) { /* ignore */ }
function readName() {
  const n = nameEl.value.trim().slice(0, 16) || 'Боец';
  G.myName = n;
  try { localStorage.setItem('pc-name', n); } catch (e) { /* ignore */ }
}

function startSolo() {
  readName();
  cleanupNet();
  G.role = 'solo'; G.myIdx = 0;
  G.progress = loadProgress();
  Lobby.slots = emptySlots();
  Object.assign(Lobby.slots[0], { human: true, name: G.myName });
  enterLobby();
}

document.getElementById('btnSolo').addEventListener('click', () => { initAudio(); startSolo(); });
document.getElementById('btnHost').addEventListener('click', () => { initAudio(); readName(); hostGame(); });
document.getElementById('btnJoin').addEventListener('click', () => { initAudio(); readName(); joinGame(document.getElementById('code').value); });
document.getElementById('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { initAudio(); readName(); joinGame(e.target.value); }
});
