/* 棋盘坐标与展示文案，大屏和手机共用 */
(function () {
  'use strict';

  const SEAT_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
  const SEAT_LIGHT = ['#fecaca', '#fde68a', '#bfdbfe', '#bbf7d0'];
  const SEAT_NAMES = ['红队', '黄队', '蓝队', '绿队'];

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

  // 四角机库内的归航跑道，从外圈一侧通向中心
  const HOME = [
    [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    [[12, 6], [11, 6], [10, 6], [9, 6], [8, 6]],
  ];

  // 四角机库里的 4 个停机位（行、列）
  const BASE_SLOTS = [
    [[1.85, 1.85], [1.85, 4.15], [4.15, 1.85], [4.15, 4.15]],
    [[1.85, 8.85], [1.85, 11.15], [4.15, 8.85], [4.15, 11.15]],
    [[8.85, 8.85], [8.85, 11.15], [11.15, 8.85], [11.15, 11.15]],
    [[8.85, 1.85], [8.85, 4.15], [11.15, 1.85], [11.15, 4.15]],
  ];

  const GOAL_SLOTS = [[-0.2, -0.2], [-0.2, 0.2], [0.2, -0.2], [0.2, 0.2]];

  const GOAL_T = 56;
  const TRACK_LAST = 50;

  function ringIndexOf(seat, t) {
    return (seat * 13 + t) % 52;
  }

  function isFlyCell(ringIdx) {
    return ringIdx % 13 === 5 || ringIdx % 13 === 11;
  }

  /** 返回棋子中心点 [行, 列]（单位：格，可为小数） */
  function planeCoord(seat, plane, t) {
    if (t === -1) return BASE_SLOTS[seat][plane];
    if (t <= TRACK_LAST) {
      const [r, c] = RING[ringIndexOf(seat, t)];
      return [r + 0.5, c + 0.5];
    }
    if (t < GOAL_T) {
      const [r, c] = HOME[seat][t - 51];
      return [r + 0.5, c + 0.5];
    }
    return [7 + GOAL_SLOTS[plane][0], 7 + GOAL_SLOTS[plane][1]];
  }

  function posLabel(t) {
    if (t === -1) return '停机坪';
    if (t <= TRACK_LAST) return `航道 ${t + 1}`;
    if (t < GOAL_T) return `归航 ${t - 50}`;
    return '已抵达';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  window.FlyChess = {
    SEAT_COLORS,
    SEAT_LIGHT,
    SEAT_NAMES,
    RING,
    HOME,
    BASE_SLOTS,
    GOAL_SLOTS,
    GOAL_T,
    TRACK_LAST,
    ringIndexOf,
    isFlyCell,
    planeCoord,
    posLabel,
    escapeHtml,
  };
})();
