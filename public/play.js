'use strict';

/* global io, FlyChess */

const { SEAT_COLORS, SEAT_NAMES, posLabel, escapeHtml } = FlyChess;

const socket = io();

let state = null;
let joined = false;
let playerId = null;
let roomCode = '';
let joinPending = false;
let autoJoinTried = false;
let rollingNow = false;
let moving = false;
let lastEnteredTurn = null;

let motionReady = false;
let motionHandler = null;
let motionBaseline = null;
let motionLast = 0;

const $ = (id) => document.getElementById(id);
const codeInput = $('codeInput');
const nameInput = $('nameInput');
const joinErr = $('joinErr');
const joinBtn = $('joinBtn');
const dieBtn = $('dieBtn');
const rollBtn = $('rollBtn');
const hintText = $('hintText');
const optionsEl = $('options');
const optionsHead = $('optionsHead');
const optionsList = $('optionsList');
const planesCard = $('planesCard');

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

function emitAck(event, payload, timeout = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: '网络有点慢，请重试' });
    }, timeout);
    socket.emit(event, payload, (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(res || {});
    });
  });
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const pidKey = (code) => `flychess:pid:${code}`;

function showView(which) {
  $('joinView').classList.toggle('hidden', which !== 'join');
  $('gameView').classList.toggle('hidden', which !== 'game');
  $('winnerView').classList.toggle('hidden', which !== 'winner');
}

function mySeat() {
  if (!state || !playerId) return null;
  const me = state.players.find((p) => p.id === playerId);
  return me ? me.seat : null;
}

function mePlayer() {
  if (!state || !playerId) return null;
  return state.players.find((p) => p.id === playerId) || null;
}

function currentPlayer() {
  if (!state) return null;
  return state.players.find((p) => p.seat === state.turn) || null;
}

function canRoll() {
  return Boolean(
    state &&
      joined &&
      state.phase === 'playing' &&
      mySeat() != null &&
      state.turn === mySeat() &&
      !state.awaitingMove &&
      state.dice == null &&
      !rollingNow &&
      !moving
  );
}

/* ------------------------------------------------------------------ */
/* 加入房间                                                           */
/* ------------------------------------------------------------------ */

function normalizeCode(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
}

function showJoinError(msg) {
  joinErr.textContent = msg || '';
}

async function join(options = {}) {
  const silent = Boolean(options.silent);
  const code = normalizeCode(codeInput.value || roomCode);
  const name = (nameInput.value || store.get('flychess:name') || '').trim().slice(0, 12);
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    if (!silent) showJoinError('请输入大屏上的 4 位房间号');
    return;
  }
  if (!name) {
    if (!silent) showJoinError('先给自己起个昵称吧');
    return;
  }
  if (joinPending) return;

  joinPending = true;
  joinBtn.disabled = true;
  joinBtn.textContent = '加入中…';
  showJoinError('');

  const res = await emitAck('player:join', {
    code,
    name,
    playerId: store.get(pidKey(code)) || undefined,
  });

  joinPending = false;
  joinBtn.disabled = false;
  joinBtn.textContent = '进入房间';

  if (!res.ok) {
    showJoinError(res.error || '加入失败，请重试');
    roomCode = code;
    showView('join');
    return;
  }

  playerId = res.playerId;
  state = res.state;
  roomCode = res.state.code || code;
  joined = true;
  store.set(pidKey(roomCode), playerId);
  store.set('flychess:name', name);
  store.set('flychess:room', roomCode);
  nameInput.value = name;
  codeInput.value = roomCode;

  showView(state.phase === 'finished' ? 'winner' : 'game');
  render();
  autoInitMotion();
  requestWakeLock();
  vibrate(20);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

function render() {
  if (!state || !joined) return;

  const me = mePlayer();
  if (!me) {
    joined = false;
    showView('join');
    showJoinError('你已不在这个房间，请重新扫码加入');
    return;
  }

  $('roomTag').textContent = `房间 ${state.code}`;
  $('meDot').style.setProperty('--c', SEAT_COLORS[me.seat]);
  $('meName').textContent = me.name;
  $('meColor').textContent = `${SEAT_NAMES[me.seat]} · 座位 ${me.seat + 1}`;

  renderStatus(me);
  renderRollArea(me);
  renderOptions(me);
  renderPlanes(me);
  renderPlayers(me);
  renderGyro();

  if (state.phase === 'finished') {
    renderWinner();
    showView('winner');
  } else {
    showView('game');
  }
}

