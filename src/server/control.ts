import { createDemo, applyStep } from "./demo.ts";
import type { createGame, GameConfig } from "./game.ts";
import { validateEscapeConfig } from "../core/rules/escape.ts";
import { validateLiveConfig } from "../core/rules/live.ts";
import type { LiveEvent } from "../core/events/types.ts";

type Game = ReturnType<typeof createGame>;
export type SessionState = "idle" | "running" | "paused" | "ended";
export interface Result { ok: boolean; errors?: string[] }

const fail = (...errors: string[]): Result => ({ ok: false, errors });
const OK: Result = { ok: true };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const COOLDOWN_GROUPS = ["join", "move", "emote", "escape", "info"];
const LOG_SHOWN = 40;

// Bộ điều khiển cho màn hình streamer: nhận tin từ kênh /control và kiểm tra mọi thứ trước khi áp dụng.
// Mock chỉ phát sinh event qua MockLiveProvider (đi qua pipeline như event thật), không chạm thẳng vào luật game.
export function createController({ game, config, now = Date.now, random = Math.random }: {
  game: Game; config: GameConfig; now?: () => number; random?: () => number;
}) {
  let session: SessionState = "idle";
  let sessionSince = now();
  let demoOn = false;
  let demo: ReturnType<typeof createDemo> | null = null;
  const overlay = { full: true, compact: true };
  const texts = Object.fromEntries(config.commands.commands.map((c) => [c.id, c.aliases[0]]));

  game.provider.onEvent((e) => {
    if (e.type !== "live_status") return;
    session = e.status === "started" ? "running" : "ended";
    sessionSince = now();
  });

  const str = (v: unknown, what: string, max: number, errs: string[], optional = false): string | undefined => {
    if (v === undefined && optional) return undefined;
    if (typeof v !== "string" || !v.trim()) { errs.push(`${what} không được để trống`); return undefined; }
    if (v.length > max) { errs.push(`${what} dài quá ${max} ký tự`); return undefined; }
    return v.trim();
  };
  const int = (v: unknown, what: string, lo: number, hi: number, errs: string[]): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) { errs.push(`${what} phải là số nguyên từ ${lo} đến ${hi}`); return NaN; }
    return v;
  };

  function sessionAction(action: unknown): Result {
    const w = game.world;
    if (action === "start") {
      if (session === "running" || session === "paused") return fail("Phiên đang chạy rồi");
      w.startSession(); session = "running";
    } else if (action === "pause") {
      if (session !== "running") return fail("Chỉ tạm dừng được khi phiên đang chạy");
      session = "paused";
    } else if (action === "resume") {
      if (session !== "paused") return fail("Phiên không ở trạng thái tạm dừng");
      session = "running";
    } else if (action === "end") {
      if (session !== "running" && session !== "paused") return fail("Chưa có phiên nào đang chạy");
      session = "ended"; w.endSession();
    } else return fail("Thao tác phiên không hợp lệ");
    sessionSince = now();
    return OK;
  }

  function mock(m: Record<string, unknown>): Result {
    if (game.provider.getStatus() !== "mock") return fail("Chỉ dùng được ở chế độ mô phỏng");
    const errs: string[] = [];
    if (m.type === "mock.live") {
      if (typeof m.started !== "boolean") return fail("Thiếu trạng thái LIVE");
      game.provider.setLive(m.started);
      return OK;
    }
    if (m.type === "mock.demo") {
      if (typeof m.on !== "boolean") return fail("Thiếu trạng thái kịch bản demo");
      demoOn = m.on;
      if (demoOn && !demo) demo = createDemo({ random, texts });
      return OK;
    }
    const name = str(m.name ?? "Khách", "Biệt danh", 40, errs);
    const userId = str(m.userId, "ID người dùng", 60, errs, true);
    if (m.type === "mock.comment") {
      const text = str(m.text, "Nội dung comment", config.limits.maxCommentLength, errs);
      if (errs.length) return { ok: false, errors: errs };
      game.provider.sendComment(name!, text!, userId);
    } else if (m.type === "mock.like") {
      const count = int(m.count, "Số lượt thích", 1, 10_000, errs);
      if (errs.length) return { ok: false, errors: errs };
      game.provider.sendLike(name!, count, userId);
    } else {
      const count = int(m.count, "Số lượng quà", 1, 1_000, errs);
      const giftId = str(m.giftId, "ID quà", 60, errs, true);
      const giftName = str(m.giftName, "Tên quà", 60, errs, true);
      let value: number | undefined;
      if (m.value !== undefined) {
        if (typeof m.value !== "number" || !Number.isFinite(m.value) || m.value < 0) errs.push("Giá trị quà phải là số không âm");
        else value = m.value;
      }
      if (errs.length) return { ok: false, errors: errs };
      game.provider.sendGift(name!, { giftId, giftName, count, value }, userId);
    }
    return OK;
  }

  // Cấu hình chỉnh khi đang chạy: kiểm tra toàn bộ trên bản nháp rồi mới ghi vào đối tượng đang dùng.
  function limits(m: Record<string, unknown>): Result {
    const errs: string[] = [];
    const next = { cooldownMs: { ...config.limits.cooldownMs }, globalRate: { ...config.limits.globalRate }, maxAvatars: config.limits.maxAvatars };
    if (m.cooldownMs !== undefined) {
      if (!isObj(m.cooldownMs)) errs.push("cooldownMs phải là một đối tượng");
      else for (const [g, v] of Object.entries(m.cooldownMs)) {
        if (!COOLDOWN_GROUPS.includes(g)) errs.push(`Nhóm lệnh không tồn tại: ${g}`);
        else if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3_600_000) errs.push(`Cooldown nhóm "${g}" phải từ 0 đến 3600 giây`);
        else next.cooldownMs[g] = v;
      }
    }
    if (m.globalRate !== undefined) {
      if (!isObj(m.globalRate)) errs.push("globalRate phải là một đối tượng");
      else {
        if (m.globalRate.capacity !== undefined) next.globalRate.capacity = int(m.globalRate.capacity, "Số lệnh tối đa liên tiếp", 1, 1_000, errs);
        if (m.globalRate.refillPerSec !== undefined) next.globalRate.refillPerSec = int(m.globalRate.refillPerSec, "Số lệnh nạp lại mỗi giây", 0, 1_000, errs);
      }
    }
    if (m.maxAvatars !== undefined) next.maxAvatars = int(m.maxAvatars, "Số avatar tối đa", 1, 1_000, errs);
    if (errs.length) return { ok: false, errors: errs };
    Object.assign(config.limits.cooldownMs, next.cooldownMs);
    Object.assign(config.limits.globalRate, next.globalRate);
    config.limits.maxAvatars = next.maxAvatars;
    return OK;
  }

  function difficulty(m: Record<string, unknown>): Result {
    if (!Array.isArray(m.profiles) || !m.profiles.every(isObj)) return fail("Cần danh sách mức độ khó");
    const candidate = { ...config.escape, profiles: m.profiles as unknown as typeof config.escape.profiles };
    const errs = validateEscapeConfig(candidate, config.gameplay.ranks.length);
    if (errs.length) return { ok: false, errors: errs };
    config.escape.profiles.splice(0, config.escape.profiles.length, ...candidate.profiles.map((p) => ({ ...p })));
    return OK;
  }

  function gifts(m: Record<string, unknown>): Result {
    if (!isObj(m.gifts)) return fail("Cần cấu hình quà tặng");
    const candidate = { ...config.live, gifts: { ...config.live.gifts, ...m.gifts } as typeof config.live.gifts };
    const shape = ["rules", "tiers"].filter((k) => !Array.isArray((candidate.gifts as unknown as Record<string, unknown>)[k]));
    if (shape.length || !isObj(candidate.gifts.default) || !Array.isArray(candidate.gifts.default.effects)) return fail("Cấu hình quà thiếu rules, tiers hoặc default.effects");
    const errs = validateLiveConfig(candidate, config.map.rooms.map((r) => r.id));
    if (errs.length) return { ok: false, errors: errs };
    Object.assign(config.live.gifts, candidate.gifts);
    return OK;
  }

  return {
    handle(msg: unknown): Result {
      if (!isObj(msg) || typeof msg.type !== "string") return fail("Tin điều khiển không hợp lệ");
      try {
        switch (msg.type) {
          case "session": return sessionAction(msg.action);
          case "overlay":
            if ((msg.which !== "full" && msg.which !== "compact") || typeof msg.on !== "boolean") return fail("Công tắc overlay không hợp lệ");
            overlay[msg.which] = msg.on;
            return OK;
          case "mock.comment": case "mock.like": case "mock.gift": case "mock.live": case "mock.demo": return mock(msg);
          case "config.limits": return limits(msg);
          case "config.difficulty": return difficulty(msg);
          case "config.gifts": return gifts(msg);
          default: return fail(`Lệnh điều khiển không tồn tại: ${msg.type.slice(0, 40)}`);
        }
      } catch (err) {
        console.error("Lỗi xử lý tin điều khiển:", err);
        return fail("Lỗi nội bộ khi xử lý yêu cầu");
      }
    },

    // Một nhịp game: tạm dừng thì đứng yên (comment vẫn xếp hàng trong pipeline).
    tick(dt: number) {
      if (session === "paused") return;
      if (demoOn && demo) for (const s of demo.tick(dt)) applyStep(game.provider, s);
      game.tick(dt);
    },

    state: () => ({ session, overlay: { ...overlay } }),

    dash() {
      const snap = game.world.snapshot();
      const caps = game.provider.capabilities();
      const label = (e: LiveEvent) => e.type === "comment" ? { type: e.type, name: e.displayName, text: e.text }
        : e.type === "like" ? { type: e.type, name: e.displayName ?? "—", count: e.count }
        : e.type === "gift" ? { type: e.type, name: e.displayName, text: e.giftName ?? e.giftId ?? "quà", count: e.count }
        : { type: e.type, text: e.status === "started" ? "LIVE bắt đầu" : "LIVE kết thúc" };
      return {
        type: "dash" as const, now: now(),
        provider: { status: game.provider.getStatus(), label: "CHẾ ĐỘ MÔ PHỎNG", mock: true, capabilities: caps },
        viewers: null as number | null,                      // chỉ có khi provider thật sự cung cấp; không suy ra từ số avatar
        session: { state: session, since: sessionSince },
        demo: demoOn, overlay: { ...overlay },
        people: snap.avatars.length, maxAvatars: config.limits.maxAvatars,
        escaping: snap.avatars.filter((a) => a.state === "SNEAKING" || a.state === "ESCAPING").length,
        community: snap.community, event: snap.event, rooms: snap.rooms,
        leaderboard: [...snap.avatars].sort((a, b) => b.exp - a.exp || (a.name < b.name ? -1 : 1)).slice(0, 10)
          .map((a) => ({ name: a.name, rank: a.rank, exp: a.exp, room: a.room })),
        pipeline: { ...game.pipeline.stats },
        mockLog: game.provider.log.slice(-LOG_SHOWN).map((e) => ({ at: e.occurredAt, ...label(e) })),
      };
    },

    configMsg() {
      return {
        type: "config" as const,
        limits: { cooldownMs: { ...config.limits.cooldownMs }, globalRate: { ...config.limits.globalRate }, maxAvatars: config.limits.maxAvatars },
        escape: { profiles: config.escape.profiles.map((p) => ({ ...p })), bounds: config.escape.bounds },
        ranks: config.gameplay.ranks.map((r) => r.name),
        gifts: config.live.gifts,
        groups: config.commands.groups ?? {},
        commands: config.commands.commands.map((c) => ({ id: c.id, group: c.group, aliases: c.aliases, description: c.description ?? "" })),
      };
    },
  };
}
