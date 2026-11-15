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

test('棋盘：52 格环形航道坐标唯一，四队起飞格颜色与队伍一致', () => {
  assert.equal(G.RING.length, 52);
  assert.equal(new Set(G.RING.map(([r, c]) => `${r},${c}`)).size, 52);
  for (let seat = 0; seat < 4; seat += 1) {
    assert.equal(G.cellSeat(G.ringIndexOf(seat, 0)), seat);
    assert.equal(G.ringIndexOf(seat, 0), seat * 13);
  }
  // 每队最后一格紧邻自己的归航跑道入口
  for (let seat = 0; seat < 4; seat += 1) {
    const [r, c] = G.RING[G.ringIndexOf(seat, G.TRACK_LAST)];
    const [hr, hc] = G.HOME[seat][0];
    assert.ok(Math.abs(r - hr) + Math.abs(c - hc) === 1, `seat ${seat} 未与归航跑道相邻`);
  }
});

test('起飞：停机坪上的飞机只有掷出 6 才能起飞', () => {
  assert.equal(G.resolveMove(0, -1, 5), null);
  assert.deepEqual(G.resolveMove(0, -1, 6), { to: 0, bonuses: [] });
});

test('移动：超过终点不允许移动', () => {
  assert.equal(G.resolveMove(0, 55, 2), null);
  assert.deepEqual(G.resolveMove(0, 55, 1), { to: 56, bonuses: [] });
  assert.equal(G.resolveMove(0, 56, 1), null);
});

test('跳跃：落在自己颜色的格子前进 4 格', () => {
  // seat 0，t=3，掷 1 → 落在 t=4（第 4 格，颜色 0），跳 4 → t=8
  const res = G.resolveMove(0, 3, 1);
  assert.ok(res);
  assert.equal(res.to, 8);
  assert.equal(res.bonuses.length, 1);
  assert.equal(res.bonuses[0].type, 'jump');
});

test('飞行：落在自己颜色的飞机格飞 12 格', () => {
  // seat 0，t=23，掷 1 → 落在 t=24（环 24 格，颜色 0 且是飞机格），飞 12 → t=36
  const res = G.resolveMove(0, 23, 1);
  assert.ok(res);
  assert.equal(res.to, 36);
  assert.equal(res.bonuses[0].type, 'fly');
});

test('撞子：落到对手飞机所在格，对手回停机坪', () => {
  const room = roomWithPlayers(2);
  room.planes[0][0] = 10;
  // seat 1 的 t=50 → 环 11 格，与 seat 0 的 t=11 同格
  room.planes[1][0] = 50;
  assert.equal(G.ringIndexOf(0, 11), G.ringIndexOf(1, 50));
  const result = G.applyMove(room, 0, 0, { to: 11, bonuses: [] });
  assert.equal(room.planes[0][0], 11);
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
  room.planes[0] = [56, 56, 56, 55];
  room.planes[2] = [10, 10, 10, 10];
  const result = G.applyMove(room, 0, 3, { to: 56, bonuses: [] });
  assert.equal(result.winner, 0);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 0);
});

test('可选走法：机库飞机只在掷 6 时出现，且不会越过终点', () => {
  const room = roomWithPlayers(2);
  room.planes[0] = [-1, 10, 54, 56];
  const moves = G.legalMoves(room, 0, 6);
  assert.ok(moves.some((m) => m.plane === 0 && m.from === -1 && m.to === 0));
  assert.ok(moves.some((m) => m.plane === 1));
  assert.ok(!moves.some((m) => m.plane === 2));
  assert.ok(!moves.some((m) => m.plane === 3));
});

test('可选走法：掷 1 时只能移动能走的飞机', () => {
  const room = roomWithPlayers(2);
  room.planes[0] = [-1, 10, 54, 56];
  const moves = G.legalMoves(room, 0, 3);
  assert.deepEqual(moves.map((m) => m.plane), [1]);
});

test('环形航道：每格被 3 或 4 支队伍经过，跳过格正好 4 个', () => {
  const counts = new Array(52).fill(0);
  for (let seat = 0; seat < 4; seat += 1) {
    for (let t = 0; t <= G.TRACK_LAST; t += 1) {
      counts[G.ringIndexOf(seat, t)] += 1;
    }
  }
  assert.deepEqual([...new Set(counts)].sort(), [3, 4]);
  assert.equal(counts.filter((c) => c === 3).length, 4);
});
