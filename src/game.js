'use strict';

/**
 * 飞行棋规则引擎（与网络层解耦，方便单测）
 *
 * 位置编码（每个玩家 4 架飞机）：
 *   -1        机库（未起飞）
 *   0..50     主航道（环形 52 格中的 51 格，起点为 0）
 *   51..55    归航跑道
 *   56        终点
 */

const COLORS = ['red', 'yellow', 'blue', 'green'];
const COLOR_NAMES = { red: '红队', yellow: '黄队', blue: '蓝队', green: '绿队' };
const COLOR_HEX = { red: '#ef4444', yellow: '#f59e0b', blue: '#3b82f6', green: '#22c55e' };

// 传统飞行棋外圈：52 格，14×14 棋盘最外环，从红队起飞格 (4,0) 顺时针
const RING = [
  [4, 0], [3, 0], [2, 0], [1, 0], [0, 0],
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
  [0, 9], [0, 10], [0, 11], [0, 12], [0, 13],
  [1, 13], [2, 13], [3, 13], [4, 13], [5, 13], [6, 13], [7, 13], [8, 13],
  [9, 13], [10, 13], [11, 13], [12, 13], [13, 13],
  [13, 12], [13, 11], [13, 10], [13, 9], [13, 8], [13, 7], [13, 6], [13, 5],
  [13, 4], [13, 3], [13, 2], [13, 1], [13, 0],
  [12, 0], [11, 0], [10, 0], [9, 0], [8, 0], [7, 0], [6, 0], [5, 0],
];

// 每队归航跑道（5 格），从外圈通向中心
const HOME = [
  [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[12, 6], [11, 6], [10, 6], [9, 6], [8, 6]],
];

// 机库里 4 个停机位的棋盘坐标（行、列，单位：格）
const BASE_SLOTS = [
  [[1.85, 1.85], [1.85, 4.15], [4.15, 1.85], [4.15, 4.15]],
  [[1.85, 8.85], [1.85, 11.15], [4.15, 8.85], [4.15, 11.15]],
  [[8.85, 8.85], [8.85, 11.15], [11.15, 8.85], [11.15, 11.15]],
  [[8.85, 1.85], [8.85, 4.15], [11.15, 1.85], [11.15, 4.15]],
];

// 终点区域 4 个位置的偏移（中心 2×2）
const GOAL_SLOTS = [[-0.2, -0.2], [-0.2, 0.2], [0.2, -0.2], [0.2, 0.2]];

const TRACK_LAST = 50;
const GOAL_T = 56;
const MAX_PLAYERS = 4;
const START_STEP = 13;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randInt = (n) => Math.floor(Math.random() * n);
const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i += 1) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

function sanitizeName(raw, fallback) {
  const name = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 12);
  return name || fallback;
}

/** 玩家 seat 的第 t 步落在环形航道的第几格 */
function ringIndexOf(seat, t) {
  return (seat * START_STEP + t) % RING.length;
}

/** 格子颜色 = 环形下标 % 4，正好与四位玩家的起飞点对齐 */
function cellSeat(ringIdx) {
  return ringIdx % 4;
}

/** 飞机格（可飞 12 格）：每队各两格 */
function isFlyCell(ringIdx) {
  return ringIdx % 13 === 5 || ringIdx % 13 === 11;
}

function isJumpCell(seat, ringIdx) {
  return cellSeat(ringIdx) === seat && !isFlyCell(ringIdx);
}

function createRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    players: [],
    planes: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
    phase: 'lobby', // lobby | playing | finished
    turn: 0,
    dice: null,
    lastDice: null,
    options: [],
    awaitingMove: false,
    winner: null,
    log: [],
    logSeq: 1,
    lastMove: null,
    seq: 0,
    round: 0,
    timers: [],
  };
}

function addPlayer(room, { id, name }) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const seat = room.players.length;
  const player = {
    id: id || randId(),
    name: sanitizeName(name, `${COLOR_NAMES[COLORS[seat]]}玩家`),
    color: COLORS[seat],
    seat,
    connected: true,
    socketId: null,
    joinedAt: Date.now(),
  };
  room.players.push(player);
  room.lastActive = Date.now();
  return player;
}

function removePlayer(room, seat) {
  const p = room.players[seat];
  if (!p) return;
  room.players.splice(seat, 1);
  room.players.forEach((pl, i) => {
    pl.seat = i;
    pl.color = COLORS[i];
  });
  room.planes.push(room.planes.splice(seat, 1)[0]);
  for (let s = 0; s < room.planes.length; s += 1) {
    if (s >= room.players.length) room.planes[s] = [-1, -1, -1, -1];
  }
  room.turn = 0;
}

function clearTimers(room) {
  room.timers.forEach((t) => clearTimeout(t));
  room.timers = [];
}

function later(room, fn, ms) {
  const id = setTimeout(() => {
    room.timers = room.timers.filter((t) => t !== id);
    try {
      fn();
    } catch (err) {
      console.error('[timer]', err);
    }
  }, ms);
  room.timers.push(id);
  return id;
}

function pushLog(room, text, meta) {
  room.log.push({
    id: room.logSeq++,
    t: Date.now(),
    text,
    ...(meta || {}),
  });
  if (room.log.length > 80) room.log.splice(0, room.log.length - 80);
}

/**
 * 计算一次移动的结果。
 * @returns {{to:number, bonuses:Array<{type:'fly'|'jump', from:number, to:number}>}|null}
 */
