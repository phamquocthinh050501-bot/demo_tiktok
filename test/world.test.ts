import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGrid, findPath, findRoute, pathCost } from "../src/core/world/grid.ts";

const g = (rows: string[]) => loadGrid({ collision: rows });

test("đường thẳng trên lưới trống, gồm điểm đầu và cuối", () => {
  const p = findPath(g(["....", "....", "...."]), { x: 0, y: 1 }, { x: 3, y: 1 })!;
  assert.deepEqual(p[0], { x: 0, y: 1 });
  assert.deepEqual(p.at(-1), { x: 3, y: 1 });
  assert.equal(p.length, 4);
});

test("đi vòng qua tường", () => {
  const p = findPath(g(["..#..", "..#..", "....."]), { x: 0, y: 0 }, { x: 4, y: 0 })!;
  assert.ok(p.every((q) => q.x !== 2 || q.y === 2));
});

test("không có đường thì trả về null; điểm đầu/cuối bị chặn hoặc ngoài lưới cũng null", () => {
  const rows = ["..#..", "..#..", "..#.."];
  assert.equal(findPath(g(rows), { x: 0, y: 0 }, { x: 4, y: 0 }), null);
  assert.equal(findPath(g(rows), { x: 2, y: 0 }, { x: 0, y: 0 }), null);
  assert.equal(findPath(g(rows), { x: 0, y: 0 }, { x: 9, y: 9 }), null);
});

test("không cắt góc chéo giữa hai ô chặn", () => {
  assert.equal(findPath(g([".#", "#."]), { x: 0, y: 0 }, { x: 1, y: 1 }), null);
});

test("đường chéo rẻ hơn đi vuông góc", () => {
  const p = findPath(g(["...", "...", "..."]), { x: 0, y: 0 }, { x: 2, y: 2 })!;
  assert.equal(p.length, 3);
  assert.ok(Math.abs(pathCost(p) - 2 * Math.SQRT2) < 1e-9);
});

test("findRoute nối nhiều chặng và null nếu một chặng đứt", () => {
  const grid = g(["....", "....", "...."]);
  const r = findRoute(grid, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }])!;
  assert.equal(r.length, 6);
  assert.equal(findRoute(g(["..#.", "..#."]), [{ x: 0, y: 0 }, { x: 3, y: 0 }]), null);
});

test("hàng collision lệch độ dài bị từ chối", () => {
  assert.throws(() => g(["...", ".."]));
});
