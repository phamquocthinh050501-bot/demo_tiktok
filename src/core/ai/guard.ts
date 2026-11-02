import { findPath } from "../world/grid.ts";
import type { Grid, MapData, Pt } from "../world/grid.ts";
import { dirOf, stepAlong } from "./movement.ts";
import type { Dir } from "./movement.ts";

export type GuardState = "PATROL" | "INVESTIGATE" | "CHASE" | "CAPTURE" | "RETURN";

export interface Profile {
  guards: number; checkpoints: number; cameras: number;
  visionRange: number; visionHalfAngleDeg: number; reactionMs: number;
}
export interface GuardCfg {
  patrolSpeed: number; investigateSpeed: number; chaseSpeed: number; captureRange: number; captureMs: number;
  searchMs: number; loseMs: number; repathMs: number; scanMs: number; closeRange: number;
  chaseVisionFactor: number; noiseRadius: number;
}
// Người đang trốn, như bảo vệ nhìn thấy. range đã tính sẵn hệ số lén/ẩn nấp.
export interface Prey {
  userKey: string; x: number; y: number; sneaking: boolean; running: boolean;
  prof: Profile; range: number; inSafe: boolean; inNoise: boolean;
}
export interface Guard {
  id: string; kind: "patrol" | "checkpoint"; idx: number; staffed: boolean;
  x: number; y: number; face: Pt; dir: Dir; state: GuardState;
  path: Pt[]; pathIdx: number; route: Pt[]; wp: number;
  target?: string; lastSeen?: Pt;
  timer: number; scanT: number; lose: number; repath: number; searching: boolean;
  seen: Map<string, number>; // userKey -> ms đã nhìn thấy (thanh phát hiện)
}
export type GuardEvent =
  | { type: "detected"; guardId: string; userKey: string }
  | { type: "captured"; guardId: string; userKey: string };

