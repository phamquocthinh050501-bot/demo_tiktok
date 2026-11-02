import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGrid } from "../src/core/world/grid.ts";
import type { MapData } from "../src/core/world/grid.ts";
import { createWorld } from "../src/core/rules/world.ts";
import type { GameEvent } from "../src/core/rules/world.ts";
import { STATE_LABEL } from "../src/core/rules/states.ts";
import type { Gameplay } from "../src/core/rules/progression.ts";
import type { EscapeCfg } from "../src/core/rules/escape.ts";
import type { LiveCfg } from "../src/core/rules/live.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const baseMap: MapData = read("../assets/map/office_main_floor.json");
const baseCfg: Gameplay = read("../config/gameplay.json");
const baseEscape: EscapeCfg = read("../config/escape.json");
const baseLive: LiveCfg = read("../config/live.json");

function setup(o: { map?: MapData; cfg?: Gameplay; maxAvatars?: number } = {}) {
  const map = o.map ?? baseMap;
  const cfg = o.cfg ?? baseCfg;
  const clock = { t: 1_000_000 };
  const events: GameEvent[] = [];
  const grid = loadGrid(map);
  const w = createWorld({
    map, grid, cfg, escape: baseEscape, live: baseLive, limits: { maxAvatars: o.maxAvatars ?? 200 },
    now: () => clock.t, random: () => 0, emit: (e) => events.push(e),
  });
  const cmd = (user: string, commandId: string, name = `Nv${user}`) =>
    w.handle({ kind: "command", userKey: user, identityStable: true, displayName: name, commandId, group: "x", at: clock.t });
  const step = (ms: number, dt = 100) => {
    for (let t = 0; t < ms; t += dt) { clock.t += dt; w.update(dt); }
  };
  const stateOf = (u: string) => w.getAvatar(u)!.state;
  return { w, cmd, step, clock, events, grid, stateOf };
}
const feeds = (events: GameEvent[]) => events.filter((e) => e.kind === "feed").map((e) => (e as { text: string }).text);

test("mọi trạng thái có nhãn tiếng Việt", () => {
  assert.equal(Object.keys(STATE_LABEL).length, 12);
  assert.equal(STATE_LABEL.WORKING, "Đang làm việc");
  assert.equal(STATE_LABEL.SNEAKING, "Đang lén trốn");
});

test("vào công ty: xuất hiện ở Lobby, JOINING rồi IDLE; vào lần nữa không tạo bản sao", () => {
  const { w, cmd, step, stateOf } = setup();
  cmd("1", "join");
  const a = w.getAvatar("1")!;
  assert.equal(a.state, "JOINING");
  assert.equal(a.room, "lobby");
  assert.ok(baseMap.rooms.find((r) => r.id === "lobby")!.spawnPoints.some((p) => p.x === a.x && p.y === a.y));
  step(baseCfg.joiningMs + 200);
  assert.equal(stateOf("1"), "IDLE");
  cmd("1", "join");
  assert.equal(w.snapshot().avatars.length, 1);
  assert.equal(w.getAvatar("1")!.id, a.id);
});

test("người chưa vào công ty gõ lệnh khác thì bị bỏ qua", () => {
  const { w, cmd } = setup();
  cmd("9", "work");
  assert.equal(w.snapshot().avatars.length, 0);
});

test("đi làm: đi bộ tới bàn rồi WORKING; mỗi người một chỗ, hết bàn thì đứng ô trống trong phòng", () => {
  const { w, cmd, step, stateOf } = setup();
  for (let i = 1; i <= 16; i++) { cmd(String(i), "join"); cmd(String(i), "work"); }
  assert.equal(stateOf("1"), "WALKING");
  step(60_000);
  const pos = new Set<string>();
  const ws = baseMap.rooms.find((r) => r.id === "workspace")!.bounds;
  for (let i = 1; i <= 16; i++) {
    const a = w.getAvatar(String(i))!;
    assert.equal(a.state, "WORKING", `avatar ${i}`);
    assert.ok(a.x > ws.x && a.x < ws.x + ws.w - 1 && a.y > ws.y && a.y < ws.y + ws.h - 1, `avatar ${i} trong phòng`);
    pos.add(`${a.x},${a.y}`);
  }
  assert.equal(pos.size, 16);
});

