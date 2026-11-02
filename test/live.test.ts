import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGrid } from "../src/core/world/grid.ts";
import type { MapData } from "../src/core/world/grid.ts";
import { createWorld } from "../src/core/rules/world.ts";
import type { GameEvent } from "../src/core/rules/world.ts";
import type { Gameplay } from "../src/core/rules/progression.ts";
import type { EscapeCfg } from "../src/core/rules/escape.ts";
import type { Profile } from "../src/core/ai/guard.ts";
import { validateLiveConfig } from "../src/core/rules/live.ts";
import type { LiveCfg } from "../src/core/rules/live.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const baseMap: MapData = read("../assets/map/office_main_floor.json");
const baseCfg: Gameplay = read("../config/gameplay.json");
const baseEsc: EscapeCfg = read("../config/escape.json");
const baseLive: LiveCfg = read("../config/live.json");

interface Opts {
  live?: (c: LiveCfg) => void; cfg?: (c: Gameplay) => void;
  patrol?: MapData["patrolRoutes"]; profile0?: Partial<Profile>; random?: () => number;
}
function setup(o: Opts = {}) {
  const map = structuredClone(baseMap);
  if (o.patrol) map.patrolRoutes = o.patrol;
  const cfg = structuredClone(baseCfg); o.cfg?.(cfg);
  const live = structuredClone(baseLive); o.live?.(live);
  const escape = structuredClone(baseEsc);
  if (o.profile0) escape.profiles[0] = { ...escape.profiles[0], ...o.profile0 };
  const clock = { t: 1_000_000 };
  const events: GameEvent[] = [];
  const w = createWorld({
    map, grid: loadGrid(map), cfg, escape, live, limits: { maxAvatars: 200 },
    now: () => clock.t, random: o.random ?? (() => 0), emit: (e) => events.push(e),
  });
  const cmd = (u: string, id: string) =>
    w.handle({ kind: "command", userKey: u, identityStable: true, displayName: `Nv${u}`, commandId: id, group: "x", at: clock.t });
  const step = (ms: number) => { for (let t = 0; t < ms; t += 100) { clock.t += 100; w.update(100); } };
  const until = (cond: () => boolean, maxMs = 240_000) => {
    for (let t = 0; t < maxMs && !cond(); t += 100) step(100);
    return cond();
  };
  const join = (u: string) => { cmd(u, "join"); step(2_000); };
  const toDesk = (u: string) => { cmd(u, "join"); cmd(u, "work"); assert.ok(until(() => w.getAvatar(u)!.state === "WORKING", 60_000)); };
  const likes = (count: number) => w.handle({ kind: "likes", count, at: clock.t });
  const gift = (u: string, g: { giftId?: string; giftName?: string; count?: number; value?: number } = {}) =>
    w.handle({ kind: "gift", userKey: u, identityStable: true, displayName: `Nv${u}`, ...g, count: g.count ?? 1, at: clock.t });
  const feeds = () => events.filter((e) => e.kind === "feed").map((e) => (e as { text: string }).text);
  const announced = () => events.filter((e) => e.kind === "announce").map((e) => (e as { id: string }).id);
  const fxs = () => events.filter((e) => e.kind === "fx") as Extract<GameEvent, { kind: "fx" }>[];
  const energy = () => w.snapshot().community.energy;
  const exp = (u: string) => w.getAvatar(u)!.exp;
  return { w, cmd, step, until, join, toDesk, likes, gift, feeds, announced, fxs, energy, exp, events, clock };
}
const shortEvents = (c: LiveCfg) => c.events.forEach((e) => { e.durationMs = 1_000; e.minIntervalMs = 0; });
const NO_GUARDS: MapData["patrolRoutes"] = [];
const BLIND = { visionRange: 0.5 };

test("cấu hình live hợp lệ: 9 sự kiện, tham chiếu đúng", () => {
  assert.equal(baseLive.events.length, 9);
  assert.deepEqual(validateLiveConfig(baseLive, baseMap.rooms.map((r) => r.id)), []);
});

