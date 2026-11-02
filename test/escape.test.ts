import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGrid } from "../src/core/world/grid.ts";
import type { MapData } from "../src/core/world/grid.ts";
import { createWorld } from "../src/core/rules/world.ts";
import type { GameEvent } from "../src/core/rules/world.ts";
import type { Gameplay } from "../src/core/rules/progression.ts";
import { validateEscapeConfig } from "../src/core/rules/escape.ts";
import type { EscapeCfg } from "../src/core/rules/escape.ts";
import type { LiveCfg } from "../src/core/rules/live.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const baseMap: MapData = read("../assets/map/office_main_floor.json");
const baseCfg: Gameplay = read("../config/gameplay.json");
const baseEsc: EscapeCfg = read("../config/escape.json");
const baseLive: LiveCfg = read("../config/live.json");
const exits = baseMap.objects.filter((o) => o.id.startsWith("roof_exit")).map((o) => o.stands[0]);

function setup(o: { patrol?: MapData["patrolRoutes"]; esc?: Partial<EscapeCfg>; profile0?: Partial<EscapeCfg["profiles"][0]> } = {}) {
  const map = structuredClone(baseMap);
  if (o.patrol) map.patrolRoutes = o.patrol;
  const escape: EscapeCfg = { ...structuredClone(baseEsc), ...o.esc };
  if (o.profile0) escape.profiles[0] = { ...escape.profiles[0], ...o.profile0 };
  const clock = { t: 1_000_000 };
  const events: GameEvent[] = [];
  const w = createWorld({
    map, grid: loadGrid(map), cfg: baseCfg, escape, live: baseLive, limits: { maxAvatars: 200 },
    now: () => clock.t, random: () => 0, emit: (e) => events.push(e),
  });
  const cmd = (u: string, id: string) =>
    w.handle({ kind: "command", userKey: u, identityStable: true, displayName: `Nv${u}`, commandId: id, group: "x", at: clock.t });
  const step = (ms: number) => { for (let t = 0; t < ms; t += 100) { clock.t += 100; w.update(100); } };
  const until = (cond: () => boolean, maxMs = 240_000) => {
    for (let t = 0; t < maxMs && !cond(); t += 100) step(100);
    return cond();
  };
  const toDesk = (u: string) => { cmd(u, "join"); cmd(u, "work"); assert.ok(until(() => w.getAvatar(u)!.state === "WORKING", 60_000)); };
  const feeds = () => events.filter((e) => e.kind === "feed").map((e) => (e as { text: string }).text);
  return { w, cmd, step, until, toDesk, events, feeds, clock };
}
const NO_GUARDS: MapData["patrolRoutes"] = [];
const BLIND = { visionRange: 0.5 };

test("cấu hình độ khó hợp lệ: đủ 7 mức, trong giới hạn, tăng dần", () => {
  assert.deepEqual(validateEscapeConfig(baseEsc, 7), []);
});

test("validateEscapeConfig bắt mức vượt giới hạn, không tăng dần, thiếu mức", () => {
  const bad = structuredClone(baseEsc);
  bad.profiles[3].guards = 0;
  bad.profiles[5].reactionMs = 1500;
  bad.profiles.pop();
  const errs = validateEscapeConfig(bad, 7);
  assert.ok(errs.some((e) => e.includes("guards=0")));
  assert.ok(errs.some((e) => e.includes("reactionMs không khó hơn")));
  assert.ok(errs.some((e) => e.includes("cần 7 mức")));
});

test("chỉ trốn việc được khi đang ở Khu làm việc; người lạ bị bỏ qua", () => {
  const { w, cmd, step, feeds } = setup({ patrol: NO_GUARDS });
  cmd("9", "escape");
  assert.equal(w.getAvatar("9"), undefined);
  cmd("1", "join"); step(2_000);
  cmd("1", "escape");
  assert.equal(w.getAvatar("1")!.state, "IDLE");
  assert.ok(feeds().some((t) => t.includes("Khu làm việc") && t.includes("trốn việc")));
});

test("trốn thành công (không bị phát hiện): thắng, thưởng, huy hiệu, cooldown", () => {
  const { w, cmd, until, toDesk, events, feeds, step } = setup({
    patrol: NO_GUARDS, profile0: BLIND,
    esc: { badgeRules: { escape_master: { wins: 1 }, office_ghost: { stealthWins: 1 } } },
  });
  toDesk("1");
  const a = w.getAvatar("1")!;
  const exp0 = a.exp;
  cmd("1", "escape");
  assert.equal(a.state, "SNEAKING");
  assert.equal(a.room, "transit");
  cmd("2", "join"); cmd("2", "work");                                // bàn của người 1 đã được nhả
  assert.ok(until(() => a.state === "ESCAPED"));
  assert.ok(exits.some((p) => p.x === a.x && p.y === a.y));
  assert.equal(a.room, "rooftop");
  assert.equal(a.wins, 1);
  assert.equal(a.stealthWins, 1);
  assert.ok(a.exp > exp0);
  assert.ok(a.badges.includes("escape_master") && a.badges.includes("office_ghost"));
  assert.ok(events.some((e) => e.kind === "escape_result" && e.outcome === "escaped"));
  assert.ok(feeds().some((t) => t.includes("trốn thoát thành công")));
  assert.ok(until(() => a.state === "IDLE", 10_000));
  cmd("1", "work");
  assert.ok(until(() => a.state === "WORKING", 60_000));
  cmd("1", "escape");
  assert.equal(a.state, "WORKING");
  assert.ok(feeds().some((t) => t.includes("chờ thêm")));
  step(0);
});