// Đường ngắm không đi qua ô bị chặn.
export function los(grid: Grid, a: Pt, b: Pt): boolean {
  let x0 = Math.round(a.x), y0 = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!grid.walkable(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

// Thấy khi: trong tầm, trong góc nhìn (trừ khi rất gần hoặc omni) và không bị vật chắn.
export function sees(
  grid: Grid, g: { x: number; y: number; face: Pt }, p: Pt,
  range: number, halfAngleDeg: number, closeRange: number, omni: boolean,
): boolean {
  const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (!omni && d > closeRange) {
    const cos = (g.face.x * dx + g.face.y * dy) / d;
    if (cos < Math.cos((halfAngleDeg * Math.PI) / 180)) return false;
  }
  return los(grid, g, p);
}

export function createGuards({ map, grid, cfg }: { map: MapData; grid: Grid; cfg: GuardCfg }) {
  const mk = (id: string, kind: Guard["kind"], idx: number, route: Pt[], staffed: boolean): Guard => ({
    id, kind, idx, staffed, x: route[0].x, y: route[0].y, face: { x: 0, y: 1 }, dir: "down", state: "PATROL",
    path: [], pathIdx: 0, route, wp: route.length > 1 ? 1 : 0,
    timer: 0, scanT: 0, lose: 0, repath: 0, searching: false, seen: new Map(),
  });
  const guards: Guard[] = [
    ...map.patrolRoutes.map((r, i) => mk(`guard_${i + 1}`, "patrol", i, r.waypoints, true)),
    ...map.zones.checkpoint.map((c, i) => mk(`checkpoint_${i + 1}`, "checkpoint", i, [{ x: c.x, y: c.y }], false)),
  ];
  const tile = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const canDetect = (g: Guard, p: Prey) => g.staffed && g.idx < (g.kind === "patrol" ? p.prof.guards : p.prof.checkpoints);

  const goTo = (g: Guard, to: Pt) => {
    g.path = findPath(grid, tile(g), to) ?? [];
    g.pathIdx = 1;
  };
  const walk = (g: Guard, speed: number, dt: number): boolean => {
    const v = stepAlong(g, speed, dt);
    if (v) { const d = Math.hypot(v.dx, v.dy); g.face = { x: v.dx / d, y: v.dy / d }; g.dir = dirOf(v.dx, v.dy); }
    return g.pathIdx >= g.path.length;
  };
  const startChase = (g: Guard, p: Prey) => {
    g.state = "CHASE"; g.target = p.userKey; g.lose = 0; g.repath = 0; g.path = []; g.pathIdx = 0;
  };
  const toInvestigate = (g: Guard, at: Pt) => {
    g.state = "INVESTIGATE"; g.target = undefined; g.searching = false; g.timer = 0; goTo(g, at);
  };
  const toReturn = (g: Guard) => {
    let best = 0, bd = Infinity;
    g.route.forEach((r, i) => { const d = Math.hypot(r.x - g.x, r.y - g.y); if (d < bd) { bd = d; best = i; } });
    g.state = "RETURN"; g.target = undefined; goTo(g, g.route[best]);
    g.wp = (best + 1) % g.route.length;
  };

  function detect(g: Guard, preys: Prey[], dt: number, events: GuardEvent[]) {
    for (const p of preys) {
      if (p.inSafe || !canDetect(g, p)) continue; // vùng an toàn: không bị phát hiện/đuổi
      const seen = sees(grid, g, p, p.range, p.prof.visionHalfAngleDeg, cfg.closeRange, false);
      if (p.running) { if (seen) { startChase(g, p); return; } continue; }
      if (!p.sneaking) continue;
      const m = g.seen.get(p.userKey) ?? 0;
      const nm = seen ? m + dt : Math.max(0, m - dt / 2);
      g.seen.set(p.userKey, nm);
      if (seen) g.lastSeen = tile(p);
      if (nm >= p.prof.reactionMs) {
        g.seen.set(p.userKey, 0);
        events.push({ type: "detected", guardId: g.id, userKey: p.userKey });
        startChase(g, p);
        return;
      }
      if (!seen && m >= p.prof.reactionMs * 0.4 && g.state === "PATROL" && g.lastSeen) { toInvestigate(g, g.lastSeen); return; }
      if (p.inNoise && g.state !== "INVESTIGATE" && Math.hypot(p.x - g.x, p.y - g.y) <= cfg.noiseRadius) { toInvestigate(g, tile(p)); return; }
    }
  }

  function act(g: Guard, dt: number, byKey: Map<string, Prey>, events: GuardEvent[]) {
    switch (g.state) {
      case "PATROL":
        if (g.route.length === 1) {
          g.scanT += dt; // trạm gác đứng yên, quay mặt 90° mỗi scanMs
          if (g.scanT >= cfg.scanMs) { g.scanT = 0; g.face = { x: -g.face.y, y: g.face.x }; g.dir = dirOf(g.face.x, g.face.y); }
        } else {
          if (g.pathIdx >= g.path.length) { goTo(g, g.route[g.wp]); g.wp = (g.wp + 1) % g.route.length; }
          walk(g, cfg.patrolSpeed, dt);
        }
        break;
      case "INVESTIGATE":
        if (walk(g, cfg.investigateSpeed, dt)) {
          if (!g.searching) { g.searching = true; g.timer = 0; }
          g.timer += dt;
          if (g.timer >= cfg.searchMs) toReturn(g);
        }
        break;
      case "RETURN":
        if (walk(g, cfg.patrolSpeed, dt)) { g.state = "PATROL"; g.path = []; g.pathIdx = 0; }
        break;
      case "CAPTURE":
        g.timer += dt;
        if (g.timer >= cfg.captureMs) toReturn(g);
        break;
      case "CHASE": {
        const p = byKey.get(g.target!);
        if (!p || (!p.running && !p.sneaking)) { toReturn(g); break; }
        if (p.inSafe) { toInvestigate(g, g.lastSeen ?? tile(g)); break; }
        g.repath -= dt;
        if (g.repath <= 0) { g.repath = cfg.repathMs; goTo(g, tile(p)); }
        walk(g, cfg.chaseSpeed, dt);
        const seen = sees(grid, g, p, p.range * cfg.chaseVisionFactor, 180, cfg.closeRange, true);
        g.lose = seen ? 0 : g.lose + dt;
        if (seen) g.lastSeen = tile(p);
        if (Math.hypot(p.x - g.x, p.y - g.y) <= cfg.captureRange && los(grid, g, p)) {
          g.state = "CAPTURE"; g.timer = 0;
          events.push({ type: "captured", guardId: g.id, userKey: p.userKey });
        } else if (g.lose >= cfg.loseMs) toInvestigate(g, g.lastSeen ?? tile(p));
        break;
      }
    }
  }

  return {
    guards,
    // Trạm gác (checkpoint) chỉ có người khi có thử thách đủ khó.
    setStaffedCheckpoints(n: number) {
      for (const g of guards) {
        if (g.kind !== "checkpoint") continue;
        const want = g.idx < n;
        if (want && !g.staffed) {
          g.x = g.route[0].x; g.y = g.route[0].y; g.state = "PATROL"; g.path = []; g.pathIdx = 0; g.seen.clear();
        }
        g.staffed = want;
      }
    },
    // Camera báo động: bảo vệ gần nhất (đang rảnh) đến kiểm tra chỗ người này; phải tự nhìn thấy mới đuổi.
    alertNearest(p: Prey): boolean {
      let best: Guard | null = null, bd = Infinity;
      for (const g of guards) {
        if (!canDetect(g, p) || (g.state !== "PATROL" && g.state !== "RETURN")) continue;
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        if (d < bd) { bd = d; best = g; }
      }
      if (best) toInvestigate(best, tile(p));
      return !!best;
    },
    update(dt: number, preys: Prey[]): GuardEvent[] {
      const events: GuardEvent[] = [];
      const byKey = new Map(preys.map((p) => [p.userKey, p]));
      for (const g of guards) {
        if (!g.staffed) continue;
        for (const k of g.seen.keys()) if (!byKey.has(k)) g.seen.delete(k);
        act(g, dt, byKey, events);
        if (g.state === "PATROL" || g.state === "INVESTIGATE" || g.state === "RETURN") detect(g, preys, dt, events);
      }
      return events;
    },
  };
}
