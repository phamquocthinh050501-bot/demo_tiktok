import type { AvatarState } from "./states.ts";

export interface MoveDef { room: string; object?: string; arrive: AvatarState; activity?: string }
export interface BadgeDef {
  id: string; name: string;
  when: { kind: "join" | "manual" } | { kind: "workMs" | "commands"; value: number };
}
export interface Gameplay {
  speedTilesPerSec: number; joiningMs: number; afkAfterMs: number; offlineAfterMs: number;
  danceMs: number; sleepMs: number;
  characters: string[];
  moves: Record<string, MoveDef>;
  exp: { window: { ms: number; max: number }; sources: Record<string, { amount: number; everyMs?: number }> };
  passive: Record<string, string>;
  ranks: { id: string; name: string; minExp: number }[];
  badges: BadgeDef[];
}

export function rankIndex(ranks: { minExp: number }[], exp: number): number {
  let idx = 0;
  ranks.forEach((r, i) => { if (exp >= r.minExp) idx = i; });
  return idx;
}

// Cộng EXP có trần theo cửa sổ thời gian (chống spam/farm). Trả về lượng EXP thực nhận.
export function applyExp(
  a: { exp: number; window: { start: number; gained: number } },
  amount: number, win: { ms: number; max: number }, now: number,
): number {
  if (now - a.window.start >= win.ms) a.window = { start: now, gained: 0 };
  const gained = Math.max(0, Math.min(amount, win.max - a.window.gained));
  a.window.gained += gained;
  a.exp += gained;
  return gained;
}

// Huy hiệu tự động chưa có mà đã đủ điều kiện. Huy hiệu "manual" chỉ do luật khác cấp (vd. kết quả trốn việc).
export function autoBadges(
  a: { badges: string[]; workMs: number; commands: number },
  defs: BadgeDef[], joined = false,
): string[] {
  return defs.filter((b) => {
    if (a.badges.includes(b.id)) return false;
    const w = b.when;
    if (w.kind === "join") return joined;
    if (w.kind === "workMs") return a.workMs >= w.value;
    if (w.kind === "commands") return a.commands >= w.value;
    return false;
  }).map((b) => b.id);
}