test("các lệnh di chuyển dẫn tới đúng phòng và trạng thái", () => {
  const { w, cmd, step } = setup();
  const cases: [string, string, string, string | undefined][] = [
    ["coffee", "break", "BREAKING", undefined], ["rest", "break", "BREAKING", undefined],
    ["meeting", "meeting", "MEETING", undefined], ["game", "gaming", "IDLE", "game"],
    ["rooftop", "rooftop", "IDLE", "relax"],
  ];
  cases.forEach(([c], i) => { cmd(`u${i}`, "join"); cmd(`u${i}`, c); });
  step(90_000);
  cases.forEach(([, room, state, act], i) => {
    const a = w.getAvatar(`u${i}`)!;
    assert.equal(a.room, room);
    assert.equal(a.state, state);
    assert.equal(a.activity, act);
  });
});

test("phòng đầy thì từ chối và báo bằng tiếng Việt", () => {
  const map = structuredClone(baseMap);
  map.rooms.find((r) => r.id === "workspace")!.capacity = 2;
  const { w, cmd, step, events, stateOf } = setup({ map });
  for (const u of ["1", "2", "3"]) { cmd(u, "join"); cmd(u, "work"); }
  step(30_000);
  assert.equal(stateOf("3"), "IDLE");
  assert.equal(w.getAvatar("3")!.room, "lobby");
  assert.ok(feeds(events).some((t) => t.includes("Khu làm việc") && t.includes("đầy")));
});

test("giới hạn số avatar", () => {
  const { w, cmd, events } = setup({ maxAvatars: 2 });
  for (const u of ["1", "2", "3"]) cmd(u, "join");
  assert.equal(w.snapshot().avatars.length, 2);
  assert.equal(w.getAvatar("3"), undefined);
  assert.ok(feeds(events).some((t) => t.includes("đủ người")));
});

test("đổi lệnh giữa đường: nhả chỗ cũ và tới nơi mới", () => {
  const { w, cmd, step } = setup();
  cmd("1", "join"); cmd("1", "work");
  step(2_000);
  cmd("1", "coffee");
  cmd("2", "join"); cmd("2", "work");
  step(60_000);
  assert.equal(w.getAvatar("1")!.room, "break");
  assert.equal(w.getAvatar("1")!.state, "BREAKING");
  const firstDesk = baseMap.objects.find((o) => o.id === "work_desk_01")!.stands[0];
  assert.deepEqual([w.getAvatar("2")!.x, w.getAvatar("2")!.y], [firstDesk.x, firstDesk.y]); // bàn đầu tiên đã được nhả
});

test("đi bộ đúng tốc độ và không bao giờ đứng trong ô bị chặn", () => {
  const { w, cmd, step, grid, clock } = setup();
  cmd("1", "join"); step(2_000);
  cmd("1", "rooftop");
  const a = w.getAvatar("1")!;
  let prev = { x: a.x, y: a.y }, dist = 0;
  for (let i = 0; i < 400; i++) {
    clock.t += 50; w.update(50);
    assert.ok(grid.walkable(Math.round(a.x), Math.round(a.y)), `bước ${i}: ${a.x},${a.y}`);
    if (i < 20) dist += Math.hypot(a.x - prev.x, a.y - prev.y);
    prev = { x: a.x, y: a.y };
  }
  assert.ok(Math.abs(dist - baseCfg.speedTilesPerSec) < 0.05, String(dist));
});

test("EXP làm việc theo chu kỳ cấu hình", () => {
  const { w, cmd, step, stateOf } = setup();
  cmd("1", "join"); cmd("1", "work");
  while (stateOf("1") !== "WORKING") step(100);
  const e0 = w.getAvatar("1")!.exp;
  step(30_000);
  assert.equal(w.getAvatar("1")!.exp - e0, 6);
});

test("trần EXP theo cửa sổ thời gian, hết cửa sổ thì nhận lại", () => {
  const cfg = structuredClone(baseCfg);
  cfg.exp.window = { ms: 60_000, max: 12 };
  const { w, cmd, clock } = setup({ cfg });
  cmd("1", "join"); cmd("1", "checkin");           // +10
  assert.equal(w.grantExp("1", "event"), 2);       // chỉ còn 2 chỗ trong cửa sổ
  assert.equal(w.grantExp("1", "event"), 0);
  assert.equal(w.getAvatar("1")!.exp, 12);
  clock.t += 60_000;
  assert.equal(w.grantExp("1", "event"), 5);
});

