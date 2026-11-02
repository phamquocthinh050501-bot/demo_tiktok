import { findRoute, pathCost } from "../world/grid.ts";
import type { Grid, MapData, Rect } from "../world/grid.ts";
import { createGuards } from "../ai/guard.ts";
import type { GuardCfg, Prey, Profile } from "../ai/guard.ts";
import { dirOf, stepAlong } from "../ai/movement.ts";
import type { Avatar, GameEvent } from "./world.ts";
import type { AvatarState } from "./states.ts";

export interface EscapeCfg {
  cooldownMs: number; maxConcurrent: number; maxChallengeMs: number; caughtMs: number; escapedMs: number;
  sneakSpeed: number; runSpeed: number; sneakVisionFactor: number; hideVisionFactor: number; hideRadius: number;
  cameraFactor: number; closeCallDistance: number;
  routeWeights: { camera: number; guard: number; checkpoint: number; noise: number };
  badgeRules: Record<string, { wins?: number; stealthWins?: number }>;
  guard: GuardCfg;
  bounds: Record<keyof Profile, [number, number]>;
  profiles: Profile[];
}

// Độ khó phải nằm trong giới hạn, tăng dần theo cấp bậc và đủ một mức cho mỗi cấp.
export function validateEscapeConfig(cfg: EscapeCfg, rankCount: number): string[] {
  const errs: string[] = [];
  if (cfg.profiles.length !== rankCount) errs.push(`cần ${rankCount} mức độ khó, đang có ${cfg.profiles.length}`);
  const keys = Object.keys(cfg.bounds) as (keyof Profile)[];
  cfg.profiles.forEach((p, i) => {
    for (const k of keys) {
      const [lo, hi] = cfg.bounds[k];
      if (!(p[k] >= lo && p[k] <= hi)) errs.push(`mức ${i}: ${k}=${p[k]} ngoài [${lo}, ${hi}]`);
      if (i > 0) {
        const prev = cfg.profiles[i - 1][k];
        const harder = k === "reactionMs" ? p[k] <= prev : p[k] >= prev;
        if (!harder) errs.push(`mức ${i}: ${k} không khó hơn mức ${i - 1}`);
      }
    }
  });
  return errs;
}