function resolveMove(seat, t, dice) {
  if (t === -1) {
    if (dice !== 6) return null;
    return { to: 0, bonuses: [] };
  }
  if (t >= GOAL_T) return null;
  let to = t + dice;
  if (to > GOAL_T) return null;

  const bonuses = [];
  if (to <= TRACK_LAST) {
    const ring = ringIndexOf(seat, to);
    if (cellSeat(ring) === seat) {
      if (isFlyCell(ring)) {
        if (to + 12 <= TRACK_LAST) {
          bonuses.push({ type: 'fly', from: to, to: to + 12 });
          to += 12;
        }
      } else if (to + 4 <= TRACK_LAST) {
        bonuses.push({ type: 'jump', from: to, to: to + 4 });
        to += 4;
      }
    }
  }
  return { to, bonuses };
}

function legalMoves(room, seat, dice) {
  const moves = [];
  room.planes[seat].forEach((t, plane) => {
    const res = resolveMove(seat, t, dice);
    if (!res) return;
    moves.push({ plane, from: t, to: res.to, bonuses: res.bonuses });
  });
  return moves;
}

/**
 * 执行移动，返回本回合的结构化结果（含被撞回的飞机）。
 */
function applyMove(room, seat, plane, option) {
  const planes = room.planes[seat];
  const from = planes[plane];
  planes[plane] = option.to;

  const captures = [];
  if (option.to <= TRACK_LAST) {
    const ring = ringIndexOf(seat, option.to);
    for (let q = 0; q < room.players.length; q += 1) {
      if (q === seat) continue;
      room.planes[q].forEach((pt, j) => {
        if (pt >= 0 && pt <= TRACK_LAST && ringIndexOf(q, pt) === ring) {
          room.planes[q][j] = -1;
          captures.push({ seat: q, plane: j });
        }
      });
    }
  }

  const player = room.players[seat];
  const name = player ? player.name : COLOR_NAMES[COLORS[seat]];
  const colorName = COLOR_NAMES[COLORS[seat]];

  if (from === -1) {
    pushLog(room, `${name} 的 ${plane + 1} 号机起飞`, { seat, type: 'takeoff' });
  } else {
    pushLog(room, `${name} 的 ${plane + 1} 号机前进 ${option.to - from} 格`, { seat, type: 'move' });
  }
  option.bonuses.forEach((b) => {
    if (b.type === 'fly') pushLog(room, `${name} 命中飞机格，沿虚线飞 12 格`, { seat, type: 'fly' });
    if (b.type === 'jump') pushLog(room, `${name} 落到本色格，跳跃 4 格`, { seat, type: 'jump' });
  });
  captures.forEach((c) => {
    const victim = room.players[c.seat];
    pushLog(room, `${name} 撞回了 ${victim ? victim.name : colorName} 的 1 架飞机`, {
      seat,
      type: 'capture',
    });
  });

  if (option.to === GOAL_T) {
    pushLog(room, `${name} 的 ${plane + 1} 号机抵达终点`, { seat, type: 'goal' });
  }

  let winner = null;
  if (planes.every((t) => t === GOAL_T)) {
    room.phase = 'finished';
    room.winner = seat;
    winner = seat;
    pushLog(room, `${name} 四机全部到达终点，获得胜利！`, { seat, type: 'win' });
  }

  const result = {
    seat,
    plane,
    from,
    to: option.to,
    bonuses: option.bonuses,
    captures,
    winner,
    dice: room.lastDice,
  };
  room.lastMove = result;
  return result;
}

function rollDice() {
  return 1 + randInt(6);
}

function startGame(room) {
  clearTimers(room);
  room.planes = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
  room.phase = 'playing';
  room.turn = 0;
  room.dice = null;
  room.lastDice = null;
  room.options = [];
  room.awaitingMove = false;
  room.winner = null;
  room.lastMove = null;
  room.round += 1;
  pushLog(room, `第 ${room.round} 局开始，${room.players[0] ? room.players[0].name : '红队'} 先手`, {
    type: 'start',
  });
}

function beginTurn(room) {
  clearTimers(room);
  room.dice = null;
  room.options = [];
  room.awaitingMove = false;
  room.lastMove = null;
  room.lastActive = Date.now();
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    turn: room.turn,
    dice: room.dice,
    lastDice: room.lastDice,
    options: room.awaitingMove ? room.options : [],
    awaitingMove: room.awaitingMove,
    winner: room.winner,
    round: room.round,
    seq: room.seq,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      seat: p.seat,
      connected: p.connected,
    })),
    planes: room.planes.map((a) => a.slice()),
    log: room.log.slice(-40),
    lastMove: room.lastMove,
    serverNow: Date.now(),
  };
}

module.exports = {
  COLORS,
  COLOR_NAMES,
  COLOR_HEX,
  RING,
  HOME,
  BASE_SLOTS,
  GOAL_SLOTS,
  TRACK_LAST,
  GOAL_T,
  MAX_PLAYERS,
  START_STEP,
  createRoom,
  addPlayer,
  removePlayer,
  sanitizeName,
  makeCode,
  randId,
  ringIndexOf,
  cellSeat,
  isFlyCell,
  isJumpCell,
  resolveMove,
  legalMoves,
  applyMove,
  rollDice,
  startGame,
  beginTurn,
  clearTimers,
  later,
  pushLog,
  publicState,
};
