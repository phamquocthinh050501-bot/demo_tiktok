import type { GameAction } from "../events/types.ts";
import { findPath } from "../world/grid.ts";
import type { Grid, MapData, Pt } from "../world/grid.ts";
import { STATE_LABEL } from "./states.ts";
import type { AvatarState } from "./states.ts";
import { applyExp, autoBadges, rankIndex } from "./progression.ts";
import type { Gameplay, MoveDef } from "./progression.ts";
import { dirOf, stepAlong } from "../ai/movement.ts";
import type { Dir } from "../ai/movement.ts";
import { createEscape } from "./escape.ts";
import type { EscapeCfg } from "./escape.ts";
import { createLive } from "./live.ts";
import type { LiveCfg } from "./live.ts";

export type GameEvent =
  | { kind: "feed"; text: string; userKey?: string }
  | { kind: "fx"; name: string; intensity: number }
  | { kind: "announce"; id: string; name: string; text: string; endsAt: number }
  | { kind: "event_end"; id: string }
  | { kind: "escape_result"; userKey: string; displayName: string; outcome: "caught" | "escaped"; route: string }
  | { kind: "rank_up"; userKey: string; displayName: string; rank: string }
  | { kind: "badge"; userKey: string; displayName: string; badgeId: string; badgeName: string };

export interface Avatar {
  id: string; userKey: string; identityStable: boolean; name: string; character: string;
  x: number; y: number; dir: Dir; state: AvatarState; room: string;
  activity?: string; activityUntil?: number;
  path: Pt[]; pathIdx: number; arrive?: MoveDef; spot?: Pt;
  exp: number; window: { start: number; gained: number };
  badges: string[]; workMs: number; commands: number; checkedIn: boolean;
  acc: number; lastActiveAt: number; stateSince: number;
  escapeUntil: number; wins: number; stealthWins: number; attempts: number;
  tickets: number; ticketUntil: number; // quà tặng: bỏ qua hồi chiêu trốn việc 1 lần, không bảo đảm thắng
}

interface Deps {
  map: MapData; grid: Grid; cfg: Gameplay; escape: EscapeCfg; live: LiveCfg; limits: { maxAvatars: number };
  now: () => number; random: () => number; emit: (e: GameEvent) => void;
}

// Trạng thái mà lệnh thường không được phép ngắt (thử thách trốn việc do GĐ4 điều khiển).
const LOCKED: AvatarState[] = ["SNEAKING", "ESCAPING", "CAUGHT", "ESCAPED"];
const key = (p: Pt) => `${p.x},${p.y}`;