interface Challenge {
  userKey: string; routeName: string; phase: "run" | "caught" | "escaped";
  startedAt: number; phaseUntil: number; detected: boolean; camMs: number; minDist: number;
}
interface Hooks {
  feed(text: string, userKey?: string): void;
  emit(e: GameEvent): void;
  setState(a: Avatar, s: AvatarState): void;
  release(a: Avatar): void;
  toLobby(a: Avatar): void;
  give(a: Avatar, source: string): number;
  award(a: Avatar, badgeId: string): boolean;
  rankIdx(a: Avatar): number;
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export function createEscape({ map, grid, cfg, now, get, mods, hooks }: {
  map: MapData; grid: Grid; cfg: EscapeCfg; now: () => number; get: (userKey: string) => Avatar | undefined;
  mods: () => { cameras: boolean; vision: number }; // sự kiện đang chạy (mất điện, kiểm tra đột xuất...)
  hooks: Hooks;
}) {
  const rooms = new Map(map.rooms.map((r) => [r.id, r]));
  const guards = createGuards({ map, grid, cfg: cfg.guard });
  const challenges = new Map<string, Challenge>();
  const profileOf = (a: Avatar) => cfg.profiles[Math.min(hooks.rankIdx(a), cfg.profiles.length - 1)];
  const running = () => [...challenges.values()].filter((c) => c.phase === "run");

  // Điểm trên đường tuần tra của một bảo vệ (nội suy mỗi ~1 ô): người trốn biết bảo vệ đi tuần cả tuyến, không chỉ chỗ đang đứng.
  const patrolPoints = (route: { x: number; y: number }[]) => route.flatMap((p, i) => {
    const q = route[(i + 1) % route.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y)));
    return Array.from({ length: n }, (_, k) => ({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n }));
  });

  function exposure(path: { x: number; y: number }[], prof: Profile): number {
    const cams = map.zones.vision.slice(0, prof.cameras);
    const gs = guards.guards.filter((g) => g.idx < (g.kind === "patrol" ? prof.guards : prof.checkpoints));
    const watched = gs.flatMap((g) => patrolPoints(g.route));
    const posts = gs.filter((g) => g.kind === "checkpoint");
    const sneakRange = prof.visionRange * mods().vision * cfg.sneakVisionFactor; // đang lén đi nên bảo vệ chỉ thấy gần hơn
    let e = 0;
    for (const p of path) {
      if (cams.some((c) => inRect(c, p.x, p.y))) e += cfg.routeWeights.camera;
      if (map.zones.noise.some((z) => inRect(z, Math.round(p.x), Math.round(p.y)))) e += cfg.routeWeights.noise; // vùng ồn làm bảo vệ gần đó kéo đến
      if (watched.some((w) => Math.hypot(w.x - p.x, w.y - p.y) <= sneakRange)) e += cfg.routeWeights.guard;
      // Trạm gác đứng yên: đi sát là bị thấy ngay, nên né hẳn nếu còn tuyến khác.
      if (posts.some((g) => Math.hypot(g.x - p.x, g.y - p.y) <= cfg.guard.closeRange + 1)) e += cfg.routeWeights.checkpoint;
    }
    return e;
  }

  function canStart(a: Avatar): string | null {
    const ws = rooms.get("workspace")!.name;
    if (a.room !== "workspace" || (a.state !== "IDLE" && a.state !== "WORKING")) return `${a.name} chỉ trốn việc được khi đang ở ${ws}`;
    const wait = a.escapeUntil - now();
    const hasTicket = a.tickets > 0 && now() <= a.ticketUntil;
    if (wait > 0 && !hasTicket) return `${a.name} cần chờ thêm ${Math.ceil(wait / 1000)} giây mới trốn việc được`;
    if (running().length >= cfg.maxConcurrent) return `Đang có quá nhiều người trốn việc, ${a.name} vui lòng chờ`;
    return null;
  }

  function start(a: Avatar) {
    const why = canStart(a);
    if (why) { hooks.feed(why, a.userKey); return; }
    const prof = profileOf(a);
    const from = { x: Math.round(a.x), y: Math.round(a.y) };
    let best: { name: string; path: { x: number; y: number }[]; score: number } | null = null;
    for (const r of map.escapeRoutes) {
      const exit = map.objects.find((o) => o.id === r.exit)!.stands[0];
      const path = findRoute(grid, [from, ...r.waypoints, exit]);
      if (!path) continue;
      const score = pathCost(path) + exposure(path, prof);
      if (!best || score < best.score) best = { name: r.name, path, score };
    }
    if (!best) { hooks.feed(`${a.name} không tìm được đường trốn`, a.userKey); return; }
    if (a.escapeUntil > now()) a.tickets--; // đang hồi chiêu: dùng một vé từ quà tặng
    hooks.release(a);
    a.room = "transit"; a.activity = undefined;
    a.path = best.path; a.pathIdx = 1;
    hooks.setState(a, "SNEAKING");
    challenges.set(a.userKey, {
      userKey: a.userKey, routeName: best.name, phase: "run", startedAt: now(), phaseUntil: 0,
      detected: false, camMs: 0, minDist: Infinity,
    });
    hooks.feed(`${a.name} đang lén trốn việc!`, a.userKey);
  }

  function finish(a: Avatar, ch: Challenge, phase: "caught" | "escaped") {
    const t = now();
    ch.phase = phase;
    a.escapeUntil = t + cfg.cooldownMs;
    a.attempts++;
    hooks.setState(a, phase === "caught" ? "CAUGHT" : "ESCAPED");
    ch.phaseUntil = t + (phase === "caught" ? cfg.caughtMs : cfg.escapedMs);
    if (phase === "caught") {
      hooks.give(a, "escape_caught");
      hooks.feed(`${a.name} đã bị bảo vệ bắt!`, a.userKey);
    } else {
      a.wins++;
      if (!ch.detected) a.stealthWins++;
      a.room = "rooftop";
      hooks.give(a, "escape");
      hooks.feed(`${a.name} đã trốn thoát thành công (${ch.routeName})!`, a.userKey);
      for (const [id, rule] of Object.entries(cfg.badgeRules)) {
        if ((rule.wins !== undefined && a.wins >= rule.wins) || (rule.stealthWins !== undefined && a.stealthWins >= rule.stealthWins)) hooks.award(a, id);
      }
      if (ch.detected && ch.minDist <= cfg.closeCallDistance) hooks.award(a, "close_call");
    }
    hooks.emit({ kind: "escape_result", userKey: a.userKey, displayName: a.name, outcome: phase, route: ch.routeName });
  }

  function markDetected(a: Avatar, ch: Challenge) {
    ch.detected = true;
    hooks.setState(a, "ESCAPING");
    hooks.feed(`${a.name} bị phát hiện, bảo vệ đang đuổi!`, a.userKey);
  }

  function update(dt: number) {
    const t = now();
    const preys = new Map<string, Prey>();
    const m = mods();
    let maxCp = 0;
    for (const ch of running()) {
      const a = get(ch.userKey);
      if (!a || a.state === "OFFLINE") { challenges.delete(ch.userKey); continue; }
      if (t - ch.startedAt > cfg.maxChallengeMs) {
        a.escapeUntil = t + cfg.cooldownMs;
        hooks.toLobby(a);
        hooks.feed(`${a.name} hết giờ trốn việc, quay về sảnh`, a.userKey);
        challenges.delete(ch.userKey);
        continue;
      }
      const prof = profileOf(a);
      const sneaking = a.state === "SNEAKING";
      const tx = Math.round(a.x), ty = Math.round(a.y);
      const hidden = map.zones.hide.some((h) => Math.hypot(h.x - a.x, h.y - a.y) <= cfg.hideRadius);
      preys.set(ch.userKey, {
        userKey: ch.userKey, x: a.x, y: a.y, sneaking, running: !sneaking, prof,
        range: prof.visionRange * m.vision * (sneaking ? cfg.sneakVisionFactor : 1) * (hidden ? cfg.hideVisionFactor : 1),
        inSafe: map.zones.safe.some((z) => inRect(z, tx, ty)),
        inNoise: sneaking && map.zones.noise.some((z) => inRect(z, tx, ty)),
      });
      maxCp = Math.max(maxCp, prof.checkpoints);

      // Camera: ở trong vùng camera đủ lâu thì báo bảo vệ gần nhất đến kiểm tra (chưa tính là bị phát hiện).
      if (sneaking && m.cameras) {
        const inCam = map.zones.vision.slice(0, prof.cameras).some((z) => inRect(z, tx, ty));
        ch.camMs = inCam ? ch.camMs + dt : Math.max(0, ch.camMs - dt);
        if (ch.camMs >= prof.reactionMs * cfg.cameraFactor) {
          ch.camMs = 0;
          guards.alertNearest(preys.get(ch.userKey)!);
        }
      }
    }

    guards.setStaffedCheckpoints(maxCp);
    for (const ev of guards.update(dt, [...preys.values()])) {
      const ch = challenges.get(ev.userKey), a = get(ev.userKey);
      if (!ch || !a || ch.phase !== "run") continue;
      if (ev.type === "detected" && a.state === "SNEAKING") markDetected(a, ch);
      else if (ev.type === "captured") finish(a, ch, "caught");
    }

    for (const ch of running()) {
      const a = get(ch.userKey)!;
      if (a.state !== "SNEAKING" && a.state !== "ESCAPING") continue;
      const v = stepAlong(a, a.state === "SNEAKING" ? cfg.sneakSpeed : cfg.runSpeed, dt);
      if (v) a.dir = dirOf(v.dx, v.dy);
      for (const g of guards.guards) {
        if (g.state === "CHASE" && g.target === ch.userKey) ch.minDist = Math.min(ch.minDist, Math.hypot(a.x - g.x, a.y - g.y));
      }
      if (a.pathIdx >= a.path.length) { a.path = []; a.pathIdx = 0; finish(a, ch, "escaped"); }
    }

    for (const ch of [...challenges.values()]) {
      if (ch.phase === "run" || t < ch.phaseUntil) continue;
      const a = get(ch.userKey)!;
      if (ch.phase === "caught") hooks.toLobby(a);
      else hooks.setState(a, "IDLE");
      challenges.delete(ch.userKey);
    }
  }

  return {
    start, update, canStart,
    activeCount: () => running().length,
    snapshotGuards: () => guards.guards.filter((g) => g.staffed).map((g) => ({ id: g.id, x: g.x, y: g.y, dir: g.dir, state: g.state })),
  };
}
