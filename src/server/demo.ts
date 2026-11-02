import type { MockLiveProvider } from "./providers/mock.ts";

export type DemoStep =
  | { do: "comment"; name: string; userId: string; text: string }
  | { do: "like"; name: string; userId: string; count: number }
  | { do: "gift"; name: string; userId: string; giftId?: string; giftName?: string; count: number; value?: number };

const NAMES = [
  "Lan Anh", "Minh Khoa", "Thu Hà", "Quốc Bảo", "Ngọc Mai", "Hoàng Nam", "Phương Linh", "Đức Huy", "Thanh Tâm", "Gia Hân",
  "Bảo Châu", "Tuấn Kiệt", "Khánh Vy", "Anh Tú", "Mỹ Duyên", "Văn Long", "Hải Yến", "Trọng Nghĩa", "Diệu Linh", "Công Danh",
];
const MOVES: [string, number][] = [
  ["work", 30], ["coffee", 12], ["meeting", 8], ["game", 10], ["rooftop", 6], ["rest", 6],
  ["dance", 8], ["sleep", 4], ["escape", 6], ["view_rank", 3], ["view_badge", 2], ["checkin", 5],
];
const GIFTS = [
  { giftId: "rose", giftName: "Hoa hồng", count: 1 },
  { giftName: "Ly cà phê", count: 2 },
  { giftName: "Quà lạ", count: 1, value: 150 },
  { giftName: "Quà lớn", count: 1, value: 600 },
];
const MAX_VIEWERS = 60;

// Kịch bản demo tự động cho Mock Mode: người xem vào dần, gõ lệnh ngẫu nhiên, thả tim, tặng quà.
// Chỉ sinh lệnh hợp lệ (đúng alias); mọi thứ vẫn đi qua pipeline như event thật.
export function createDemo({ random, texts }: { random: () => number; texts: Record<string, string> }) {
  let t = 0, joined = 0, nextJoin = 0, nextAction = 3_000, nextLike = 5_000, nextGift = 20_000;
  const name = (i: number) => (i < NAMES.length ? NAMES[i] : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`);
  const user = () => { const i = Math.floor(random() * joined); return { name: name(i), userId: `demo-${i}` }; };
  const pick = <T,>(xs: [T, number][]): T => {
    let r = random() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [v, w] of xs) if ((r -= w) < 0) return v;
    return xs[0][0];
  };

  return {
    joined: () => joined,
    tick(dt: number): DemoStep[] {
      t += dt;
      const steps: DemoStep[] = [];
      if (t >= nextJoin && joined < MAX_VIEWERS) {
        steps.push({ do: "comment", name: name(joined), userId: `demo-${joined}`, text: texts.join });
        joined++;
        nextJoin = t + (joined < 30 ? 500 + random() * 700 : 4_000 + random() * 4_000);
      }
      if (t >= nextAction && joined > 0) {
        steps.push({ do: "comment", ...user(), text: texts[pick(MOVES)] });
        nextAction = t + 150 + random() * 500;
      }
      if (t >= nextLike && joined > 0) {
        steps.push({ do: "like", ...user(), count: 5 + Math.floor(random() * 60) });
        nextLike = t + 3_000 + random() * 6_000;
      }
      if (t >= nextGift && joined > 0) {
        steps.push({ do: "gift", ...user(), ...GIFTS[Math.floor(random() * GIFTS.length)] });
        nextGift = t + 20_000 + random() * 20_000;
      }
      return steps;
    },
  };
}

export function applyStep(p: MockLiveProvider, s: DemoStep) {
  if (s.do === "comment") p.sendComment(s.name, s.text, s.userId);
  else if (s.do === "like") p.sendLike(s.name, s.count, s.userId);
  else p.sendGift(s.name, s, s.userId);
}
