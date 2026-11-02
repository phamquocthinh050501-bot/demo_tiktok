import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, loadGameConfig } from "../src/server/game.ts";
import { createController } from "../src/server/control.ts";
import type { GameEvent } from "../src/core/rules/world.ts";

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
async function setup() {
  const config = loadGameConfig();
  const clock = { t: 9_000_000 };
  const game = createGame(config, { now: () => clock.t, random: mulberry32(3) });
  await game.provider.connect();
  const events: GameEvent[] = [];
  game.onGameEvent((e) => events.push(e));
  const ctl = createController({ game, config, now: () => clock.t, random: mulberry32(5) });
  const tick = (ms: number) => { for (let t = 0; t < ms; t += 100) { clock.t += 100; ctl.tick(100); } };
  const announced = () => events.filter((e) => e.kind === "announce").map((e) => (e as { id: string }).id);
  const say = (name: string, text: string) => ctl.handle({ type: "mock.comment", name, userId: `u-${name}`, text });
  return { config, game, ctl, tick, events, announced, say };
}
type Ctl = Awaited<ReturnType<typeof setup>>["ctl"];
const state = (ctl: Ctl) => ctl.dash().session.state;

test("phiên: chưa bắt đầu → chạy → tạm dừng → tiếp tục → kết thúc → bắt đầu lại", async () => {
  const { ctl, tick, announced } = await setup();
  assert.equal(state(ctl), "idle");
  assert.equal(ctl.handle({ type: "session", action: "pause" }).ok, false);   // chưa chạy thì không tạm dừng được
  assert.equal(ctl.handle({ type: "session", action: "start" }).ok, true);
  assert.equal(state(ctl), "running");
  tick(200);
  assert.deepEqual(announced(), ["shift_start"]);
  assert.equal(ctl.handle({ type: "session", action: "start" }).ok, false);   // đang chạy rồi
  assert.equal(ctl.handle({ type: "session", action: "pause" }).ok, true);
  assert.equal(state(ctl), "paused");
  assert.equal(ctl.handle({ type: "session", action: "resume" }).ok, true);
  assert.equal(ctl.handle({ type: "session", action: "end" }).ok, true);
  assert.equal(state(ctl), "ended");
  tick(200);
  assert.equal(announced().at(-1), "shift_end");
  assert.equal(ctl.handle({ type: "session", action: "pause" }).ok, false);
  assert.equal(ctl.handle({ type: "session", action: "start" }).ok, true);   // phiên mới
  assert.equal(state(ctl), "running");
});

test("tạm dừng: game đứng yên nhưng comment vẫn xếp hàng, tiếp tục thì xử lý", async () => {
  const { ctl, game, tick, say } = await setup();
  ctl.handle({ type: "session", action: "start" });
  say("An", "vào công ty");
  tick(200);
  assert.equal(game.world.snapshot().avatars.length, 1);
  ctl.handle({ type: "session", action: "pause" });
  say("Bình", "vào công ty");
  tick(5_000);
  assert.equal(game.world.snapshot().avatars.length, 1);
  ctl.handle({ type: "session", action: "resume" });
  tick(200);
  assert.equal(game.world.snapshot().avatars.length, 2);
});

test("LIVE giả lập bật/tắt đồng bộ trạng thái phiên", async () => {
  const { ctl, tick, announced } = await setup();
  assert.equal(ctl.handle({ type: "mock.live", started: true }).ok, true);
  assert.equal(state(ctl), "running");
  tick(200);
  assert.deepEqual(announced(), ["shift_start"]);
  ctl.handle({ type: "mock.live", started: false });
  assert.equal(state(ctl), "ended");
});

test("Mock: comment, like, gift đi qua pipeline như event thật; dữ liệu sai bị từ chối", async () => {
  const { ctl, game, tick, say, events } = await setup();
  assert.equal(say("Lan Anh", "VÀO CÔNG TY").ok, true);
  tick(200);
  assert.equal(game.world.snapshot().avatars[0].name, "Lan Anh");
  assert.equal(ctl.handle({ type: "mock.like", name: "Lan Anh", count: 120 }).ok, true);
  tick(1_200);
  assert.equal(game.world.snapshot().community.likes, 120);
  assert.equal(ctl.handle({ type: "mock.gift", name: "Lan Anh", userId: "u-Lan Anh", giftId: "rose", giftName: "Hoa hồng", count: 2 }).ok, true);
  tick(200);
  assert.ok(events.some((e) => e.kind === "feed" && e.text.includes("Cảm ơn Lan Anh")));

  for (const bad of [
    { type: "mock.comment", name: "A", text: "" },
    { type: "mock.comment", name: "A", text: "x".repeat(500) },
    { type: "mock.comment", name: 5, text: "đi làm" },
    { type: "mock.like", name: "A", count: -3 },
    { type: "mock.like", name: "A", count: 1e9 },
    { type: "mock.gift", name: "A", count: 0 },
    { type: "mock.gift", name: "A", count: 1, value: "nhiều" },
  ]) {
    const r = ctl.handle(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.errors?.length);
  }
});

test("tin điều khiển lạ hoặc rác bị từ chối, không ném lỗi", async () => {
  const { ctl } = await setup();
  for (const bad of [null, undefined, 5, "x", [], {}, { type: "xoa_tat_ca" }, { type: "session" }, { type: "session", action: "no" }]) {
    assert.equal(ctl.handle(bad).ok, false);
  }
});

test("Mock bị khóa khi provider không ở chế độ mô phỏng", async () => {
  const { ctl, game } = await setup();
  await game.provider.disconnect();
  const r = ctl.handle({ type: "mock.comment", name: "A", text: "đi làm" });
  assert.equal(r.ok, false);
  assert.ok(r.errors![0].includes("mô phỏng"));
});

