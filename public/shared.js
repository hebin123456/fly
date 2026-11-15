/* 棋盘坐标与展示文案，大屏和手机共用 */
(function () {
  'use strict';

  const SEAT_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
  const SEAT_LIGHT = ['#fecaca', '#fde68a', '#bfdbfe', '#bbf7d0'];
  const SEAT_NAMES = ['红队', '黄队', '蓝队', '绿队'];

  const RING = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14],
    [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7],
    [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0],
    [6, 0],
  ];

  const HOME = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  ];

  const BASE_SLOTS = [
    [[1.6, 1.6], [1.6, 4.0], [4.0, 1.6], [4.0, 4.0]],
    [[1.6, 10.6], [1.6, 13.0], [4.0, 10.6], [4.0, 13.0]],
    [[10.6, 10.6], [10.6, 13.0], [13.0, 10.6], [13.0, 13.0]],
    [[10.6, 1.6], [10.6, 4.0], [13.0, 1.6], [13.0, 4.0]],
  ];

  const GOAL_SLOTS = [[-0.36, -0.36], [-0.36, 0.36], [0.36, -0.36], [0.36, 0.36]];

  const GOAL_T = 56;
  const TRACK_LAST = 50;

  function ringIndexOf(seat, t) {
    return (seat * 13 + t) % 52;
  }

  function isFlyCell(ringIdx) {
    return ringIdx % 13 === 5 || ringIdx % 13 === 11;
  }

  /** 返回 [行, 列]（单位：格，可为小数） */
  function planeCoord(seat, plane, t) {
    if (t === -1) return BASE_SLOTS[seat][plane];
    if (t <= TRACK_LAST) return RING[ringIndexOf(seat, t)];
    if (t < GOAL_T) return HOME[seat][t - 51];
    return [7.5 + GOAL_SLOTS[plane][0], 7.5 + GOAL_SLOTS[plane][1]];
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
