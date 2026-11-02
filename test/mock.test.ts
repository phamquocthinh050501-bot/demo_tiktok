import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLiveProvider } from "../src/server/providers/mock.ts";
import type { LiveEvent } from "../src/core/events/types.ts";

test("mock: trạng thái 'mock' sau connect, về 'disconnected' sau disconnect", async () => {
  const m = new MockLiveProvider();
  assert.equal(m.getStatus(), "disconnected");
  await m.connect();
  assert.equal(m.getStatus(), "mock");
  await m.disconnect();
  assert.equal(m.getStatus(), "disconnected");
});

test("mock không phát event khi chưa connect", () => {
  const m = new MockLiveProvider();
  const got: LiveEvent[] = [];
  m.onEvent((e) => got.push(e));
  m.sendComment("An", "đi làm");
  assert.equal(got.length, 0);
});

test("mock phát comment/like/gift/live_status với eventId duy nhất và log lại", async () => {
  const m = new MockLiveProvider({ now: () => 42 });
  const got: LiveEvent[] = [];
  const off = m.onEvent((e) => got.push(e));
  await m.connect();
  m.sendComment("An", "đi làm", "u1");
  m.sendLike("An", 5, "u1");
  m.sendGift("An", { giftId: "rose", giftName: "Hoa hồng", count: 2, value: 1 }, "u1");
  m.setLive(true);
  assert.deepEqual(got.map((e) => e.type), ["comment", "like", "gift", "live_status"]);
  assert.equal(new Set(got.map((e) => e.eventId)).size, 4);
  assert.equal(got[0].occurredAt, 42);
  assert.equal(m.log.length, 4);
  off();
  m.sendComment("An", "đi họp");
  assert.equal(got.length, 4);
});

test("mock: emitRaw cho phép gửi lại event trùng để thử dedupe", async () => {
  const m = new MockLiveProvider();
  const got: LiveEvent[] = [];
  m.onEvent((e) => got.push(e));
  await m.connect();
  const ev: LiveEvent = { eventId: "dup", type: "comment", displayName: "An", text: "đi làm", occurredAt: 1 };
  m.emitRaw(ev); m.emitRaw(ev);
  assert.equal(got.length, 2);
});

test("mock: capabilities không khẳng định viewerCount", () => {
  const c = new MockLiveProvider().capabilities();
  assert.equal(c.comments && c.likes && c.gifts && c.liveStatus, true);
  assert.equal(c.viewerCount, false);
});

test("mock: playScript phát chuỗi bước theo thứ tự", async () => {
  const m = new MockLiveProvider();
  const got: LiveEvent[] = [];
  m.onEvent((e) => got.push(e));
  await m.connect();
  await m.playScript([
    { do: "comment", name: "A", text: "vào công ty" },
    { do: "like", name: "A", count: 3 },
    { do: "gift", name: "A", giftId: "rose", count: 1 },
  ], async () => {});
  assert.deepEqual(got.map((e) => e.type), ["comment", "like", "gift"]);
});