test("bị bảo vệ bắt: CAUGHT, về sảnh, ít EXP, không thưởng thắng", () => {
  const { w, cmd, until, toDesk, events, feeds } = setup({
    patrol: [{ id: "g", waypoints: [{ x: 3, y: 21 }] }],            // sát bàn đầu tiên, nơi người trốn xuất phát
    profile0: { visionRange: 12, visionHalfAngleDeg: 180, reactionMs: 800 },
    esc: { runSpeed: 2 },                                           // chậm hơn bảo vệ để kết quả chắc chắn
  });
  toDesk("1");
  const a = w.getAvatar("1")!;
  const exp0 = a.exp;
  cmd("1", "escape");
  assert.ok(until(() => a.state === "CAUGHT"));
  assert.equal(a.wins, 0);
  assert.ok(events.some((e) => e.kind === "escape_result" && e.outcome === "caught"));
  assert.ok(feeds().some((t) => t.includes("bị phát hiện")));
  assert.ok(feeds().some((t) => t.includes("bị bảo vệ bắt")));
  assert.equal(a.exp - exp0, baseCfg.exp.sources.escape_caught.amount);
  assert.ok(until(() => a.state !== "CAUGHT", 10_000));
  assert.equal(a.room, "lobby");
  assert.equal(a.attempts, 1);
});

test("camera trong vùng giám sát gọi bảo vệ đến kiểm tra", () => {
  const { w, cmd, until, toDesk, events } = setup({
    patrol: [{ id: "far", waypoints: [{ x: 2, y: 30 }] }],
    profile0: { cameras: 3, visionRange: 4, reactionMs: 800 },
  });
  toDesk("1");
  const a = w.getAvatar("1")!;
  cmd("1", "escape");
  const guardStates = new Set<string>();
  until(() => {
    w.snapshot().guards.forEach((g) => guardStates.add(g.state));
    return a.state === "ESCAPED" || a.state === "CAUGHT";
  });
  assert.ok(guardStates.has("INVESTIGATE"), [...guardStates].join());
  assert.ok(events.some((e) => e.kind === "escape_result"));
});

test("giới hạn số người trốn cùng lúc", () => {
  const { w, cmd, toDesk, feeds } = setup({ patrol: NO_GUARDS, profile0: BLIND, esc: { maxConcurrent: 1 } });
  toDesk("1"); toDesk("2");
  cmd("1", "escape"); cmd("2", "escape");
  assert.equal(w.getAvatar("1")!.state, "SNEAKING");
  assert.equal(w.getAvatar("2")!.state, "WORKING");
  assert.ok(feeds().some((t) => t.includes("quá nhiều")));
});

test("quá thời gian tối đa: hủy thử thách, không thưởng", () => {
  const { w, cmd, step, toDesk, events, feeds } = setup({ patrol: NO_GUARDS, profile0: BLIND, esc: { maxChallengeMs: 1_000 } });
  toDesk("1");
  const a = w.getAvatar("1")!;
  const exp0 = a.exp;
  cmd("1", "escape");
  step(3_000);
  assert.equal(a.wins, 0);
  assert.equal(a.exp, exp0);
  assert.equal(a.room, "lobby");
  assert.ok(feeds().some((t) => t.includes("hết giờ")));
  assert.ok(!events.some((e) => e.kind === "escape_result"));
});

test("cùng đầu vào cho cùng kết quả (xác định, không random thuần)", () => {
  const once = () => {
    const { w, cmd, until, toDesk } = setup({ profile0: { visionRange: 9, reactionMs: 900 } });
    toDesk("1");
    cmd("1", "escape");
    const a = w.getAvatar("1")!;
    until(() => a.state === "ESCAPED" || a.state === "CAUGHT");
    return JSON.stringify([a.state, a.x, a.y, a.exp]);
  };
  assert.equal(once(), once());
});

test("mọi cấp bậc đều có cơ hội thắng (thử nhiều thời điểm bắt đầu)", (t) => {
  const delays = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].map((s) => s * 1000);
  const rates: string[] = [];
  baseCfg.ranks.forEach((rank, ri) => {
    let wins = 0;
    for (const d of delays) {
      const { w, cmd, step, until, toDesk } = setup();
      toDesk("1");
      const a = w.getAvatar("1")!;
      a.exp = rank.minExp;
      step(d);
      cmd("1", "escape");
      until(() => a.state === "ESCAPED" || a.state === "CAUGHT" || (a.state !== "SNEAKING" && a.state !== "ESCAPING"));
      if (a.state === "ESCAPED") wins++;
    }
    rates.push(`${rank.name}: ${wins}/${delays.length}`);
    assert.ok(wins > 0, `${rank.name} không thể thắng: ${wins}/${delays.length}`);
  });
  t.diagnostic(rates.join(" | "));
});
