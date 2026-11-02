import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, loadGameConfig, validateGameConfig } from "../src/server/game.ts";
import { applyStep, createDemo } from "../src/server/demo.ts";
import type { GameEvent } from "../src/core/rules/world.ts";

const config = loadGameConfig();

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeGame(seed = 1) {
  const clock = { t: 5_000_000 };
  const game = createGame(config, { now: () => clock.t, random: mulberry32(seed) });
  const events: GameEvent[] = [];
  game.onGameEvent((e) => events.push(e));
  const tick = (ms: number) => { for (let t = 0; t < ms; t += 100) { clock.t += 100; game.tick(100); } };
  return { game, clock, events, tick };
}

test("cấu hình thật hợp lệ", () => {
  assert.deepEqual(validateGameConfig(config), []);
});

test("validateGameConfig bắt lệnh chưa có xử lý và phòng không tồn tại", () => {
  const bad = structuredClone(config);
  bad.commands.commands.push({ id: "bay_len_troi", group: "move", aliases: ["bay lên trời"] });
  bad.gameplay.moves.work.room = "phong_la";
  const errs = validateGameConfig(bad);
  assert.ok(errs.some((e) => e.includes("bay_len_troi")));
  assert.ok(errs.some((e) => e.includes("phong_la")));
});

test("mock provider → pipeline → world: comment tiếng Việt điều khiển avatar, chỉ chạy khi tick", async () => {
  const { game, tick } = makeGame();
  await game.provider.connect();
  game.provider.sendComment("Lan Anh", "VÀO CÔNG TY", "u1");
  assert.equal(game.world.snapshot().avatars.length, 0);          // callback provider không chạy gameplay
  tick(100);
  assert.equal(game.world.snapshot().avatars.length, 1);
  game.provider.sendComment("Lan Anh", "di lam", "u1");
  tick(60_000);
  assert.equal(game.world.getAvatar("u1")!.state, "WORKING");
  game.provider.sendComment("Lan Anh", "vào công ty", "u1");
  tick(100);
  assert.equal(game.world.snapshot().avatars.length, 1);          // không nhân bản
});

test("like được gộp theo batch rồi mới vào luật; gift chạy theo cấu hình; event trùng bị bỏ", async () => {
  const { game, tick, events } = makeGame();
  await game.provider.connect();
  for (let i = 0; i < 50; i++) game.provider.sendLike("a", 2, "u1");
  tick(500);
  assert.equal(game.world.snapshot().community.likes, 0);          // chưa tới hạn batch
  tick(1_000);
  assert.equal(game.world.snapshot().community.likes, 100);
  game.provider.sendGift("a", { giftId: "rose", giftName: "Hoa hồng", count: 1 }, "u1");
  game.provider.emitRaw({ eventId: "dup-1", type: "gift", userId: "u2", displayName: "b", giftId: "rose", count: 1, occurredAt: 0 });
  game.provider.emitRaw({ eventId: "dup-1", type: "gift", userId: "u2", displayName: "b", giftId: "rose", count: 1, occurredAt: 0 });
  tick(200);
  assert.equal(events.filter((e) => e.kind === "feed" && e.text.includes("Cảm ơn b")).length, 1);
  assert.equal(game.pipeline.stats.duplicate, 1);
});

test("live_status từ provider mở và đóng phiên", async () => {
  const { game, tick, events } = makeGame();
  await game.provider.connect();
  game.provider.setLive(true);
  tick(200);
  assert.ok(events.some((e) => e.kind === "announce" && e.id === "shift_start"));
  game.provider.setLive(false);
  tick(200);
  assert.ok(events.some((e) => e.kind === "announce" && e.id === "shift_end"));
});

test("kịch bản demo chạy 5 phút qua toàn bộ pipeline mà không lỗi", async () => {
  const { game, tick, events } = makeGame(7);
  await game.provider.connect();
  const demo = createDemo({ random: mulberry32(11), texts: Object.fromEntries(config.commands.commands.map((c) => [c.id, c.aliases[0]])) });
  for (let t = 0; t < 300_000; t += 100) {
    for (const s of demo.tick(100)) applyStep(game.provider, s);
    tick(100);
  }
  const snap = game.world.snapshot();
  assert.ok(snap.avatars.length >= 25, `chỉ có ${snap.avatars.length} avatar`);
  assert.ok(new Set(snap.avatars.map((a) => a.room)).size >= 3, "avatar phải ở nhiều phòng khác nhau");
  assert.ok(snap.community.likes > 0);
  assert.ok(events.some((e) => e.kind === "fx"));
  assert.ok(game.pipeline.stats.unknownComment === 0, "demo chỉ gửi lệnh hợp lệ");
  assert.ok(new Set(snap.avatars.map((a) => a.id)).size === snap.avatars.length);
});