test("validateLiveConfig bắt tham chiếu sai, id trùng, xác suất sai", () => {
  const bad = structuredClone(baseLive);
  bad.schedule.push({ event: "khong_co", atMs: 99_999_999 });
  bad.events.push({ ...bad.events[0] });
  bad.random.events[0].chance = 0;
  bad.events[1].effects.push({ type: "gather", room: "phong_la", arrive: "IDLE" });
  const errs = validateLiveConfig(bad, baseMap.rooms.map((r) => r.id));
  assert.ok(errs.some((e) => e.includes("khong_co")));
  assert.ok(errs.some((e) => e.includes("trùng id")));
  assert.ok(errs.some((e) => e.includes("chance")));
  assert.ok(errs.some((e) => e.includes("phong_la")));
});

test("like: gộp mốc, mỗi mốc chỉ thưởng một lần, nhiều mốc trong một batch", () => {
  const { likes, join, exp, feeds, w } = setup();
  join("1"); join("2");
  likes(99);
  assert.equal(exp("1"), 0);
  likes(1);                                   // chạm mốc 100 → +1 EXP community
  assert.equal(exp("1"), 1);
  assert.equal(exp("2"), 1);
  assert.ok(feeds().some((t) => t.includes("100 lượt thích")));
  likes(10);
  assert.equal(exp("1"), 1);                  // không thưởng lại
  likes(1000);                                // vượt 500 (+2) và 1000 (+3) cùng lúc
  assert.equal(exp("1"), 6);
  assert.equal(w.snapshot().community.likes, 1110);
  assert.equal(w.snapshot().community.points, 1110);
});

test("like: hiệu ứng tim bị giới hạn tần suất và cường độ", () => {
  const { likes, step, fxs } = setup();
  likes(1000);
  likes(5);
  assert.equal(fxs().filter((f) => f.name === "hearts").length, 1);
  assert.equal(fxs().find((f) => f.name === "hearts")!.intensity, baseLive.likes.fxMaxIntensity);
  step(baseLive.likes.fxMinIntervalMs);
  likes(5);
  assert.equal(fxs().filter((f) => f.name === "hearts").length, 2);
});

test("thanh năng lượng đầy thì mở sự kiện và về lại gần 0; đang có sự kiện thì không mở thêm", () => {
  const { likes, w, announced, energy } = setup();
  likes(1000);
  assert.equal(energy(), 50);
  likes(1000);
  assert.equal(w.snapshot().event?.id, "productivity_contest");
  assert.deepEqual(announced(), ["productivity_contest"]);
  assert.ok(energy() < 1);
  likes(2000);                                // đầy lần nữa nhưng sự kiện đang chạy
  assert.deepEqual(announced(), ["productivity_contest"]);
  assert.ok(energy() < 1);
});

test("quà ánh xạ theo cấu hình: id → tên (không dấu) → mức value → mặc định", () => {
  const { gift, energy } = setup();
  const energyAfter = (u: string, g: Parameters<typeof gift>[1]) => { const b = energy(); gift(u, g); return +(energy() - b).toFixed(6); };
  assert.equal(energyAfter("a", { giftId: "rose" }), 2);
  assert.equal(energyAfter("b", { giftName: "hoa hong" }), 2);
  assert.equal(energyAfter("c", { giftName: "LY CA PHE" }), 3);
  assert.equal(energyAfter("d", { giftId: "zzz", value: 5 }), 1);
  assert.equal(energyAfter("e", { giftId: "zzz", value: 150 }), 5);
  assert.equal(energyAfter("f", { giftName: "Quà lạ" }), 1);          // không có value → mặc định
});

test("quà tặng EXP cho người đã vào công ty; người lạ nhận lời nhắc, hiệu ứng chung vẫn chạy", () => {
  const { gift, join, exp, feeds, energy } = setup();
  join("1");
  gift("1", { giftId: "rose" });
  assert.equal(exp("1"), baseCfg.exp.sources.event.amount);
  gift("9", { giftId: "rose" });
  assert.ok(feeds().some((t) => t.includes("Nv9") && t.includes("vào công ty")));
  assert.equal(energy(), 4);                  // 2 + 2
});

