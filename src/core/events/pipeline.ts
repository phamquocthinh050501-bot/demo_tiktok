import type { GameAction, LiveEvent } from "./types.ts";
import type { ParsedCommand } from "../commands/parser.ts";
import { normalizeText } from "../commands/normalizeText.ts";

export interface Limits {
  maxCommentLength: number;
  maxNameLength: number;
  queueMax: number;
  drainPerTick: number;
  dedupeCapacity: number;
  globalRate: { capacity: number; refillPerSec: number };
  likeBatchMs: number;
  cooldownMs: Record<string, number>;
}

interface Deps {
  limits: Limits;
  parser: { parse(text: string): ParsedCommand | null };
  now: () => number;
  onAction: (a: GameAction) => void;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const COOLDOWN_PRUNE_AT = 10_000;

// Event đi vào chỉ được validate/xếp hàng; gameplay chạy ở drain(), không chạy trong callback của provider.
export function createPipeline({ limits, parser, now, onAction }: Deps) {
  const stats = { invalid: 0, duplicate: 0, dropped: 0, rateLimited: 0, cooledDown: 0, unknownComment: 0 };
  const seen = new Set<string>();
  const queue: LiveEvent[] = [];
  const lastUse = new Map<string, number>();
  let tokens = limits.globalRate.capacity;
  let tokenAt = now();
  let pendingLikes = 0;
  let likeFlushAt = now();

  const cleanName = (v: unknown) => {
    const s = typeof v === "string" ? v.replace(CONTROL, "").trim().slice(0, limits.maxNameLength) : "";
    return s || "Ẩn danh";
  };
  const identity = (userId: unknown, name: string) =>
    typeof userId === "string" && userId
      ? { userKey: userId, identityStable: true }
      : { userKey: `tmp:${normalizeText(name)}`, identityStable: false };

  function normalize(raw: unknown): LiveEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    const occurredAt = Number.isFinite(e.occurredAt) ? (e.occurredAt as number) : now();
    const eventId = typeof e.eventId === "string" && e.eventId ? e.eventId : undefined;
    const userId = typeof e.userId === "string" ? e.userId : undefined;
    switch (e.type) {
      case "comment":
        if (typeof e.text !== "string" || !e.text.trim() || e.text.length > limits.maxCommentLength) return null;
        return { type: "comment", eventId, userId, displayName: cleanName(e.displayName), text: e.text, occurredAt };
      case "like": {
        const count = Math.floor(Number(e.count));
        if (!(count >= 1)) return null;
        return { type: "like", eventId, userId, count, occurredAt };
      }
      case "gift": {
        const count = Math.floor(Number(e.count));
        const value = typeof e.value === "number" && Number.isFinite(e.value) && e.value >= 0 ? e.value : undefined;
        return {
          type: "gift", eventId, userId, displayName: cleanName(e.displayName),
          giftId: typeof e.giftId === "string" ? e.giftId : undefined,
          giftName: typeof e.giftName === "string" ? e.giftName : undefined,
          count: count >= 1 ? count : 1, value, occurredAt,
        };
      }
      case "live_status":
        return e.status === "started" || e.status === "ended"
          ? { type: "live_status", eventId, status: e.status, occurredAt } : null;
      default:
        return null;
    }
  }

  function ingest(raw: unknown): boolean {
    const ev = normalize(raw);
    if (!ev) { stats.invalid++; return false; }
    if (ev.eventId) {
      if (seen.has(ev.eventId)) { stats.duplicate++; return false; }
      seen.add(ev.eventId);
      if (seen.size > limits.dedupeCapacity) seen.delete(seen.values().next().value as string);
    }
    if (ev.type === "like") { pendingLikes += ev.count; return true; }
    if (queue.length >= limits.queueMax) { stats.dropped++; return false; }
    queue.push(ev);
    return true;
  }

  function takeToken(t: number): boolean {
    const { capacity, refillPerSec } = limits.globalRate;
    tokens = Math.min(capacity, tokens + ((t - tokenAt) / 1000) * refillPerSec);
    tokenAt = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  function handleComment(ev: Extract<LiveEvent, { type: "comment" }>, t: number) {
    const cmd = parser.parse(ev.text);
    if (!cmd) { stats.unknownComment++; return; }
    const id = identity(ev.userId, ev.displayName);
    const key = `${id.userKey}|${cmd.group}`;
    const last = lastUse.get(key);
    if (last !== undefined && t - last < (limits.cooldownMs[cmd.group] ?? 0)) { stats.cooledDown++; return; }
    if (!takeToken(t)) { stats.rateLimited++; return; }
    lastUse.set(key, t);
    if (lastUse.size > COOLDOWN_PRUNE_AT) {
      const maxCd = Math.max(0, ...Object.values(limits.cooldownMs));
      for (const [k, v] of lastUse) if (t - v >= maxCd) lastUse.delete(k);
    }
    onAction({ kind: "command", ...id, displayName: ev.displayName, commandId: cmd.id, group: cmd.group, at: t });
  }

  function drain() {
    const t = now();
    for (let i = 0; i < limits.drainPerTick && queue.length; i++) {
      const ev = queue.shift()!;
      if (ev.type === "comment") handleComment(ev, t);
      else if (ev.type === "gift") {
        // Quà không bị rate limit comment; giới hạn cộng dồn thuộc Gift Rules (GĐ5).
        onAction({ kind: "gift", ...identity(ev.userId, ev.displayName), displayName: ev.displayName,
          giftId: ev.giftId, giftName: ev.giftName, count: ev.count, value: ev.value, at: t });
      } else if (ev.type === "live_status") onAction({ kind: "live_status", status: ev.status, at: t });
    }
  }

  function flushLikes() {
    const t = now();
    if (!pendingLikes || t - likeFlushAt < limits.likeBatchMs) return;
    onAction({ kind: "likes", count: pendingLikes, at: t });
    pendingLikes = 0;
    likeFlushAt = t;
  }

  return { ingest, drain, flushLikes, stats };
}