function renderStatus(me) {
  const card = $('statusCard');
  const cur = currentPlayer();
  const myTurn = state.phase === 'playing' && state.turn === me.seat;
  let title = '';
  let sub = '';
  let color = SEAT_COLORS[me.seat];

  if (state.phase === 'lobby') {
    title = `已加入 · ${SEAT_NAMES[me.seat]}`;
    sub = window.isSecureContext
      ? '等大屏点「开始游戏」。可以先开启陀螺仪，试试摇一摇。'
      : '等大屏点「开始游戏」。当前是 HTTP，摇一摇需要 HTTPS，也可以直接点骰子。';
  } else if (myTurn) {
    color = SEAT_COLORS[me.seat];
    if (state.awaitingMove) {
      title = '选择要移动的飞机';
      sub = `掷出 ${state.dice} 点，点下面任意一架飞机。`;
    } else if (state.dice != null) {
      title = `掷出 ${state.dice} 点`;
      sub = '飞机正在移动…';
    } else {
      title = '轮到你掷骰子';
      sub = motionReady ? '摇一摇手机，或点骰子掷出点数。' : '点骰子掷出点数，也可以先开启陀螺仪。';
    }
  } else {
    color = SEAT_COLORS[state.turn] || SEAT_COLORS[me.seat];
    title = `等待 ${cur ? cur.name : '对手'}`;
    sub = state.awaitingMove ? '对手正在选择要移动的飞机。' : '对手正在掷骰子…';
  }

  card.style.setProperty('--c', color);
  card.classList.toggle('my-turn', myTurn);
  $('statusTitle').textContent = title;
  $('statusSub').textContent = sub;
}

function renderRollArea(me) {
  const playArea = $('playArea');
  const inLobby = state.phase === 'lobby';
  const myTurn = state.phase === 'playing' && state.turn === me.seat;
  const choosing = state.awaitingMove && myTurn;

  playArea.classList.toggle('hidden', inLobby || choosing);

  if (inLobby || choosing) return;

  const face = state.dice != null ? state.dice : state.lastDice || 1;
  if (!rollingNow) dieBtn.dataset.face = String(face);

  dieBtn.classList.toggle('myturn', canRoll());
  dieBtn.classList.toggle('dim', !myTurn);
  dieBtn.disabled = !canRoll();

  rollBtn.disabled = !canRoll();
  if (canRoll()) {
    rollBtn.textContent = '掷骰子';
    hintText.textContent = motionReady ? '摇一摇手机，或点骰子' : '点击骰子掷出点数';
  } else if (myTurn) {
    rollBtn.textContent = state.awaitingMove ? '请选择飞机' : '骰子转动中…';
    hintText.textContent = '稍等一下…';
  } else {
    const cur = currentPlayer();
    rollBtn.textContent = `等待 ${cur ? cur.name : '对手'} 掷骰`;
    hintText.textContent = '还没轮到你，先放松一下';
  }
}

function bonusLabel(bonuses) {
  if (!bonuses || !bonuses.length) return '';
  const b = bonuses[0];
  if (b.type === 'fly') return '飞行 +12';
  if (b.type === 'jump') return '跳跃 +4';
  return '';
}

function renderOptions(me) {
  const show = state.phase === 'playing' && state.awaitingMove && state.turn === me.seat;
  optionsEl.classList.toggle('hidden', !show);
  if (!show) {
    optionsList.innerHTML = '';
    return;
  }
  optionsHead.textContent = `掷出 ${state.dice} 点 · 选一架飞机移动`;
  optionsList.innerHTML = state.options
    .map((opt) => {
      const bonus = bonusLabel(opt.bonuses);
      const from = posLabel(opt.from);
      const to = opt.to === FlyChess.GOAL_T ? '终点' : posLabel(opt.to);
      const sub = opt.from === -1 ? '起飞，进入主航道' : `前进 ${opt.to - opt.from} 格`;
      return `
        <button class="move-opt" data-plane="${opt.plane}" style="--c:${SEAT_COLORS[me.seat]}">
          <span class="mo-plane">${opt.plane + 1}</span>
          <span class="mo-body">
            <span class="mo-desc">${from} → ${to}</span>
            <span class="mo-sub">${sub}</span>
          </span>
          ${bonus ? `<span class="mo-bonus">${bonus}</span>` : ''}
        </button>`;
    })
    .join('');
}