test("giới hạn quà theo người: phần vượt bị bỏ, hết cửa sổ thì nhận lại", () => {
  const { gift, energy, step, feeds } = setup();
  gift("1", { giftId: "rose", count: 15 });
  assert.equal(energy(), 30);
  gift("1", { giftId: "rose", count: 10 });   // chỉ còn 5 đơn vị
  assert.equal(energy(), 40);
  gift("1", { giftId: "rose", count: 3 });
  assert.equal(energy(), 40);
  assert.ok(feeds().some((t) => t.includes("giới hạn")));
  step(baseLive.gifts.perUser.windowMs);
  gift("1", { giftId: "rose", count: 1 });
  assert.equal(energy(), 42);
});

test("quà mở sự kiện ngẫu nhiên có hồi chiêu", () => {
  const { gift, step, announced, w } = setup({
    live: (c) => { const e = c.events.find((x) => x.id === "inspection")!; e.durationMs = 1_000; e.minIntervalMs = 0; },
  });
  gift("1", { value: 600 });
  assert.deepEqual(announced(), ["inspection"]);
  step(2_000);
  assert.equal(w.snapshot().event, null);
  gift("2", { value: 600 });                  // còn trong hồi chiêu của hiệu ứng random_event
  assert.equal(announced().length, 1);
  step(baseLive.gifts.effectCooldownMs.random_event);
  gift("3", { value: 600 });
  assert.equal(announced().length, 2);
});

test("vé trốn việc từ quà: bỏ qua hồi chiêu một lần, không chồng", () => {
  const { w, cmd, gift, until, toDesk, feeds } = setup({ patrol: NO_GUARDS, profile0: BLIND });
  toDesk("1");
  const a = w.getAvatar("1")!;
  cmd("1", "escape");
  assert.ok(until(() => a.state === "ESCAPED"));
  assert.ok(until(() => a.state === "IDLE", 10_000));
  cmd("1", "work");
  assert.ok(until(() => a.state === "WORKING", 60_000));
  cmd("1", "escape");
  assert.equal(a.state, "WORKING");           // đang hồi chiêu
  assert.ok(feeds().some((t) => t.includes("chờ thêm")));
  gift("1", { value: 150 });
  gift("1", { value: 150 });
  assert.equal(a.tickets, 1);                 // không chồng quá giới hạn
  cmd("1", "escape");
  assert.equal(a.state, "SNEAKING");
  assert.equal(a.tickets, 0);
  assert.ok(until(() => a.state === "ESCAPED"));
  assert.equal(a.wins, 2);
});

test("vé trốn việc hết hạn thì không dùng được", () => {
  const { w, cmd, gift, until, toDesk, step } = setup({ patrol: NO_GUARDS, profile0: BLIND, live: (c) => { c.gifts.ticketTtlMs = 1_000; } });
  toDesk("1");
  const a = w.getAvatar("1")!;
  cmd("1", "escape");
  assert.ok(until(() => a.state === "ESCAPED"));
  assert.ok(until(() => a.state === "IDLE", 10_000));
  cmd("1", "work");
  assert.ok(until(() => a.state === "WORKING", 60_000));
  gift("1", { value: 150 });
  step(2_000);
  cmd("1", "escape");
  assert.equal(a.state, "WORKING");
});

