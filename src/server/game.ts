import { readFileSync } from "node:fs";
import { createParser } from "../core/commands/parser.ts";
import type { CommandDef } from "../core/commands/parser.ts";
import { createPipeline } from "../core/events/pipeline.ts";
import type { Limits } from "../core/events/pipeline.ts";
import { createWorld } from "../core/rules/world.ts";
import type { GameEvent } from "../core/rules/world.ts";
import type { Gameplay } from "../core/rules/progression.ts";
import { validateEscapeConfig } from "../core/rules/escape.ts";
import type { EscapeCfg } from "../core/rules/escape.ts";
import { validateLiveConfig } from "../core/rules/live.ts";
import type { LiveCfg } from "../core/rules/live.ts";
import { loadGrid } from "../core/world/grid.ts";
import type { MapData } from "../core/world/grid.ts";
import { validateMap } from "../core/world/validateMap.ts";
import { MockLiveProvider } from "./providers/mock.ts";

export interface GameConfig {
  map: MapData;
  commands: { groups?: Record<string, string>; commands: CommandDef[] };
  limits: Limits & { maxAvatars: number };
  gameplay: Gameplay;
  escape: EscapeCfg;
  live: LiveCfg;
}

const BUILTIN = ["join", "checkin", "view_rank", "view_badge", "dance", "sleep", "escape"];

export function loadGameConfig(root: URL = new URL("../../", import.meta.url)): GameConfig {
  const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
  return {
    map: read("assets/map/office_main_floor.json"),
    commands: read("config/commands.json"),
    limits: read("config/limits.json"),
    gameplay: read("config/gameplay.json"),
    escape: read("config/escape.json"),
    live: read("config/live.json"),
  };
}

// Lỗi cấu hình phải dừng game ngay lúc khởi động, không để lộ ra giữa buổi LIVE.
export function validateGameConfig(c: GameConfig): string[] {
  const roomIds = c.map.rooms.map((r) => r.id);
  const errs = [
    ...validateMap(c.map),
    ...validateEscapeConfig(c.escape, c.gameplay.ranks.length),
    ...validateLiveConfig(c.live, roomIds),
  ];
  for (const [id, m] of Object.entries(c.gameplay.moves)) if (!roomIds.includes(m.room)) errs.push(`lệnh ${id}: phòng không tồn tại: ${m.room}`);
  for (const cmd of c.commands.commands) {
    if (!BUILTIN.includes(cmd.id) && !c.gameplay.moves[cmd.id]) errs.push(`lệnh ${cmd.id} chưa có xử lý trong luật game`);
  }
  return errs;
}

// Ghép nguồn LIVE → pipeline → luật game. Provider chỉ đẩy event vào hàng đợi; gameplay chạy trong tick().
export function createGame(config: GameConfig, deps: { now?: () => number; random?: () => number } = {}) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const listeners = new Set<(e: GameEvent) => void>();
  const world = createWorld({
    map: config.map, grid: loadGrid(config.map), cfg: config.gameplay, escape: config.escape, live: config.live,
    limits: config.limits, now, random, emit: (e) => listeners.forEach((l) => l(e)),
  });
  const pipeline = createPipeline({
    limits: config.limits, parser: createParser(config.commands.commands), now, onAction: (a) => world.handle(a),
  });
  const provider = new MockLiveProvider({ now });
  provider.onEvent((e) => pipeline.ingest(e));
  return {
    world, pipeline, provider,
    onGameEvent(l: (e: GameEvent) => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    tick(dt: number) { pipeline.drain(); pipeline.flushLikes(); world.update(dt); },
  };
}
