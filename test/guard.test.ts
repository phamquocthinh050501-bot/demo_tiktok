import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGrid } from "../src/core/world/grid.ts";
import type { MapData } from "../src/core/world/grid.ts";
import { createGuards, sees } from "../src/core/ai/guard.ts";
import type { Prey, GuardEvent } from "../src/core/ai/guard.ts";
import type { EscapeCfg } from "../src/core/rules/escape.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const baseMap: MapData = read("../assets/map/office_main_floor.json");
const esc: EscapeCfg = read("../config/escape.json");
const grid = loadGrid(baseMap);

const withPatrol = (patrolRoutes: MapData["patrolRoutes"]): MapData => ({ ...structuredClone(baseMap), patrolRoutes });
const prey = (over: Partial<Prey> = {}): Prey => ({
  userKey: "p", x: 10, y: 13, sneaking: true, running: false, prof: esc.profiles[0], range: 3.5,
  inSafe: false, inNoise: false, ...over,
});
const stationary = (x: number, y: number) => [{ id: "g", waypoints: [{ x, y }] }];

function run(g: ReturnType<typeof createGuards>, ms: number, preys: () => Prey[], events: GuardEvent[] = []) {
  for (let t = 0; t < ms; t += 100) events.push(...g.update(100, preys()));
  return events;
}

test("sees: tầm, góc nhìn, rất gần, omni, vật chắn", () => {
  const g = loadGrid({ collision: ["#########", "#.......#", "#.......#", "#...#...#", "#.......#", "#########"] });
  const G = (x: number, y: number) => ({ x, y, face: { x: 1, y: 0 } });
  assert.equal(sees(g, G(1, 1), { x: 5, y: 1 }, 6, 45, 1.5, false), true);
  assert.equal(sees(g, G(1, 1), { x: 6, y: 1 }, 4, 45, 1.5, false), false);      // ngoài tầm
  assert.equal(sees(g, G(5, 1), { x: 2, y: 1 }, 6, 45, 1.5, false), false);      // sau lưng
  assert.equal(sees(g, G(3, 1), { x: 2, y: 1 }, 6, 45, 1.5, false), true);       // sau lưng nhưng rất gần
  assert.equal(sees(g, G(5, 1), { x: 2, y: 1 }, 6, 45, 1.5, true), true);        // omni
  assert.equal(sees(g, G(2, 3), { x: 6, y: 3 }, 8, 45, 1.5, false), false);      // tường chắn
});

test("PATROL: đi hết các waypoint rồi lặp lại", () => {
  const route = baseMap.patrolRoutes.find((r) => r.id === "guard_hall")!;
  const gs = createGuards({ map: withPatrol([route]), grid, cfg: esc.guard });
  const g = gs.guards[0];
  const visited = new Set<number>();
  for (let t = 0; t < 80_000; t += 100) {
    gs.update(100, []);
    route.waypoints.forEach((w, i) => { if (Math.hypot(w.x - g.x, w.y - g.y) < 0.3) visited.add(i); });
  }
  assert.equal(visited.size, route.waypoints.length);
});

test("phát hiện sau thời gian phản ứng → đuổi → bắt → quay về tuần tra", () => {
  const gs = createGuards({ map: withPatrol(stationary(10, 10)), grid, cfg: esc.guard });
  const g = gs.guards[0];
  const p = prey();
  const events: GuardEvent[] = [];
  run(gs, esc.profiles[0].reactionMs - 200, () => [p], events);
  assert.equal(events.length, 0);                                    // chưa đủ thời gian phản ứng
  run(gs, 500, () => [p], events);
  assert.equal(events[0]?.type, "detected");
  assert.equal(g.state, "CHASE");
  p.sneaking = false; p.running = true;                              // như escape.ts làm khi bị phát hiện
  run(gs, 3_000, () => [p], events);
  assert.ok(events.some((e) => e.type === "captured"));
  assert.equal(g.state, "CAPTURE");
  run(gs, esc.guard.captureMs + 200, () => [], events);
  assert.equal(g.state, "RETURN");
  run(gs, 15_000, () => [], events);
  assert.equal(g.state, "PATROL");
});

test("tiếng động kích hoạt điều tra rồi quay về", () => {
  const gs = createGuards({ map: withPatrol(stationary(10, 10)), grid, cfg: esc.guard });
  const g = gs.guards[0];
  const p = prey({ x: 10, y: 7, range: 0.5, inNoise: true });       // sau lưng, ngoài tầm nhìn
  run(gs, 200, () => [p]);
  assert.equal(g.state, "INVESTIGATE");
  run(gs, 20_000, () => []);
  assert.equal(g.state, "PATROL");
});

test("vào vùng an toàn thì bảo vệ bỏ đuổi, không bắt được", () => {
  const gs = createGuards({ map: withPatrol(stationary(10, 10)), grid, cfg: esc.guard });
  const p = prey();
  const events: GuardEvent[] = [];
  run(gs, 2_000, () => [p], events);
  p.sneaking = false; p.running = true; p.inSafe = true;
  run(gs, 5_000, () => [p], events);
  assert.ok(!events.some((e) => e.type === "captured"));
  assert.notEqual(gs.guards[0].state, "CHASE");
});

test("trạm gác chỉ phát hiện khi mức độ khó cho phép", () => {
  const detects = (checkpoints: number) => {
    const gs = createGuards({ map: withPatrol([]), grid, cfg: esc.guard });
    gs.setStaffedCheckpoints(3);
    const p = prey({ x: 10, y: 15, prof: { ...esc.profiles[6], checkpoints } });   // ngay trước trạm cp_hall (idx 1)
    return run(gs, 1_800, () => [p]).some((e) => e.type === "detected");
  };
  assert.equal(detects(2), true);
  assert.equal(detects(1), false);
});

test("trạm gác chưa có người thì không hoạt động", () => {
  const gs = createGuards({ map: withPatrol([]), grid, cfg: esc.guard });
  assert.ok(gs.guards.every((g) => !g.staffed));
  gs.setStaffedCheckpoints(2);
  assert.deepEqual(gs.guards.map((g) => g.staffed), [true, true, false]);
});

test("camera báo động: bảo vệ gần nhất đến kiểm tra, bảo vệ đang bận thì bỏ qua", () => {
  const gs = createGuards({
    map: withPatrol([{ id: "a", waypoints: [{ x: 10, y: 7 }] }, { id: "b", waypoints: [{ x: 10, y: 16 }] }]),
    grid, cfg: esc.guard,
  });
  const p = prey({ x: 10, y: 15, prof: esc.profiles[6] });
  assert.equal(gs.alertNearest(p), true);
  assert.equal(gs.guards[1].state, "INVESTIGATE");
  assert.equal(gs.guards[0].state, "PATROL");
  assert.equal(gs.alertNearest(p), true);                            // bảo vệ b đang bận → bảo vệ a nhận
  assert.equal(gs.guards[0].state, "INVESTIGATE");
  assert.equal(gs.alertNearest(p), false);
});
