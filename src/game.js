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

const COLORS = ['yellow', 'blue', 'red', 'green'];
const COLOR_NAMES = { red: '红队', yellow: '黄队', blue: '蓝队', green: '绿队' };
const COLOR_HEX = { red: '#ef4444', yellow: '#f59e0b', blue: '#3b82f6', green: '#22c55e' };

// 复刻 netmanfisher/chinese-ludo 的 600×600 棋盘路线（MIT）
const RING = [
  [212, 91], [198, 122], [198, 151], [212, 183], [184, 209],
  [150, 195], [120, 196], [86, 209], [74, 241], [74, 270],
  [75, 300], [75, 330], [74, 358], [86, 390], [119, 404],
  [150, 404], [184, 390], [212, 416], [198, 448], [198, 477],
  [212, 508], [244, 519], [276, 518], [307, 520], [336, 519],
  [366, 519], [399, 508], [413, 477], [413, 447], [400, 416],
  [428, 391], [461, 405], [491, 404], [526, 390], [536, 358],
  [537, 328], [537, 299], [537, 270], [536, 239], [526, 210],
  [491, 195], [460, 196], [427, 210], [398, 182], [413, 151],
  [413, 122], [399, 90], [366, 81], [335, 79], [305, 80],
  [275, 80], [245, 82],
];

// 每队 5 格归航跑道（主航道入口之后的 5 格）
const HOME = [
  [[305, 123], [305, 152], [305, 181], [305, 211], [305, 240]],
  [[118, 300], [150, 300], [181, 300], [211, 300], [242, 300]],
  [[305, 477], [305, 448], [305, 418], [306, 389], [306, 359]],
  [[492, 300], [461, 299], [430, 300], [399, 299], [369, 299]],
];

// 四角机库里的 4 个停机位
const BASE_SLOTS = [
  [[45, 44], [45, 100], [98, 45], [96, 98]],
  [[44, 500], [45, 553], [98, 500], [99, 555]],
  [[501, 501], [503, 555], [554, 501], [554, 554]],
  [[501, 45], [501, 97], [554, 44], [554, 98]],
];

// 中心终点
const GOAL_CENTER = [[306, 274], [278, 300], [306, 325], [333, 300]];

// 特殊天气格（按环形下标）
const TYPHOON_CELLS = [6, 19, 32, 45];
const LIGHTNING_CELLS = [10, 23, 36, 49];

// 各队飞行捷径触发格（+12）
const FLY_TRIGGERS = [17, 30, 43, 4];
// 环形格颜色：0 绿、1 黄、2 蓝、3 红，映射到座位
const CELL_SEAT = [3, 0, 1, 2];

const DEFAULT_RULES = {
  weather: true,
  stackMove: false,
  takeoffFive: false,
  endMode: 'first', // first | rank
  botLevel: 'normal', // easy | normal | hard
};

const TRACK_LAST = 49;
const GOAL_T = 55;
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

/** 格子颜色 = 环形下标 % 4（0 绿、1 黄、2 蓝、3 红），映射到座位 */
function cellSeat(ringIdx) {
  return CELL_SEAT[ringIdx % 4];
}