test("bắt đầu phiên theo live_status: Bắt đầu ca làm kéo người đang hoạt động đi làm, EXP ×1,5 rồi trở lại bình thường", () => {
  const { w, cmd, join, step, until, exp, announced, events } = setup({
    live: (c) => { c.events.find((e) => e.id === "shift_start")!.durationMs = 30_000; },
  });
  join("1");
  join("2");
  cmd("2", "dance");
  w.handle({ kind: "live_status", status: "started", at: 0 });
  assert.deepEqual(announced(), ["shift_start"]);
  assert.ok(until(() => w.getAvatar("1")!.state === "WORKING" && w.getAvatar("2")!.state === "WORKING", 60_000));
  assert.equal(w.getAvatar("1")!.room, "workspace");
  const e0 = exp("1");
  step(10_000);
  assert.equal(exp("1") - e0, 3);             // 2 × 1,5
  step(30_000);                                // sự kiện kết thúc
  assert.equal(w.snapshot().event, null);
  assert.ok(events.some((e) => e.kind === "event_end" && e.id === "shift_start"));
  const e1 = exp("1");
  step(10_000);
  assert.equal(exp("1") - e1, 2);
});

test("người đang AFK không bị sự kiện kéo đi", () => {
  const { w, join, step } = setup();
  join("1");
  step(baseCfg.afkAfterMs);
  assert.equal(w.getAvatar("1")!.state, "AFK");
  w.startSession();
  step(5_000);
  assert.equal(w.getAvatar("1")!.state, "AFK");
  assert.equal(w.getAvatar("1")!.room, "lobby");
});

test("lịch phiên: sự kiện đến giờ chạy; sự kiện đến khi đang bận thì xếp hàng chờ", () => {
  const { w, step, announced } = setup({
    live: (c) => {
      c.schedule = [{ event: "shift_start", atMs: 0 }, { event: "lunch", atMs: 1_000 }];
      c.events.find((e) => e.id === "shift_start")!.durationMs = 5_000;
    },
  });
  w.startSession();
  step(500);
  assert.deepEqual(announced(), ["shift_start"]);
  step(2_000);
  assert.deepEqual(announced(), ["shift_start"]);        // lunch chờ vì shift_start còn chạy
  step(4_000);
  assert.deepEqual(announced(), ["shift_start", "lunch"]);
});

test("mỗi lúc chỉ một sự kiện; cùng sự kiện không lặp trong thời gian hồi", () => {
  const { w, step } = setup();
  assert.equal(w.triggerEvent("printer_jam"), true);
  assert.equal(w.triggerEvent("blackout"), false);
  step(baseLive.events.find((e) => e.id === "printer_jam")!.durationMs + 100);
  assert.equal(w.triggerEvent("printer_jam"), false);     // còn trong minIntervalMs
  assert.equal(w.triggerEvent("blackout"), true);
  assert.throws(() => w.triggerEvent("khong_co"));
});

test("sự kiện ngẫu nhiên chỉ chạy khi có phiên và tôn trọng khoảng nghỉ chung", () => {
  const { w, step, announced } = setup({
    live: (c) => { shortEvents(c); c.schedule = []; c.random.checkEveryMs = 1_000; c.random.globalMinGapMs = 5_000; },
  });
  step(10_000);
  assert.equal(announced().length, 0);                    // chưa bắt đầu phiên
  w.startSession();
  step(4_000);                                            // sự kiện đầu ở giây 1
  assert.equal(announced().length, 1);
  step(1_500);                                            // giây 5,5: chưa đủ 5 giây kể từ sự kiện trước
  assert.equal(announced().length, 1);
  step(1_500);                                            // giây 7: lần kiểm tra ở giây 6 đã mở sự kiện thứ hai
  assert.equal(announced().length, 2);
});

test("mất điện: tắt camera, máy tính ngừng cộng EXP làm việc", () => {
  const camera = { patrol: [{ id: "far", waypoints: [{ x: 2, y: 30 }] }], profile0: { cameras: 3, visionRange: 4, reactionMs: 800 } };
  const guardStates = (blackout: boolean) => {
    const { w, cmd, until, toDesk, step } = setup({ ...camera, live: (c) => { c.events.find((e) => e.id === "blackout")!.durationMs = 600_000; } });
    toDesk("1");
    if (blackout) {
      w.triggerEvent("blackout");
      const e0 = w.getAvatar("1")!.exp;
      step(30_000);
      assert.equal(w.getAvatar("1")!.exp, e0);              // EXP làm việc ×0
    }
    const a = w.getAvatar("1")!;
    cmd("1", "escape");
    const seen = new Set<string>();
    until(() => { w.snapshot().guards.forEach((g) => seen.add(g.state)); return a.state === "ESCAPED" || a.state === "CAUGHT"; });
    return seen;
  };
  assert.ok(guardStates(false).has("INVESTIGATE"));
  assert.ok(!guardStates(true).has("INVESTIGATE"));
});