export function createWorld({ map, grid, cfg, escape: escapeCfg, live: liveCfg, limits, now, random, emit }: Deps) {
  const avatars = new Map<string, Avatar>();
  const reserved = new Map<string, string>(); // "x,y" -> userKey, chỗ đứng đã có chủ
  const rooms = new Map(map.rooms.map((r) => [r.id, r]));
  let seq = 0;

  const active = () => [...avatars.values()].filter((a) => a.state !== "OFFLINE");
  const roomCount = (id: string) => active().filter((a) => a.room === id).length;
  const rankOf = (a: Avatar) => cfg.ranks[rankIndex(cfg.ranks, a.exp)];
  const feed = (text: string, userKey?: string) => emit({ kind: "feed", text, userKey });

  function setState(a: Avatar, s: AvatarState) { a.state = s; a.stateSince = now(); a.acc = 0; }
  function release(a: Avatar) { if (a.spot) { reserved.delete(key(a.spot)); a.spot = undefined; } }
  function touch(a: Avatar) {
    a.lastActiveAt = now();
    a.commands++;
    if (a.state === "AFK") setState(a, "IDLE");
  }

  function award(a: Avatar, badgeId: string): boolean {
    const def = cfg.badges.find((b) => b.id === badgeId);
    if (!def) throw new Error(`huy hiệu không tồn tại: ${badgeId}`);
    if (a.badges.includes(badgeId)) return false;
    a.badges.push(badgeId);
    emit({ kind: "badge", userKey: a.userKey, displayName: a.name, badgeId, badgeName: def.name });
    return true;
  }
  const checkBadges = (a: Avatar, joined = false) => autoBadges(a, cfg.badges, joined).forEach((id) => award(a, id));

  function give(a: Avatar, source: string): number {
    const src = cfg.exp.sources[source];
    if (!src) throw new Error(`nguồn EXP không tồn tại: ${source}`);
    const before = rankIndex(cfg.ranks, a.exp);
    const gained = applyExp(a, Math.round(src.amount * live.expFactor(source)), cfg.exp.window, now());
    if (gained > 0) {
      if (rankIndex(cfg.ranks, a.exp) > before) emit({ kind: "rank_up", userKey: a.userKey, displayName: a.name, rank: rankOf(a).name });
      checkBadges(a);
    }
    return gained;
  }

  function placeAtLobby(a: Avatar) {
    const sp = rooms.get("lobby")!.spawnPoints;
    const p = sp[Math.floor(random() * sp.length)];
    a.x = p.x; a.y = p.y; a.room = "lobby"; a.path = []; a.pathIdx = 0; a.arrive = undefined;
    a.activity = undefined; a.dir = "down";
    release(a);
    setState(a, "JOINING");
  }

  function ensureAvatar(act: Extract<GameAction, { kind: "command" }>): Avatar | null {
    const existing = avatars.get(act.userKey);
    if (existing) {
      if (existing.state === "OFFLINE") { placeAtLobby(existing); existing.lastActiveAt = now(); feed(`${existing.name} đã quay lại công ty`, act.userKey); }
      return existing;
    }
    if (active().length >= limits.maxAvatars) {
      feed(`Công ty đã đủ người, ${act.displayName} vui lòng chờ chỗ trống`, act.userKey);
      return null;
    }
    const t = now();
    const a: Avatar = {
      id: `a${++seq}`, userKey: act.userKey, identityStable: act.identityStable, name: act.displayName,
      character: cfg.characters[Math.floor(random() * cfg.characters.length)],
      x: 0, y: 0, dir: "down", state: "JOINING", room: "lobby", path: [], pathIdx: 0,
      exp: 0, window: { start: t, gained: 0 }, badges: [], workMs: 0, commands: 0, checkedIn: false,
      acc: 0, lastActiveAt: t, stateSince: t,
      escapeUntil: 0, wins: 0, stealthWins: 0, attempts: 0, tickets: 0, ticketUntil: 0,
    };
    placeAtLobby(a);
    avatars.set(a.userKey, a);
    feed(`${a.name} vừa vào công ty`, a.userKey);
    checkBadges(a, true);
    return a;
  }

  // Chỗ đứng trống: ưu tiên ô đứng của vật thể đúng loại, hết thì ô trống gần nhất trong phòng (BFS).
  function pickSpot(roomId: string, objectAction?: string): Pt | null {
    const room = rooms.get(roomId)!;
    const objs = objectAction ? map.objects.filter((o) => o.room === roomId && o.action === objectAction) : [];
    for (const o of objs) for (const s of o.stands) if (!reserved.has(key(s))) return s;
    const b = room.bounds;
    const inside = (p: Pt) => p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1;
    const origin = objs[0]?.stands[0] ?? room.spawnPoints[0];
    const seen = new Set([key(origin)]);
    const queue = [origin];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (!reserved.has(key(p))) return p;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (!seen.has(key(n)) && inside(n) && grid.walkable(n.x, n.y)) { seen.add(key(n)); queue.push(n); }
      }
    }
    return null;
  }

  function arrive(a: Avatar) {
    const m = a.arrive!;
    a.path = []; a.pathIdx = 0; a.arrive = undefined;
    a.activity = m.activity;
    a.dir = "down";
    setState(a, m.arrive);
  }

  // silent: di chuyển do sự kiện chung, không báo từng người khi phòng đầy. Sảnh không giới hạn sức chứa.
  function startMove(a: Avatar, def: MoveDef, silent = false) {
    const room = rooms.get(def.room)!;
    const wasThere = a.room === def.room;
    const say = (text: string) => { if (!silent) feed(text, a.userKey); };
    release(a);
    if (!wasThere && def.room !== "lobby" && roomCount(def.room) >= room.capacity) {
      say(`${room.name} đã đầy, ${a.name} vui lòng chờ`);
      return;
    }
    const spot = pickSpot(def.room, def.object);
    if (!spot) { say(`${room.name} đã đầy, ${a.name} vui lòng chờ`); return; }
    const path = findPath(grid, { x: Math.round(a.x), y: Math.round(a.y) }, spot);
    if (!path) { say(`${a.name} không tìm được đường tới ${room.name}`); return; }
    reserved.set(key(spot), a.userKey);
    a.spot = spot; a.room = def.room; a.arrive = def; a.activity = undefined;
    a.path = path; a.pathIdx = 1;
    setState(a, "WALKING");
    if (path.length === 1) arrive(a);
  }

  function stopInPlace(a: Avatar) {
    if (a.state === "WALKING") {
      release(a); a.path = []; a.pathIdx = 0; a.arrive = undefined;
      // shortcut: đứng ở hành lang vẫn tính thuộc phòng đích, chưa tính phòng theo tọa độ; nâng cấp khi cần sức chứa chính xác.
      setState(a, "IDLE");
    }
  }

  const live = createLive({
    cfg: liveCfg, now, random,
    hooks: { active, get: (k) => avatars.get(k), give, move: (a, def) => startMove(a, def, true), feed, emit },
  });

  const escape = createEscape({
    map, grid, cfg: escapeCfg, now, get: (k) => avatars.get(k), mods: () => live.mods(),
    hooks: { feed, emit, setState, release, toLobby: placeAtLobby, give, award, rankIdx: (a) => rankIndex(cfg.ranks, a.exp) },
  });

  function onCommand(act: Extract<GameAction, { kind: "command" }>) {
    if (act.commandId === "join" || act.commandId === "checkin") {
      const a = ensureAvatar(act);
      if (!a) return;
      touch(a);
      if (act.commandId === "checkin") {
        if (a.checkedIn) feed(`${a.name} đã điểm danh rồi`, a.userKey);
        else { a.checkedIn = true; give(a, "checkin"); feed(`${a.name} đã điểm danh`, a.userKey); }
      }
      checkBadges(a);
      return;
    }
    const a = avatars.get(act.userKey);
    if (!a || a.state === "OFFLINE") return;
    if (act.commandId === "view_rank") {
      const i = rankIndex(cfg.ranks, a.exp), next = cfg.ranks[i + 1];
      const tail = next ? `còn ${next.minExp - a.exp} EXP lên ${next.name}` : "đã đạt cấp cao nhất";
      feed(`${a.name}: ${cfg.ranks[i].name} — ${a.exp} EXP (${tail})`, a.userKey);
      return;
    }
    if (act.commandId === "view_badge") {
      const names = a.badges.map((id) => cfg.badges.find((b) => b.id === id)!.name);
      feed(`${a.name}: ${names.length ? "huy hiệu " + names.join(", ") : "chưa có huy hiệu"}`, a.userKey);
      return;
    }
    if (LOCKED.includes(a.state)) return;
    touch(a);
    const move = cfg.moves[act.commandId];
    if (move) { startMove(a, move); checkBadges(a); return; }
    if (act.commandId === "dance" || act.commandId === "sleep") {
      stopInPlace(a);
      a.activity = act.commandId;
      a.activityUntil = now() + (act.commandId === "dance" ? cfg.danceMs : cfg.sleepMs);
    }
    if (act.commandId === "escape") escape.start(a);
    checkBadges(a);
  }

  function advance(a: Avatar, dt: number) {
    const v = stepAlong(a, cfg.speedTilesPerSec, dt);
    if (v) a.dir = dirOf(v.dx, v.dy);
    if (a.pathIdx >= a.path.length) arrive(a);
  }

  function update(dt: number) {
    const t = now();
    for (const a of avatars.values()) {
      if (a.state === "OFFLINE") continue;
      if (a.state === "JOINING" && t - a.stateSince >= cfg.joiningMs) setState(a, "IDLE");
      if (a.state === "WALKING") advance(a, dt);
      if (a.activityUntil && t >= a.activityUntil) { a.activity = undefined; a.activityUntil = undefined; }
      const src = cfg.passive[a.state];
      if (src) {
        if (a.state === "WORKING") a.workMs += dt;
        a.acc += dt;
        const every = cfg.exp.sources[src].everyMs!;
        while (a.acc >= every) { a.acc -= every; give(a, src); }
        if (a.state === "WORKING") checkBadges(a);
      }
      const idle = t - a.lastActiveAt;
      if (idle >= cfg.offlineAfterMs) { release(a); a.path = []; a.arrive = undefined; setState(a, "OFFLINE"); }
      else if (idle >= cfg.afkAfterMs && (a.state === "IDLE" || a.state === "WORKING" || a.state === "BREAKING" || a.state === "MEETING")) setState(a, "AFK");
    }
    escape.update(dt);
    live.update(dt);
  }

  function startSession() {
    for (const a of avatars.values()) a.checkedIn = false;
    live.startSession();
  }

  return {
    handle(act: GameAction) {
      if (act.kind === "command") onCommand(act);
      else if (act.kind === "likes") live.onLikes(act.count);
      else if (act.kind === "gift") live.onGift(act);
      else if (act.status === "started") startSession();
      else live.endSession();
    },
    update,
    startSession,
    endSession: () => live.endSession(),
    triggerEvent: (id: string) => live.triggerEvent(id),
    getAvatar: (userKey: string) => avatars.get(userKey),
    grantExp(userKey: string, source: string): number {
      const a = avatars.get(userKey);
      if (!a) throw new Error(`không có avatar: ${userKey}`);
      return give(a, source);
    },
    awardBadge(userKey: string, badgeId: string): boolean {
      const a = avatars.get(userKey);
      if (!a) throw new Error(`không có avatar: ${userKey}`);
      return award(a, badgeId);
    },
    resetSession() { for (const a of avatars.values()) a.checkedIn = false; },
    snapshot() {
      return {
        avatars: active().map((a) => ({
          id: a.id, name: a.name, character: a.character, x: a.x, y: a.y, dir: a.dir,
          state: a.state, stateLabel: STATE_LABEL[a.state], activity: a.activity, room: a.room,
          rank: rankOf(a).name, exp: a.exp, badges: [...a.badges],
        })),
        rooms: map.rooms.map((r) => ({ id: r.id, name: r.name, count: roomCount(r.id), capacity: r.capacity })),
        guards: escape.snapshotGuards(),
        community: live.community(),
        event: live.current(),
      };
    },
  };
}