test("kịch bản demo bật/tắt được; tắt thì không sinh người mới", async () => {
  const { ctl, game, tick } = await setup();
  assert.equal(ctl.dash().demo, false);
  ctl.handle({ type: "mock.demo", on: true });
  assert.equal(ctl.dash().demo, true);
  tick(20_000);
  const n = game.world.snapshot().avatars.length;
  assert.ok(n >= 8, `chỉ có ${n}`);
  ctl.handle({ type: "mock.demo", on: false });
  tick(10_000);
  assert.equal(game.world.snapshot().avatars.length, n);
});

test("overlay OBS bật/tắt từng loại", async () => {
  const { ctl } = await setup();
  assert.deepEqual(ctl.dash().overlay, { full: true, compact: true });
  assert.equal(ctl.handle({ type: "overlay", which: "compact", on: false }).ok, true);
  assert.deepEqual(ctl.dash().overlay, { full: true, compact: false });
  assert.equal(ctl.handle({ type: "overlay", which: "khac", on: false }).ok, false);
});

test("dash: số người xem không khả dụng với nguồn mô phỏng; bảng xếp hạng theo EXP; log có giới hạn", async () => {
  const { ctl, game, tick, say } = await setup();
  for (const [i, n] of ["An", "Bình", "Chi"].entries()) { say(n, "vào công ty"); tick(200); game.world.grantExp(`u-${n}`, "achievement"); if (i > 0) game.world.grantExp(`u-${n}`, "achievement"); }
  for (let i = 0; i < 80; i++) ctl.handle({ type: "mock.like", name: "An", count: 1 });
  const d = ctl.dash();
  assert.equal(d.viewers, null);
  assert.equal(d.provider.mock, true);
  assert.deepEqual(d.leaderboard.map((r: { name: string }) => r.name), ["Bình", "Chi", "An"]);
  assert.ok(d.mockLog.length <= 40);
  assert.ok(d.mockLog.every((r: { type: string }) => typeof r.type === "string"));
});

test("chỉnh cooldown / giới hạn avatar: hợp lệ thì có hiệu lực ngay, sai thì giữ nguyên", async () => {
  const { ctl, game, tick, say, config } = await setup();
  const before = structuredClone(config.limits);
  for (const bad of [
    { cooldownMs: { move: -1 } }, { cooldownMs: { move: "nhanh" } }, { cooldownMs: { bay: 1000 } },
    { maxAvatars: 0 }, { maxAvatars: 1.5 }, { globalRate: { capacity: 0 } },
  ]) {
    const r = ctl.handle({ type: "config.limits", ...bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(config.limits, before);

  assert.equal(ctl.handle({ type: "config.limits", cooldownMs: { move: 0 }, maxAvatars: 1 }).ok, true);
  say("An", "vào công ty"); say("Bình", "vào công ty");
  tick(200);
  assert.equal(game.world.snapshot().avatars.length, 1);                  // chỉ còn 1 chỗ
  say("An", "đi làm"); say("An", "đi họp");                              // cooldown di chuyển = 0 nên cả hai qua
  tick(200);
  assert.equal(game.world.getAvatar("u-An")!.room, "meeting");
});

test("chỉnh độ khó: kiểm tra giới hạn và tăng dần như cấu hình gốc", async () => {
  const { ctl, config } = await setup();
  const good = structuredClone(config.escape.profiles);
  good[0].reactionMs = 1600;
  assert.equal(ctl.handle({ type: "config.difficulty", profiles: good }).ok, true);
  assert.equal(config.escape.profiles[0].reactionMs, 1600);

  const bad = structuredClone(good);
  bad[3].guards = 0;
  const r = ctl.handle({ type: "config.difficulty", profiles: bad });
  assert.equal(r.ok, false);
  assert.ok(r.errors!.some((e) => e.includes("guards")));
  assert.equal(config.escape.profiles[3].guards, good[3].guards);          // giữ nguyên

  assert.equal(ctl.handle({ type: "config.difficulty", profiles: good.slice(0, 3) }).ok, false);
  assert.equal(ctl.handle({ type: "config.difficulty", profiles: "x" }).ok, false);
});

test("chỉnh quà tặng: kiểm tra như cấu hình gốc, hợp lệ thì áp dụng ngay", async () => {
  const { ctl, game, config } = await setup();
  const gifts = structuredClone(config.live.gifts);
  gifts.rules[0].effects = [{ type: "energy", amount: 10 }];
  assert.equal(ctl.handle({ type: "config.gifts", gifts }).ok, true);
  const e0 = game.world.snapshot().community.energy;
  ctl.handle({ type: "mock.gift", name: "A", userId: "u1", giftId: "rose", count: 1 });
  game.tick(100);
  assert.equal(game.world.snapshot().community.energy - e0, 10);

  const bad = structuredClone(gifts);
  (bad.rules[0].effects as unknown[]) = [{ type: "bay_len_troi" }];
  const r = ctl.handle({ type: "config.gifts", gifts: bad });
  assert.equal(r.ok, false);
  assert.ok(r.errors!.some((e) => e.includes("bay_len_troi")));
  assert.equal(config.live.gifts.rules[0].effects[0].type, "energy");
});

test("tin cấu hình gửi cho dashboard có lệnh tiếng Việt, mô tả và nhóm", async () => {
  const { ctl } = await setup();
  const c = ctl.configMsg();
  assert.equal(c.type, "config");
  assert.ok(c.commands.length >= 13);
  assert.ok(c.commands.every((x: { description: string; aliases: string[] }) => x.description && x.aliases.length));
  assert.equal(c.groups.move, "Di chuyển");
  assert.equal(c.ranks.length, 7);
});
