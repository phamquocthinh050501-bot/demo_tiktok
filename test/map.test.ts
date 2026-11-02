import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGrid, findPath, findRoute, pathCost } from "../src/core/world/grid.ts";
import type { MapData } from "../src/core/world/grid.ts";
import { validateMap } from "../src/core/world/validateMap.ts";

const map: MapData = JSON.parse(readFileSync(new URL("../assets/map/office_main_floor.json", import.meta.url), "utf8"));
const grid = loadGrid(map);
const room = (id: string) => map.rooms.find((r) => r.id === id)!;

test("map đạt toàn bộ kiểm tra của validateMap", () => {
  assert.deepEqual(validateMap(map), []);
});

test("khung dọc 20×32 tile 32px (tòa nhà nhiều tầng), đủ 8 phòng", () => {
  assert.equal(map.tileSize, 32);
  assert.deepEqual([map.width, map.height], [20, 32]);
  assert.deepEqual(map.rooms.map((r) => r.id).sort(),
    ["break", "director", "gaming", "hr", "lobby", "meeting", "rooftop", "workspace"]);
});

test("đi bộ từ Lobby tới cả 7 phòng còn lại", () => {
  const from = room("lobby").spawnPoints[0];
  for (const r of map.rooms) assert.ok(findPath(grid, from, r.spawnPoints[0]), r.id);
});

test("3 tuyến trốn chạy từ đầu đến điểm thoát, dài dần theo ngắn → trung bình → dài", () => {
  assert.deepEqual(map.escapeRoutes.map((r) => r.risk), ["high", "medium", "low"]);
  const costs = map.escapeRoutes.map((r) => {
    const exit = map.objects.find((o) => o.id === r.exit)!.stands[0];
    return pathCost(findRoute(grid, [r.start, ...r.waypoints, exit])!);
  });
  assert.ok(costs[0] < costs[1] && costs[1] < costs[2], costs.join(" < "));
});

test("validator bắt cửa Lobby bị chặn", () => {
  const m = structuredClone(map);
  for (const d of room("lobby").doorways) {
    const row = m.collision[d.y];
    m.collision[d.y] = row.slice(0, d.x) + "#" + row.slice(d.x + 1);
  }
  assert.ok(validateMap(m).length > 0);
});

test("validator bắt hành lang giữa hai cột phòng hẹp hơn 3 tile", () => {
  const m = structuredClone(map);
  m.rooms.find((r) => r.id === "director")!.bounds.x -= 2;   // hành lang giữa chỉ còn 2 ô
  assert.ok(validateMap(m).some((e) => e.includes("hành lang")));
});

test("validator bắt hai phòng chồng lên nhau (chỉ được chung một dòng tường)", () => {
  const m = structuredClone(map);
  m.rooms.find((r) => r.id === "gaming")!.bounds.y -= 3;
  assert.ok(validateMap(m).some((e) => e.includes("chồng")));
});