test("điểm danh chỉ được EXP một lần mỗi phiên", () => {
  const { w, cmd } = setup();
  cmd("1", "checkin");                              // chưa vào công ty → tự tạo avatar
  assert.equal(w.getAvatar("1")!.exp, 10);
  cmd("1", "checkin");
  assert.equal(w.getAvatar("1")!.exp, 10);
  w.resetSession();
  cmd("1", "checkin");
  assert.equal(w.getAvatar("1")!.exp, 20);
});

test("lên cấp phát sự kiện rank_up một lần", () => {
  const { w, cmd, events } = setup();
  cmd("1", "join");
  for (let i = 0; i < 5; i++) w.grantExp("1", "achievement");
  const ups = events.filter((e) => e.kind === "rank_up");
  assert.equal(ups.length, 1);
  assert.equal((ups[0] as { rank: string }).rank, "Nhân viên");
});

test("xem cấp bậc và thành tích trả lời bằng tiếng Việt", () => {
  const { w, cmd, events } = setup();
  cmd("1", "join", "Lan");
  cmd("1", "view_rank");
  cmd("1", "view_badge");
  const t = feeds(events);
  assert.ok(t.some((x) => x.includes("Lan") && x.includes("Thử việc") && x.includes("EXP")));
  assert.ok(t.some((x) => x.includes("Nhân viên mới")));
  assert.ok(w.getAvatar("1")!.badges.includes("new_employee"));
});

test("huy hiệu: tự cấp khi đủ điều kiện, thủ công idempotent, không cấp id lạ", () => {
  const cfg = structuredClone(baseCfg);
  cfg.badges.find((b) => b.id === "hard_worker")!.when = { kind: "workMs", value: 20_000 };
  const { w, cmd, step, stateOf } = setup({ cfg });
  cmd("1", "join"); cmd("1", "work");
  while (stateOf("1") !== "WORKING") step(100);
  assert.ok(!w.getAvatar("1")!.badges.includes("hard_worker"));
  step(30_000);
  assert.ok(w.getAvatar("1")!.badges.includes("hard_worker"));
  assert.equal(w.awardBadge("1", "escape_master"), true);
  assert.equal(w.awardBadge("1", "escape_master"), false);
  assert.throws(() => w.awardBadge("1", "khong_co"));
  assert.equal(w.getAvatar("1")!.badges.filter((b) => b === "escape_master").length, 1);
});

test("AFK, rồi OFFLINE; vào lại đúng avatar cũ ở Lobby, không nhân bản", () => {
  const { w, cmd, step, stateOf } = setup();
  cmd("1", "join"); step(2_000);
  const id = w.getAvatar("1")!.id;
  step(baseCfg.afkAfterMs);
  assert.equal(stateOf("1"), "AFK");
  cmd("1", "dance");
  assert.equal(stateOf("1"), "IDLE");
  step(baseCfg.offlineAfterMs + 1_000, 1_000);
  assert.equal(stateOf("1"), "OFFLINE");
  assert.equal(w.snapshot().avatars.length, 0);
  cmd("1", "join");
  assert.equal(stateOf("1"), "JOINING");
  assert.equal(w.getAvatar("1")!.id, id);
  assert.equal(w.snapshot().avatars.length, 1);
});

test("nhảy và ngủ là hoạt động tại chỗ, tự hết", () => {
  const { w, cmd, step } = setup();
  cmd("1", "join"); step(2_000);
  cmd("1", "dance");
  assert.equal(w.getAvatar("1")!.activity, "dance");
  step(baseCfg.danceMs + 200);
  assert.equal(w.getAvatar("1")!.activity, undefined);
  cmd("1", "sleep");
  assert.equal(w.getAvatar("1")!.activity, "sleep");
});

test("snapshot có nhãn trạng thái tiếng Việt và số người từng phòng", () => {
  const { w, cmd, step } = setup();
  cmd("1", "join"); cmd("1", "work");
  cmd("2", "join");
  step(60_000);
  const s = w.snapshot();
  assert.equal(s.avatars.find((a) => a.name === "Nv1")!.stateLabel, "Đang làm việc");
  assert.equal(s.rooms.find((r) => r.id === "workspace")!.count, 1);
  assert.equal(s.rooms.find((r) => r.id === "lobby")!.count, 1);
  assert.equal(s.rooms.length, 8);
});
