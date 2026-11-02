import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createParser } from "../src/core/commands/parser.ts";
import { createPipeline } from "../src/core/events/pipeline.ts";
import type { GameAction } from "../src/core/events/types.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const parser = createParser(read("../config/commands.json").commands);
const baseLimits = read("../config/limits.json");

function setup(over: Record<string, unknown> = {}) {
  const clock = { t: 1_000_000 };
  const actions: GameAction[] = [];
  const p = createPipeline({
    limits: { ...baseLimits, ...over },
    parser,
    now: () => clock.t,
    onAction: (a) => actions.push(a),
  });
  return { clock, actions, p };
}
const comment = (userId: string | undefined, text: string, extra = {}) =>
  ({ type: "comment", userId, displayName: `u${userId}`, text, occurredAt: 0, ...extra });

test("comment hợp lệ thành command kèm userKey ổn định", () => {
  const { p, actions } = setup();
  p.ingest(comment("1", "Đi làm"));
  p.drain();
  assert.equal(actions.length, 1);
  const a = actions[0];
  assert.ok(a.kind === "command");
  assert.equal(a.commandId, "work");
  assert.equal(a.userKey, "1");
  assert.equal(a.identityStable, true);
});

test("thiếu userId dùng khóa tạm theo nickname và báo identityStable=false", () => {
  const { p, actions } = setup();
  p.ingest({ type: "comment", displayName: "Lan Anh", text: "đi họp", occurredAt: 0 });
  p.drain();
  const a = actions[0];
  assert.ok(a.kind === "command");
  assert.equal(a.identityStable, false);
  assert.match(a.userKey, /^tmp:/);
});

test("comment không phải lệnh bị bỏ và được đếm", () => {
  const { p, actions } = setup();
  p.ingest(comment("1", "xin chào mọi người"));
  p.drain();
  assert.equal(actions.length, 0);
  assert.equal(p.stats.unknownComment, 1);
});

test("event trùng eventId không tạo hành động lặp", () => {
  const { p, actions } = setup();
  p.ingest(comment("1", "đi làm", { eventId: "e1" }));
  assert.equal(p.ingest(comment("2", "đi làm", { eventId: "e1" })), false);
  p.drain();
  assert.equal(actions.length, 1);
  assert.equal(p.stats.duplicate, 1);
});

test("cooldown theo người và nhóm lệnh", () => {
  const { p, actions, clock } = setup();
  const run = (uid: string, text: string) => { p.ingest(comment(uid, text)); p.drain(); };
  run("1", "đi làm");
  run("1", "đi họp");     // cùng nhóm move → chặn
  run("1", "nhảy đi");    // nhóm khác → qua
  run("2", "đi họp");     // người khác → qua
  assert.deepEqual(actions.map((a) => a.kind === "command" && a.commandId), ["work", "dance", "meeting"]);
  assert.equal(p.stats.cooledDown, 1);
  clock.t += baseLimits.cooldownMs.move;
  run("1", "đi họp");
  assert.equal(actions.length, 4);
});

test("rate limit toàn hệ thống khi bão comment", () => {
  const { p, actions } = setup();
  for (let i = 0; i < 100; i++) p.ingest(comment(String(i), "đi làm"));
  p.drain();
  assert.equal(actions.length, baseLimits.globalRate.capacity);
  assert.equal(p.stats.rateLimited, 100 - baseLimits.globalRate.capacity);
});

test("queue đầy thì từ chối (backpressure) và không throw", () => {
  const { p } = setup({ queueMax: 3 });
  const r = [1, 2, 3, 4, 5].map((i) => p.ingest(comment(String(i), "đi làm")));
  assert.deepEqual(r, [true, true, true, false, false]);
  assert.equal(p.stats.dropped, 2);
});

test("like được gộp theo batch, không phát từng lượt", () => {
  const { p, actions, clock } = setup();
  for (let i = 0; i < 1000; i++) p.ingest({ type: "like", userId: "1", displayName: "a", count: 1, occurredAt: 0 });
  p.flushLikes();
  assert.equal(actions.length, 0);            // chưa tới hạn
  clock.t += baseLimits.likeBatchMs;
  p.flushLikes();
  assert.deepEqual(actions, [{ kind: "likes", count: 1000, at: clock.t }]);
  p.flushLikes();
  assert.equal(actions.length, 1);            // không phát lại
});

test("gift đi thẳng, không bị rate limit comment, count/value được làm sạch", () => {
  const { p, actions } = setup({ globalRate: { capacity: 0, refillPerSec: 0 } });
  p.ingest({ type: "gift", userId: "9", displayName: "Vip", giftId: "rose", giftName: "Hoa hồng", count: -3, value: "abc", occurredAt: 0 });
  p.drain();
  const a = actions[0];
  assert.ok(a.kind === "gift");
  assert.equal(a.count, 1);
  assert.equal(a.value, undefined);
  assert.equal(a.giftId, "rose");
});

test("live_status đi qua pipeline", () => {
  const { p, actions } = setup();
  p.ingest({ type: "live_status", status: "started", occurredAt: 0 });
  p.drain();
  assert.equal(actions[0].kind, "live_status");
});

test("dữ liệu rác bị từ chối, không throw", () => {
  const { p, actions } = setup();
  for (const bad of [null, undefined, 5, "x", {}, { type: "comment" }, { type: "comment", displayName: "a", text: 7 }, { type: "boom" }]) {
    assert.equal(p.ingest(bad), false);
  }
  p.drain();
  assert.equal(actions.length, 0);
  assert.equal(p.stats.invalid, 8);
});

test("nickname bị cắt độ dài và bỏ ký tự điều khiển", () => {
  const { p, actions } = setup();
  p.ingest({ type: "comment", userId: "1", displayName: "  A\u0000B" + "x".repeat(100), text: "đi làm", occurredAt: 0 });
  p.drain();
  const a = actions[0];
  assert.ok(a.kind === "command");
  assert.equal(a.displayName.length, baseLimits.maxNameLength);
  assert.ok(a.displayName.startsWith("AB"));
});

test("comment quá dài bị từ chối", () => {
  const { p } = setup();
  assert.equal(p.ingest(comment("1", "a".repeat(baseLimits.maxCommentLength + 1))), false);
});
