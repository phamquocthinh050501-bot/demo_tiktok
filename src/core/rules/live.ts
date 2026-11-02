import { normalizeText } from "../commands/normalizeText.ts";
import type { Avatar, GameEvent } from "./world.ts";
import type { MoveDef } from "./progression.ts";

export type EventEffect =
  | { type: "gather"; room: string; object?: string; arrive: MoveDef["arrive"]; activity?: string }
  | { type: "expFactor"; source: string; factor: number }
  | { type: "visionFactor"; factor: number }
  | { type: "camerasOff" }
  | { type: "grantWorking"; source: string }
  | { type: "birthday" }
  | { type: "contest" };
export interface EventDef {
  id: string; name: string; durationMs: number; minIntervalMs: number; announce: string; effects: EventEffect[];
}
export type GiftEffect =
  | { type: "fx"; name: string } | { type: "energy"; amount: number } | { type: "exp"; source?: string }
  | { type: "random_event" } | { type: "escape_ticket" };
export interface LiveCfg {
  likes: {
    pointsPerLike: number; energyPerLike: number; milestones: { at: number; units: number }[];
    fxMinIntervalMs: number; fxMaxIntensity: number; energyEvent: string;
  };
  gifts: {
    rules: { giftId?: string; giftName?: string; effects: GiftEffect[] }[];
    tiers: { minValue: number; effects: GiftEffect[] }[];
    default: { effects: GiftEffect[] };
    perUser: { windowMs: number; maxUnits: number };
    effectCooldownMs: Record<string, number>;
    maxTickets: number; ticketTtlMs: number; feedMaxPerSec: number;
  };
  events: EventDef[];
  schedule: { event: string; atMs: number }[];
  random: { checkEveryMs: number; globalMinGapMs: number; maxQueue: number; events: { id: string; chance: number }[] };
}

const GIFT_TYPES = ["fx", "energy", "exp", "random_event", "escape_ticket"];

export function validateLiveConfig(cfg: LiveCfg, roomIds: string[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const e of cfg.events) {
    if (ids.has(e.id)) errs.push(`sự kiện trùng id: ${e.id}`);
    ids.add(e.id);
    if (!e.name.trim() || !e.announce.trim()) errs.push(`${e.id}: thiếu tên hoặc thông báo`);
    if (!(e.durationMs > 0)) errs.push(`${e.id}: durationMs phải > 0`);
    if (!(e.minIntervalMs >= 0)) errs.push(`${e.id}: minIntervalMs không hợp lệ`);
    for (const f of e.effects) {
      if (f.type === "gather" && !roomIds.includes(f.room)) errs.push(`${e.id}: phòng không tồn tại: ${f.room}`);
      if (f.type === "expFactor" && !(f.factor >= 0)) errs.push(`${e.id}: expFactor không hợp lệ`);
      if (f.type === "visionFactor" && !(f.factor > 0)) errs.push(`${e.id}: visionFactor không hợp lệ`);
    }
  }
  cfg.schedule.forEach((s, i) => {
    if (!ids.has(s.event)) errs.push(`lịch: sự kiện không tồn tại: ${s.event}`);
    if (i > 0 && s.atMs < cfg.schedule[i - 1].atMs) errs.push("lịch phải sắp xếp theo thời gian tăng dần");
  });
  if (!(cfg.random.checkEveryMs > 0)) errs.push("random.checkEveryMs phải > 0");
  for (const r of cfg.random.events) {
    if (!ids.has(r.id)) errs.push(`random: sự kiện không tồn tại: ${r.id}`);
    if (!(r.chance > 0 && r.chance <= 1)) errs.push(`random: chance của ${r.id} phải trong (0, 1]`);
  }
  if (!ids.has(cfg.likes.energyEvent)) errs.push(`likes.energyEvent không tồn tại: ${cfg.likes.energyEvent}`);
  if (!(cfg.likes.energyPerLike > 0)) errs.push("likes.energyPerLike phải > 0");
  cfg.likes.milestones.forEach((m, i) => {
    if (i > 0 && m.at <= cfg.likes.milestones[i - 1].at) errs.push("milestones phải tăng dần");
  });
  const all = [cfg.gifts.default, ...cfg.gifts.rules, ...cfg.gifts.tiers];
  for (const g of all) for (const f of g.effects) {
    if (!GIFT_TYPES.includes(f.type)) errs.push(`quà: loại hiệu ứng lạ: ${f.type}`);
    if (f.type === "random_event" && !cfg.random.events.length) errs.push("quà random_event cần random.events không rỗng");
  }
  cfg.gifts.tiers.forEach((t, i) => {
    if (i > 0 && t.minValue <= cfg.gifts.tiers[i - 1].minValue) errs.push("gifts.tiers phải tăng dần theo minValue");
  });
  if (!(cfg.gifts.perUser.maxUnits > 0)) errs.push("gifts.perUser.maxUnits phải > 0");
  return errs;
}

