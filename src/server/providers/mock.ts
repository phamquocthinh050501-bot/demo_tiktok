import type { LiveEvent, ProviderStatus } from "../../core/events/types.ts";
import type { LiveProvider, ProviderCapabilities } from "./provider.ts";

const MAX_LOG = 500;

export type MockStep =
  | { do: "comment"; name: string; text: string; userId?: string; waitMs?: number }
  | { do: "like"; name: string; count: number; userId?: string; waitMs?: number }
  | { do: "gift"; name: string; giftId?: string; giftName?: string; count: number; value?: number; userId?: string; waitMs?: number };

// Nguồn giả lập: chỉ phát event khi đã connect, trạng thái luôn là "mock" để UI không nhầm với LIVE thật.
export class MockLiveProvider implements LiveProvider {
  readonly log: LiveEvent[] = [];
  #status: ProviderStatus = "disconnected";
  #handlers = new Set<(e: LiveEvent) => void>();
  #seq = 0;
  #now: () => number;

  constructor(opts: { now?: () => number } = {}) { this.#now = opts.now ?? Date.now; }

  async connect() { this.#status = "mock"; }
  async disconnect() { this.#status = "disconnected"; }
  getStatus() { return this.#status; }
  capabilities(): ProviderCapabilities {
    return { comments: true, likes: true, gifts: true, liveStatus: true, viewerCount: false };
  }
  onEvent(handler: (e: LiveEvent) => void) {
    this.#handlers.add(handler);
    return () => { this.#handlers.delete(handler); };
  }

  emitRaw(e: LiveEvent) {
    if (this.#status !== "mock") return;
    this.log.push(e);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG); // không để log phình mãi trong buổi LIVE dài
    for (const h of this.#handlers) h(e);
  }
  #id = () => `mock-${++this.#seq}`;

  sendComment(displayName: string, text: string, userId?: string) {
    this.emitRaw({ eventId: this.#id(), type: "comment", userId, displayName, text, occurredAt: this.#now() });
  }
  sendLike(displayName: string, count: number, userId?: string) {
    this.emitRaw({ eventId: this.#id(), type: "like", userId, displayName, count, occurredAt: this.#now() });
  }
  sendGift(displayName: string, g: { giftId?: string; giftName?: string; count: number; value?: number }, userId?: string) {
    this.emitRaw({ eventId: this.#id(), type: "gift", userId, displayName, ...g, occurredAt: this.#now() });
  }
  setLive(started: boolean) {
    this.emitRaw({ eventId: this.#id(), type: "live_status", status: started ? "started" : "ended", occurredAt: this.#now() });
  }

  async playScript(steps: MockStep[], sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    for (const s of steps) {
      if (s.do === "comment") this.sendComment(s.name, s.text, s.userId);
      else if (s.do === "like") this.sendLike(s.name, s.count, s.userId);
      else this.sendGift(s.name, s, s.userId);
      await sleep(s.waitMs ?? 0);
    }
  }
}