function renderPlanes(me) {
  const show = state.phase === 'playing';
  planesCard.classList.toggle('hidden', !show);
  if (!show) return;

  const positions = state.planes[me.seat] || [];
  const arrived = positions.filter((t) => t === FlyChess.GOAL_T).length;
  $('planesMeta').textContent = `${arrived} / 4 抵达`;
  $('planesList').innerHTML = positions
    .map(
      (t, i) => `
      <div class="plane-chip ${t === FlyChess.GOAL_T ? 'done' : ''}" style="--c:${SEAT_COLORS[me.seat]}">
        <span class="pc-num">${i + 1}</span>
        <span class="pc-pos">${posLabel(t)}</span>
      </div>`
    )
    .join('');
}

function renderPlayers(me) {
  const rows = [];
  for (let seat = 0; seat < 4; seat += 1) {
    const p = state.players.find((x) => x.seat === seat);
    if (!p) {
      rows.push(`
        <div class="mini-row" style="--c:#64748b">
          <span class="mini-dot"></span>
          <span class="mini-name" style="color:#5b6b86">空位 · ${SEAT_NAMES[seat]}</span>
          <span class="mini-state">待加入</span>
        </div>`);
      continue;
    }
    const isTurn = state.phase === 'playing' && state.turn === seat;
    rows.push(`
      <div class="mini-row" style="--c:${SEAT_COLORS[seat]}">
        <span class="mini-dot"></span>
        <span class="mini-name">${escapeHtml(p.name)}${seat === me.seat ? '（你）' : ''}</span>
        <span class="mini-state ${isTurn ? 'turn' : ''}">${
          isTurn ? '行动中' : p.connected ? '在线' : '离线'
        }</span>
      </div>`);
  }
  $('playersMini').innerHTML = rows.join('');
}

function renderWinner() {
  const w = state.players.find((p) => p.seat === state.winner);
  const mySeatIndex = mySeat();
  const name = w ? w.name : SEAT_NAMES[state.winner] || '赢家';
  $('winnerTitle').textContent = `${name} 获胜`;
  $('winnerTitle').style.color = SEAT_COLORS[state.winner] || '#fbbf24';
  $('winnerSub').textContent =
    mySeatIndex === state.winner ? '恭喜，你的四架飞机全部抵达终点' : '四架飞机全部抵达终点';
}

function renderGyro() {
  const btn = $('gyroBtn');
  btn.classList.remove('on', 'warn');
  if (motionReady) {
    btn.textContent = '陀螺仪已开启';
    btn.classList.add('on');
    return;
  }
  if (!window.isSecureContext) {
    btn.textContent = '需 HTTPS 摇一摇';
    btn.classList.add('warn');
    return;
  }
  if (!('DeviceMotionEvent' in window)) {
    btn.textContent = '设备不支持陀螺仪';
    btn.classList.add('warn');
    return;
  }
  btn.textContent = '开启陀螺仪';
}

/* ------------------------------------------------------------------ */
/* 陀螺仪 / 摇一摇                                                    */
/* ------------------------------------------------------------------ */

function attachMotion() {
  if (motionHandler) return;
  motionHandler = (e) => {
    let strength = 0;
    const a = e.acceleration;
    if (a && (a.x != null || a.y != null || a.z != null)) {
      strength = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    } else if (e.accelerationIncludingGravity) {
      const g = e.accelerationIncludingGravity;
      const mag = Math.sqrt((g.x || 0) ** 2 + (g.y || 0) ** 2 + (g.z || 0) ** 2);
      if (motionBaseline == null) {
        motionBaseline = mag;
        return;
      }
      motionBaseline = motionBaseline * 0.9 + mag * 0.1;
      strength = Math.abs(mag - motionBaseline) * 2.4;
    } else {
      return;
    }

    const now = Date.now();
    if (strength > 13 && now - motionLast > 1000) {
      motionLast = now;
      onShake();
    }
  };
  window.addEventListener('devicemotion', motionHandler, { passive: true });
}

function autoInitMotion() {
  if (motionReady) return;
  if (!window.isSecureContext) return;
  if (!('DeviceMotionEvent' in window)) return;
  if (typeof DeviceMotionEvent.requestPermission === 'function') return; // iOS 需要用户手势
  attachMotion();
  motionReady = true;
  renderGyro();
}

