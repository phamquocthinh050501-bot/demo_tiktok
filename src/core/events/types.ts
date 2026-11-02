export type ProviderStatus = "disconnected" | "connecting" | "connected" | "error" | "mock";

export type LiveEvent =
  | { eventId?: string; type: "comment"; userId?: string; displayName: string; text: string; occurredAt: number }
  | { eventId?: string; type: "like"; userId?: string; displayName?: string; count: number; occurredAt: number }
  | {
      eventId?: string; type: "gift"; userId?: string; displayName: string;
      giftId?: string; giftName?: string; count: number; value?: number; occurredAt: number;
    }
  | { eventId?: string; type: "live_status"; status: "started" | "ended"; occurredAt: number };

// Kết quả sau pipeline; Rules Engine chỉ nhận loại này.
export type GameAction =
  | { kind: "command"; userKey: string; identityStable: boolean; displayName: string; commandId: string; group: string; at: number }
  | { kind: "likes"; count: number; at: number }
  | {
      kind: "gift"; userKey: string; identityStable: boolean; displayName: string;
      giftId?: string; giftName?: string; count: number; value?: number; at: number;
    }
  | { kind: "live_status"; status: "started" | "ended"; at: number };
