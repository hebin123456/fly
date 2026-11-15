'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const G = require('../src/game');

function roomWithPlayers(n = 4) {
  const room = G.createRoom('TEST');
  for (let i = 0; i < n; i += 1) {
    G.addPlayer(room, { id: `p${i}`, name: `玩家${i + 1}` });
  }
  return room;
}

test('棋盘：52 格航道坐标唯一，四队起飞点间隔 13 格', () => {
  assert.equal(G.RING.length, 52);
  assert.equal(new Set(G.RING.map(([r, c]) => `${r},${c}`)).size, 52);
  for (let seat = 0; seat < 4; seat += 1) {
    assert.equal(G.ringIndexOf(seat, 0), seat * 13);
  }
  // 环形格颜色 0 绿、1 黄、2 蓝、3 红 → 座位 3/0/1/2
  assert.deepEqual([0, 1, 2, 3].map((i) => G.cellSeat(i)), [3, 0, 1, 2]);
  // 每队最后一格紧邻自己的归航跑道入口
  for (let seat = 0; seat < 4; seat += 1) {
    const [r, c] = G.RING[G.ringIndexOf(seat, G.TRACK_LAST)];
    const [hr, hc] = G.HOME[seat][0];
    assert.ok(Math.hypot(r - hr, c - hc) < 60, `seat ${seat} 未与归航跑道相邻`);
  }
});

test('起飞：停机坪上的飞机只有掷出 6 才能起飞', () => {
  assert.equal(G.resolveMove(0, -1, 5), null);
  assert.deepEqual(G.resolveMove(0, -1, 6), { to: 0, bonuses: [] });
});

test('移动：超过终点不允许移动', () => {
  assert.equal(G.resolveMove(0, G.GOAL_T, 2), null);
  assert.deepEqual(G.resolveMove(0, G.GOAL_T - 1, 1), { to: G.GOAL_T, bonuses: [] });
  assert.equal(G.resolveMove(0, G.GOAL_T, 1), null);
});

test('跳跃：落在自己颜色的格子前进 4 格', () => {
  // seat 0 黄色，t=4 掷 1 → 落在 t=5（环形 5 格，黄色），跳 4 → t=9
  const res = G.resolveMove(0, 4, 1);
  assert.ok(res);
  assert.equal(res.to, 9);
  assert.equal(res.bonuses.length, 1);
  assert.equal(res.bonuses[0].type, 'jump');
});

test('飞行：落在本队捷径触发格飞 12 格', () => {
  // seat 0 黄色，t=16 掷 1 → 落在 t=17（黄色捷径），飞 12 → t=29
  const res = G.resolveMove(0, 16, 1);
  assert.ok(res);
  assert.equal(res.to, 29);
  assert.equal(res.bonuses[0].type, 'fly');
});

test('撞子：落到对手飞机所在格，对手回停机坪', () => {
  const room = roomWithPlayers(2);
  room.rules.weather = false;
  room.planes[0][0] = 9;
  // seat 1 的 t=49 → 环 10 格，与 seat 0 的 t=10 同格
  room.planes[1][0] = 49;
  assert.equal(G.ringIndexOf(0, 10), G.ringIndexOf(1, 49));
  const result = G.applyMove(room, 0, 0, { to: 10, bonuses: [] });
  assert.equal(room.planes[0][0], 10);
  assert.equal(room.planes[1][0], -1);
  assert.equal(result.captures.length, 1);
  assert.equal(result.captures[0].seat, 1);
});

test('撞子：自己的飞机可以叠放在同一格', () => {
  const room = roomWithPlayers(2);
  room.planes[0][0] = 10;
  room.planes[0][1] = 11;
  room.planes[0][2] = 9;
  const result = G.applyMove(room, 0, 2, { to: 11, bonuses: [] });
  assert.equal(room.planes[0][2], 11);
  assert.equal(result.captures.length, 0);
  assert.equal(room.planes[0][0], 10);
});

test('胜负：四架飞机全部到达终点即获胜', () => {
  const room = roomWithPlayers(2);
  G.startGame(room);
  room.planes[0] = [55, 55, 55, 54];
  room.planes[2] = [10, 10, 10, 10];
  const result = G.applyMove(room, 0, 3, { to: 55, bonuses: [] });
  assert.equal(result.winner, 0);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 0);
});

test('可选走法：机库飞机只在掷 6 时出现，且不会越过终点', () => {
  const room = roomWithPlayers(2);
  room.planes[0] = [-1, 10, 54, 55];
  const moves = G.legalMoves(room, 0, 6);
  assert.ok(moves.some((m) => m.plane === 0 && m.from === -1 && m.to === 0));
  assert.ok(moves.some((m) => m.plane === 1));
  assert.ok(!moves.some((m) => m.plane === 2));
  assert.ok(!moves.some((m) => m.plane === 3));
});

test('可选走法：掷 1 时只能移动能走的飞机', () => {
  const room = roomWithPlayers(2);
  room.planes[0] = [-1, 10, 54, 55];
  const moves = G.legalMoves(room, 0, 3);
  assert.deepEqual(moves.map((m) => m.plane), [1]);
});