async function enableGyro() {
  if (motionReady) {
    toast('陀螺仪已开启，摇一摇手机即可');
    return;
  }
  if (!('DeviceMotionEvent' in window)) {
    toast('这台设备不支持陀螺仪，点骰子也能掷');
    return;
  }
  if (!window.isSecureContext) {
    toast('需要 HTTPS 才能读取陀螺仪，点骰子也能掷');
    return;
  }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') {
        toast('没有拿到运动传感器权限');
        return;
      }
    }
    attachMotion();
    motionReady = true;
    renderGyro();
    toast('陀螺仪已开启，摇一摇试试');
    vibrate(25);
  } catch {
    toast('开启失败，请改用按钮掷骰子');
  }
}

function onShake() {
  if (!joined) return;
  if (!canRoll()) return;
  vibrate(40);
  toast('检测到摇动，掷骰子');
  doRoll();
}

/* ------------------------------------------------------------------ */
/* 掷骰 / 选棋                                                        */
/* ------------------------------------------------------------------ */

function animateDie(ms) {
  return new Promise((resolve) => {
    dieBtn.classList.add('rolling');
    const iv = setInterval(() => {
      dieBtn.dataset.face = String(1 + Math.floor(Math.random() * 6));
    }, 70);
    setTimeout(() => {
      clearInterval(iv);
      dieBtn.classList.remove('rolling');
      resolve();
    }, ms);
  });
}

async function doRoll() {
  if (!canRoll() || rollingNow) return;
  rollingNow = true;
  renderRollArea(mePlayer() || { seat: mySeat() });
  const anim = animateDie(660);
  const res = await emitAck('player:roll');
  await anim;
  rollingNow = false;
  if (res && res.error) toast(res.error);
  render();
}

async function doMove(plane) {
  if (moving) return;
  moving = true;
  renderOptions(mePlayer() || { seat: mySeat() });
  optionsList.querySelectorAll('button').forEach((b) => {
    b.disabled = true;
  });
  const res = await emitAck('player:move', { plane });
  moving = false;
  if (res && res.error) toast(res.error);
  render();
}

/* ------------------------------------------------------------------ */
/* 状态同步                                                           */
/* ------------------------------------------------------------------ */

function onState(s) {
  if (!s || !s.code) return;
  state = s;

  if (joined) {
    const seat = mySeat();
    const myTurnNow = s.phase === 'playing' && seat != null && s.turn === seat;
    const key = `${s.code}:${s.round}:${s.turn}:${s.phase === 'playing'}`;
    if (myTurnNow && lastEnteredTurn !== key) {
      lastEnteredTurn = key;
      vibrate([30, 50, 30]);
    }
    if (!myTurnNow) lastEnteredTurn = key;
    render();
  }
}

function showJoinScreen() {
  showView('join');
  codeInput.value = roomCode || normalizeCode(new URLSearchParams(location.search).get('room') || '');
  nameInput.value = store.get('flychess:name') || '';
}

/* ------------------------------------------------------------------ */
/* 初始化与事件                                                       */
/* ------------------------------------------------------------------ */

socket.on('connect', () => {
  if (joined && playerId) {
    join({ silent: true });
    return;
  }
  if (!autoJoinTried) {
    autoJoinTried = true;
    const urlRoom = normalizeCode(new URLSearchParams(location.search).get('room') || '');
    const savedRoom = normalizeCode(store.get('flychess:room') || '');
    const code = urlRoom || savedRoom;
    const name = store.get('flychess:name');
    if (code && name && store.get(pidKey(code))) {
      roomCode = code;
      codeInput.value = code;
      nameInput.value = name;
      join({ silent: true });
    }
  }
});

socket.on('game:state', onState);
socket.on('disconnect', () => {
  if (joined) toast('连接断开，正在重连…');
});

codeInput.addEventListener('input', () => {
  codeInput.value = normalizeCode(codeInput.value);
});

$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  join();
});

dieBtn.addEventListener('click', () => {
  if (canRoll()) doRoll();
});

rollBtn.addEventListener('click', () => {
  if (canRoll()) doRoll();
});

$('gyroBtn').addEventListener('click', () => {
  enableGyro();
});

optionsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-plane]');
  if (!btn || btn.disabled) return;
  doMove(Number(btn.dataset.plane));
});

function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

(function init() {
  const params = new URLSearchParams(location.search);
  const urlRoom = normalizeCode(params.get('room') || '');
  const savedRoom = normalizeCode(store.get('flychess:room') || '');
  roomCode = urlRoom || savedRoom;
  codeInput.value = roomCode;
  nameInput.value = store.get('flychess:name') || '';
  showJoinScreen();
  renderGyro();
  requestWakeLock();
})();
