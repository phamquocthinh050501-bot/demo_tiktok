import type { LiveEvent, ProviderStatus } from "../../core/events/types.ts";

export interface ProviderCapabilities {
  comments: boolean; likes: boolean; gifts: boolean; liveStatus: boolean; viewerCount: boolean;
}

export interface LiveProvider {
  connect(config?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): ProviderStatus;
  onEvent(handler: (event: LiveEvent) => void): () => void;
  capabilities(): ProviderCapabilities;
}