test('环形航道：每格被 3 或 4 支队伍经过，跳过格正好 8 个', () => {
  const counts = new Array(52).fill(0);
  for (let seat = 0; seat < 4; seat += 1) {
    for (let t = 0; t <= G.TRACK_LAST; t += 1) {
      counts[G.ringIndexOf(seat, t)] += 1;
    }
  }
  assert.deepEqual([...new Set(counts)].sort(), [3, 4]);
  assert.equal(counts.filter((c) => c === 3).length, 8);
});

test('电脑走子：优先撞子', () => {
  const room = roomWithPlayers(2);
  room.planes[0][0] = 9;
  room.planes[1][0] = 49; // 环 10 格，与 seat 0 的 t=10 同格
  const options = [
    { plane: 1, from: -1, to: 0, bonuses: [] },
    { plane: 0, from: 9, to: 10, bonuses: [] },
  ];
  assert.equal(G.pickBotMove(room, 0, options).plane, 0);
});

test('电脑走子：优先到达终点', () => {
  const room = roomWithPlayers(2);
  room.planes[0] = [10, 54, -1, -1];
  const options = [
    { plane: 0, from: 10, to: 16, bonuses: [] },
    { plane: 1, from: 54, to: 55, bonuses: [] },
  ];
  assert.equal(G.pickBotMove(room, 0, options).plane, 1);
});

test('规则：开启 5 点起飞后，掷 5 也能起飞', () => {
  assert.deepEqual(G.resolveMove(0, -1, 5, { takeoffFive: true }), { to: 0, bonuses: [] });
  assert.equal(G.resolveMove(0, -1, 5, { takeoffFive: false }), null);
  const room = roomWithPlayers(2);
  room.rules.takeoffFive = true;
  assert.equal(G.legalMoves(room, 0, 5).length, 4);
});

test('规则：叠子一起走时，同格飞机一起移动', () => {
  const room = roomWithPlayers(2);
  room.rules.stackMove = true;
  room.planes[0] = [10, 10, -1, -1];
  const moves = G.legalMoves(room, 0, 1);
  assert.ok(moves.filter((m) => m.from === 10).every((m) => m.group === 2));
  G.applyMove(room, 0, 0, { to: 11, bonuses: [] }, [0, 1]);
  assert.equal(room.planes[0][0], 11);
  assert.equal(room.planes[0][1], 11);
});

test('天气：雷电格会把飞机劈回停机坪', () => {
  const room = roomWithPlayers(2);
  room.rules.weather = true;
  room.planes[0][0] = 9;
  assert.equal(G.weatherAt(G.ringIndexOf(0, 10)), 'lightning');
  G.applyMove(room, 0, 0, { to: 10, bonuses: [] });
  assert.equal(room.planes[0][0], -1);
});

test('天气：台风把飞机吹到其他航道', () => {
  const room = roomWithPlayers(2);
  room.rules.weather = true;
  room.planes[0][0] = 5;
  assert.equal(G.weatherAt(G.ringIndexOf(0, 6)), 'typhoon');
  G.applyMove(room, 0, 0, { to: 6, bonuses: [] });
  const t = room.planes[0][0];
  assert.ok(t >= 0 && t <= G.TRACK_LAST);
  assert.notEqual(t, 6);
});

test('天气：关闭后落在天气格不触发', () => {
  const room = roomWithPlayers(2);
  room.rules.weather = false;
  room.planes[0][0] = 9;
  G.applyMove(room, 0, 0, { to: 10, bonuses: [] });
  assert.equal(room.planes[0][0], 10);
});

test('结束方式：排满名次时，第一名完赛后比赛继续', () => {
  const room = roomWithPlayers(3);
  room.rules.endMode = 'rank';
  G.startGame(room);
  room.planes[0] = [55, 55, 55, 54];
  room.planes[1] = [55, 55, 55, 54];
  room.planes[2] = [10, 10, 10, 10];
  G.applyMove(room, 0, 3, { to: 55, bonuses: [] });
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.finishOrder, [0]);
  G.applyMove(room, 1, 3, { to: 55, bonuses: [] });
  assert.equal(room.phase, 'finished');
  assert.deepEqual(room.finishOrder, [0, 1, 2]);
  assert.equal(room.winner, 0);
});

test('电脑难度：简单难度随机选择合法走法', () => {
  const room = roomWithPlayers(2);
  room.rules.botLevel = 'easy';
  const options = [
    { plane: 0, from: 10, to: 11, bonuses: [] },
    { plane: 1, from: -1, to: 0, bonuses: [] },
  ];
  const picked = G.pickBotMove(room, 0, options);
  assert.ok(options.includes(picked));
});

test('电脑难度：困难难度仍优先撞子', () => {
  const room = roomWithPlayers(2);
  room.rules.botLevel = 'hard';
  room.planes[0][0] = 9;
  room.planes[1][0] = 49;
  const options = [
    { plane: 1, from: -1, to: 0, bonuses: [] },
    { plane: 0, from: 9, to: 10, bonuses: [] },
  ];
  assert.equal(G.pickBotMove(room, 0, options).plane, 0);
});