/** 该格是否是某队的飞行捷径触发格 */
function isFlyCell(ringIdx) {
  return FLY_TRIGGERS.includes(ringIdx);
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
    rules: { ...DEFAULT_RULES },
    finishOrder: [],
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

function addPlayer(room, { id, name, isBot }) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const seat = room.players.length;
  const player = {
    id: id || randId(),
    name: sanitizeName(name, `${COLOR_NAMES[COLORS[seat]]}玩家`),
    color: COLORS[seat],
    seat,
    connected: true,
    isBot: Boolean(isBot),
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
function resolveMove(seat, t, dice, rules) {
  if (t === -1) {
    const canTakeoff = dice === 6 || Boolean(rules && rules.takeoffFive && dice === 5);
    if (!canTakeoff) return null;
    return { to: 0, bonuses: [] };
  }
  if (t >= GOAL_T) return null;
  let to = t + dice;
  if (to > GOAL_T) return null;

  const bonuses = [];
  if (to <= TRACK_LAST) {
    const ring = ringIndexOf(seat, to);
    if (ring === FLY_TRIGGERS[seat]) {
      if (to + 12 <= TRACK_LAST) {
        bonuses.push({ type: 'fly', from: to, to: to + 12 });
        to += 12;
      }
    } else if (cellSeat(ring) === seat) {
      if (to + 4 <= TRACK_LAST) {
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
    const res = resolveMove(seat, t, dice, room.rules);
    if (!res) return;
    const group =
      room.rules && room.rules.stackMove && t >= 0
        ? room.planes[seat].filter((pt) => pt === t).length
        : 1;
    moves.push({ plane, from: t, to: res.to, bonuses: res.bonuses, group });
  });
  return moves;
}

function weatherAt(ringIdx) {
  if (TYPHOON_CELLS.includes(ringIdx)) return 'typhoon';
  if (LIGHTNING_CELLS.includes(ringIdx)) return 'lightning';
  return '';
}

/** 把 seat 在位置 t 的落点上的对手全部撞回停机坪 */
function captureAt(room, seat, t, captures) {
  if (t < 0 || t > TRACK_LAST) return;
  const ring = ringIndexOf(seat, t);
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

/**
 * 执行移动，返回本回合的结构化结果（含被撞回的飞机）。
 * groupPlanes 用于“叠子一起走”：把同格的己方飞机一起移动。
 */
function applyMove(room, seat, plane, option, groupPlanes) {
  const planes = room.planes[seat];
  const group = Array.isArray(groupPlanes) && groupPlanes.length ? groupPlanes : [plane];
  const from = planes[plane];
  group.forEach((pi) => {
    planes[pi] = option.to;
  });

  const captures = [];
  if (option.to <= TRACK_LAST) captureAt(room, seat, option.to, captures);

  const player = room.players[seat];
  const name = player ? player.name : COLOR_NAMES[COLORS[seat]];
  const colorName = COLOR_NAMES[COLORS[seat]];

  if (from === -1) {
    pushLog(room, `${name} 的 ${plane + 1} 号机起飞`, { seat, type: 'takeoff' });
  } else if (group.length > 1) {
    pushLog(room, `${name} 的 ${group.length} 架飞机一起前进 ${option.to - from} 格`, {
      seat,
      type: 'move',
    });
  } else {
    pushLog(room, `${name} 的 ${plane + 1} 号机前进 ${option.to - from} 格`, { seat, type: 'move' });
  }
  option.bonuses.forEach((b) => {
    if (b.type === 'fly') pushLog(room, `${name} 命中飞机格，沿虚线飞 12 格`, { seat, type: 'fly' });
    if (b.type === 'jump') pushLog(room, `${name} 落到本色格，跳跃 4 格`, { seat, type: 'jump' });
  });

  // 特殊天气：台风随机吹走，雷电劈回停机坪
  let weather = '';
  if (room.rules && room.rules.weather && option.to <= TRACK_LAST) {
    weather = weatherAt(ringIndexOf(seat, option.to));
    if (weather === 'lightning') {
      group.forEach((pi) => {
        planes[pi] = -1;
        pushLog(room, `${name} 的 ${pi + 1} 号机被雷电劈回停机坪`, { seat, type: 'weather' });
      });
    } else if (weather === 'typhoon') {
      group.forEach((pi) => {
        let nt = randInt(TRACK_LAST + 1);
        if (nt === option.to) nt = (nt + 1) % (TRACK_LAST + 1);
        planes[pi] = nt;
        captureAt(room, seat, nt, captures);
        pushLog(room, `${name} 的 ${pi + 1} 号机被台风吹到航道 ${nt + 1}`, {
          seat,
          type: 'weather',
        });
      });
    }
  }

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
  const allDone = planes.every((t) => t === GOAL_T);
  let finishedPlayer = false;
  if (allDone && !room.finishOrder.includes(seat)) {
    room.finishOrder.push(seat);
    finishedPlayer = true;
    if (room.rules.endMode === 'rank') {
      pushLog(room, `${name} 第 ${room.finishOrder.length} 名完赛`, { seat, type: 'rank' });
    }
  }

  if (allDone) {
    if (room.rules.endMode !== 'rank') {
      room.phase = 'finished';
      room.winner = seat;
      winner = seat;
      pushLog(room, `${name} 四机全部到达终点，获得胜利！`, { seat, type: 'win' });
    } else if (room.finishOrder.length >= room.players.length - 1) {
      room.players.forEach((p, i) => {
        if (room.finishOrder.includes(i)) return;
        room.finishOrder.push(i);
        pushLog(room, `${p.name} 第 ${room.finishOrder.length} 名`, { seat: i, type: 'rank' });
      });
      room.phase = 'finished';
      room.winner = room.finishOrder[0];
      winner = room.winner;
      const champ = room.players[room.winner];
      pushLog(room, `比赛结束，${champ ? champ.name : ''} 获得冠军！`, {
        seat: room.winner,
        type: 'win',
      });
    }
  }

  const result = {
    seat,
    plane,
    from,
    to: option.to,
    bonuses: option.bonuses,
    captures,
    weather,
    group,
    winner,
    finishedPlayer,
    dice: room.lastDice,
  };
  room.lastMove = result;
  return result;
}

function rollDice() {
  return 1 + randInt(6);
}

/** 电脑策略：按难度选择走法 */
function pickBotMove(room, seat, options) {
  if (!options || !options.length) return null;
  const level = (room.rules && room.rules.botLevel) || 'normal';
  if (level === 'easy') {
    return options[Math.floor(Math.random() * options.length)];
  }

  let best = null;
  let bestScore = -Infinity;

  options.forEach((opt) => {
    let score = opt.to;
    if (opt.to === GOAL_T) score += 600;
    if (opt.from === -1) score += 120;
    (opt.bonuses || []).forEach((bonus) => {
      if (bonus.type === 'fly') score += 90;
      if (bonus.type === 'jump') score += 50;
    });
    if (opt.to <= TRACK_LAST) {
      const ring = ringIndexOf(seat, opt.to);
      let enemies = 0;
      for (let q = 0; q < room.players.length; q += 1) {
        if (q === seat) continue;
        (room.planes[q] || []).forEach((pt) => {
          if (pt >= 0 && pt <= TRACK_LAST && ringIndexOf(q, pt) === ring) enemies += 1;
        });
      }
      if (enemies > 0) score += 400 * enemies;

      if (level === 'hard') {
        // 避开对手 1-6 步可到达的落点
        let threats = 0;
        for (let q = 0; q < room.players.length; q += 1) {
          if (q === seat) continue;
          (room.planes[q] || []).forEach((pt) => {
            if (pt < 0 || pt > TRACK_LAST) return;
            const step = (ring - ringIndexOf(q, pt) + RING.length) % RING.length;
            if (step >= 1 && step <= 6 && pt + step <= TRACK_LAST) threats += 1;
          });
        }
        if (threats > 0) score -= 35 * threats;

        if (room.rules.weather) {
          const zone = weatherAt(ring);
          if (zone === 'lightning') score -= 80;
          if (zone === 'typhoon') score -= 20;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  });

  return best;
}

/** 按座位顺序找下一个还没完赛的玩家 */
function nextSeat(room) {
  const n = room.players.length;
  if (!n) return 0;
  for (let i = 1; i <= n; i += 1) {
    const s = (room.turn + i) % n;
    if (!room.players[s]) continue;
    if (room.rules.endMode === 'rank' && room.finishOrder.includes(s)) continue;
    return s;
  }
  return room.turn;
}

function startGame(room) {
  clearTimers(room);
  room.planes = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
  room.finishOrder = [];
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
    rules: { ...room.rules },
    finishOrder: [...room.finishOrder],
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
      isBot: Boolean(p.isBot),
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
  GOAL_CENTER,
  GOAL_T,
  TRACK_LAST,
  MAX_PLAYERS,
  START_STEP,
  FLY_TRIGGERS,
  DEFAULT_RULES,
  TYPHOON_CELLS,
  LIGHTNING_CELLS,
  weatherAt,
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
  pickBotMove,
  nextSeat,
  rollDice,
  startGame,
  beginTurn,
  clearTimers,
  later,
  pushLog,
  publicState,
};