interface Hooks {
  active(): Avatar[];
  get(userKey: string): Avatar | undefined;
  give(a: Avatar, source: string): number;
  move(a: Avatar, def: MoveDef): void;
  feed(text: string, userKey?: string): void;
  emit(e: GameEvent): void;
}
type Gift = { userKey: string; displayName: string; giftId?: string; giftName?: string; count: number; value?: number };

const ENGAGED = ["IDLE", "WORKING", "BREAKING", "MEETING", "WALKING"]; // AFK/đang trốn không bị sự kiện kéo đi

export function createLive({ cfg, now, random, hooks }: { cfg: LiveCfg; now: () => number; random: () => number; hooks: Hooks }) {
  const defs = new Map(cfg.events.map((e) => [e.id, e]));
  const stats = { fxDropped: 0, giftFeedDropped: 0, giftCapped: 0 };
  let sessionOn = false, sessionMs = 0, nextSched = 0, randAcc = 0;
  let likes = 0, points = 0, energy = 0;
  let current: { def: EventDef; endsAt: number; baseline?: Map<string, number> } | null = null;
  let lastEventAt = -Infinity;
  const lastStart = new Map<string, number>();
  const pending: string[] = [];
  const lastFx = new Map<string, number>();
  const giftCd = new Map<string, number>();
  const userUnits = new Map<string, { start: number; units: number }>();
  let feedWin = { start: 0, n: 0 };

  const engaged = () => hooks.active().filter((a) => ENGAGED.includes(a.state));

  function fx(name: string, intensity: number) {
    const t = now();
    if (t - (lastFx.get(name) ?? -Infinity) < cfg.likes.fxMinIntervalMs) { stats.fxDropped++; return; }
    lastFx.set(name, t);
    hooks.emit({ kind: "fx", name, intensity: Math.max(1, Math.min(intensity, cfg.likes.fxMaxIntensity)) });
  }
  function giftFeed(text: string, userKey?: string) {
    const t = now();
    if (t - feedWin.start >= 1000) feedWin = { start: t, n: 0 };
    if (feedWin.n >= cfg.gifts.feedMaxPerSec) { stats.giftFeedDropped++; return; }
    feedWin.n++;
    hooks.feed(text, userKey);
  }

  function endCurrent() {
    if (!current) return;
    const { def, baseline } = current;
    if (baseline) {
      const ranked = hooks.active()
        .map((a) => ({ a, delta: a.workMs - (baseline.get(a.userKey) ?? 0) }))
        .filter((r) => r.delta > 0)
        .sort((x, y) => y.delta - x.delta || (x.a.userKey < y.a.userKey ? -1 : 1))
        .slice(0, 3);
      ranked.forEach((r, i) => hooks.give(r.a, i === 0 ? "achievement" : "event"));
      hooks.feed(ranked.length ? `${def.name} kết thúc: ${ranked.map((r, i) => `${i + 1}. ${r.a.name}`).join(", ")}` : `${def.name} kết thúc, chưa có ai làm việc`);
    }
    hooks.emit({ kind: "event_end", id: def.id });
    current = null;
  }

  function startEvent(def: EventDef, force = false): boolean {
    const t = now();
    if (!force) {
      if (current) return false;
      const last = lastStart.get(def.id);
      if (last !== undefined && t - last < def.minIntervalMs) return false;
    } else endCurrent();
    current = { def, endsAt: t + def.durationMs };
    lastStart.set(def.id, t);
    lastEventAt = t;
    hooks.emit({ kind: "announce", id: def.id, name: def.name, text: def.announce, endsAt: current.endsAt });
    hooks.feed(`${def.name}: ${def.announce}`);
    for (const f of def.effects) {
      if (f.type === "gather") {
        const move: MoveDef = { room: f.room, object: f.object, arrive: f.arrive, activity: f.activity };
        for (const a of engaged()) hooks.move(a, move);
      } else if (f.type === "grantWorking") {
        for (const a of hooks.active()) if (a.state === "WORKING") hooks.give(a, f.source);
      } else if (f.type === "birthday") {
        const list = engaged();
        if (list.length) {
          const star = list[Math.floor(random() * list.length)];
          for (const a of list) hooks.give(a, a === star ? "achievement" : "event");
          hooks.feed(`Hôm nay là sinh nhật của ${star.name}! Cả công ty chúc mừng!`, star.userKey);
          fx("confetti", list.length);
        }
      } else if (f.type === "contest") {
        current.baseline = new Map(hooks.active().map((a) => [a.userKey, a.workMs]));
      }
    }
    return true;
  }

  function triggerEvent(id: string): boolean {
    const def = defs.get(id);
    if (!def) throw new Error(`sự kiện không tồn tại: ${id}`);
    return startEvent(def);
  }
  function queueEvent(id: string) {
    const def = defs.get(id)!;
    if (current) { if (pending.length < cfg.random.maxQueue && !pending.includes(id)) pending.push(id); }
    else startEvent(def);
  }
  function maybeRandom() {
    if (current || now() - lastEventAt < cfg.random.globalMinGapMs) return;
    for (const r of cfg.random.events) if (random() < r.chance && startEvent(defs.get(r.id)!)) return;
  }

  function addEnergy(amount: number) {
    energy += amount;
    if (energy >= 100) {
      energy %= 100;
      hooks.feed("Thanh năng lượng cộng đồng đã đầy!");
      triggerEvent(cfg.likes.energyEvent);
    }
  }

  function onLikes(count: number) {
    const before = likes;
    likes += count;
    points += count * cfg.likes.pointsPerLike;
    fx("hearts", count);
    for (const m of cfg.likes.milestones) {
      if (before < m.at && likes >= m.at) {
        hooks.feed(`Cộng đồng đã đạt ${m.at} lượt thích!`);
        fx("milestone", cfg.likes.fxMaxIntensity);
        for (const a of engaged()) for (let i = 0; i < m.units; i++) hooks.give(a, "community");
      }
    }
    addEnergy(count * cfg.likes.energyPerLike);
  }

  function matchGift(g: Gift) {
    const byId = g.giftId ? cfg.gifts.rules.find((r) => r.giftId === g.giftId) : undefined;
    if (byId) return byId;
    const n = g.giftName ? normalizeText(g.giftName) : "";
    const byName = n ? cfg.gifts.rules.find((r) => r.giftName && normalizeText(r.giftName) === n) : undefined;
    if (byName) return byName;
    if (g.value !== undefined) {
      const tier = [...cfg.gifts.tiers].reverse().find((t) => g.value! >= t.minValue);
      if (tier) return tier;
    }
    return cfg.gifts.default;
  }

  function onGift(g: Gift) {
    const t = now();
    let rec = userUnits.get(g.userKey);
    if (!rec || t - rec.start >= cfg.gifts.perUser.windowMs) { rec = { start: t, units: 0 }; userUnits.set(g.userKey, rec); }
    const units = Math.min(g.count, cfg.gifts.perUser.maxUnits - rec.units);
    if (units <= 0) {
      stats.giftCapped++;
      giftFeed(`${g.displayName} đã đạt giới hạn quà tặng, cảm ơn bạn!`, g.userKey);
      return;
    }
    rec.units += units;
    giftFeed(`Cảm ơn ${g.displayName} đã tặng ${g.giftName ?? "quà"} x${g.count}!`, g.userKey);
    const sender = hooks.get(g.userKey);
    const member = sender && sender.state !== "OFFLINE" ? sender : undefined;
    let needAvatar = false;
    for (const e of matchGift(g).effects) {
      const cd = cfg.gifts.effectCooldownMs[e.type] ?? 0;
      if (cd && t - (giftCd.get(e.type) ?? -Infinity) < cd) continue;
      if (e.type === "fx") fx(e.name, units);
      else if (e.type === "energy") addEnergy(e.amount * units);
      else if (e.type === "exp") { if (member) for (let i = 0; i < units; i++) hooks.give(member, e.source ?? "event"); else needAvatar = true; }
      else if (e.type === "escape_ticket") {
        if (member) { member.tickets = Math.min(cfg.gifts.maxTickets, member.tickets + 1); member.ticketUntil = t + cfg.gifts.ticketTtlMs; }
        else needAvatar = true;
      } else if (e.type === "random_event") {
        const pool = cfg.random.events;
        if (!pool.length || !startEvent(defs.get(pool[Math.floor(random() * pool.length)].id)!)) continue;
      }
      if (cd) giftCd.set(e.type, t);
    }
    if (needAvatar) giftFeed(`${g.displayName} hãy gõ "vào công ty" để nhận quyền lợi từ quà tặng`, g.userKey);
  }

  function runSchedule() {
    while (nextSched < cfg.schedule.length && cfg.schedule[nextSched].atMs <= sessionMs) queueEvent(cfg.schedule[nextSched++].event);
  }

  function update(dt: number) {
    const t = now();
    if (current && t >= current.endsAt) endCurrent();
    if (!current && pending.length) startEvent(defs.get(pending.shift()!)!);
    if (!sessionOn) return;
    sessionMs += dt;
    runSchedule();
    randAcc += dt;
    if (randAcc >= cfg.random.checkEveryMs) { randAcc = 0; maybeRandom(); }
  }

  return {
    onLikes, onGift, update, triggerEvent, stats,
    startSession() { sessionOn = true; sessionMs = 0; nextSched = 0; randAcc = 0; pending.length = 0; runSchedule(); },
    endSession() {
      sessionOn = false; pending.length = 0;
      startEvent(defs.get("shift_end")!, true);
    },
    // Hệ số EXP và tác động lên thử thách trốn việc của sự kiện đang chạy.
    expFactor: (source: string) => (current?.def.effects ?? []).reduce((p, f) => (f.type === "expFactor" && f.source === source ? p * f.factor : p), 1),
    mods: () => ({
      cameras: !current?.def.effects.some((f) => f.type === "camerasOff"),
      vision: (current?.def.effects ?? []).reduce((p, f) => (f.type === "visionFactor" ? p * f.factor : p), 1),
    }),
    community: () => ({ likes, points, energy }),
    current: () => (current ? { id: current.def.id, name: current.def.name, endsAt: current.endsAt } : null),
  };
}
