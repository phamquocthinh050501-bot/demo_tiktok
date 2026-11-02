import { normalizeText } from "./normalizeText.ts";

export interface CommandDef { id: string; group: string; aliases: string[]; description?: string }
export interface ParsedCommand { id: string; group: string }

// Khớp chính xác toàn bộ comment với alias đã chuẩn hóa; cố ý không fuzzy.
export function createParser(defs: CommandDef[]) {
  const table = new Map<string, ParsedCommand>();
  for (const d of defs) {
    for (const alias of d.aliases) {
      const key = normalizeText(alias);
      if (table.has(key)) throw new Error(`alias trùng: "${alias}"`);
      table.set(key, { id: d.id, group: d.group });
    }
  }
  return { parse: (text: string): ParsedCommand | null => table.get(normalizeText(text)) ?? null };
}