test("kiểm tra đột xuất: người đang ngồi làm việc được thưởng, người khác thì không", () => {
  const { w, toDesk, join, exp } = setup();
  toDesk("1"); join("2");
  const [e1, e2] = [exp("1"), exp("2")];
  w.triggerEvent("inspection");
  assert.equal(exp("1") - e1, baseCfg.exp.sources.event.amount);
  assert.equal(exp("2"), e2);
});

test("sinh nhật: một người được thưởng lớn, cả công ty được thưởng nhỏ", () => {
  const { w, join, exp, feeds } = setup();
  join("1"); join("2"); join("3");
  w.triggerEvent("birthday");
  assert.equal(exp("1"), baseCfg.exp.sources.achievement.amount);   // random()=0 → người đầu tiên
  assert.equal(exp("2"), baseCfg.exp.sources.event.amount);
  assert.equal(exp("3"), baseCfg.exp.sources.event.amount);
  assert.ok(feeds().some((t) => t.includes("sinh nhật của Nv1")));
});

test("thi đua năng suất: xếp hạng theo thời gian làm việc, thưởng top 3", () => {
  const { w, cmd, toDesk, step, exp, feeds } = setup({
    cfg: (c) => { c.exp.sources.work.everyMs = 1e9; },                // tắt EXP làm việc để chỉ đo phần thưởng thi đua
    live: (c) => { c.events.find((e) => e.id === "productivity_contest")!.durationMs = 6_000; },
  });
  toDesk("1"); toDesk("2"); toDesk("3");
  w.triggerEvent("productivity_contest");
  step(2_000);
  cmd("2", "rest");                                                  // người 2 bỏ ngang sau 2 giây
  step(1_000);
  cmd("3", "rest");                                                  // người 3 bỏ ngang sau 3 giây
  const before = [exp("1"), exp("2"), exp("3")];
  step(4_000);
  assert.equal(exp("1") - before[0], baseCfg.exp.sources.achievement.amount);
  assert.equal(exp("3") - before[2], baseCfg.exp.sources.event.amount);
  assert.equal(exp("2") - before[1], baseCfg.exp.sources.event.amount);
  assert.ok(feeds().some((t) => t.includes("1. Nv1")));
  assert.ok(feeds().some((t) => /2\. Nv3/.test(t)));
});

test("kết thúc phiên: Kết thúc ngày làm đưa mọi người về sảnh và dừng lịch/sự kiện ngẫu nhiên", () => {
  const { w, toDesk, step, announced, until } = setup({
    live: (c) => { shortEvents(c); c.schedule = []; c.random.checkEveryMs = 1_000; c.random.globalMinGapMs = 0; },
  });
  toDesk("1");
  w.startSession();
  step(2_500);
  w.handle({ kind: "live_status", status: "ended", at: 0 });
  assert.equal(announced().at(-1), "shift_end");
  assert.ok(until(() => w.getAvatar("1")!.room === "lobby" && w.getAvatar("1")!.state === "IDLE", 60_000));
  const n = announced().length;
  step(30_000);
  assert.equal(announced().length, n);
});

test("kết thúc phiên giữa lúc có sự kiện khác: Kết thúc ngày làm thay thế ngay", () => {
  const { w } = setup();
  w.startSession();
  w.triggerEvent("printer_jam");
  w.endSession();
  assert.equal(w.snapshot().event?.id, "shift_end");
});
