import { storageConfig } from '../config/storage.js';

export class ChatRegistryCache {
  private readonly entries = new Map<number, { active: boolean; expiresAt: number }>();
  private readonly pending = new Map<number, Promise<void>>();

  constructor(private readonly write: (peerId: number, active: boolean) => Promise<void>, private readonly now: () => number = () => performance.now()) {}

  async recordChat(peerId: number, active = true): Promise<void> {
    if (!Number.isSafeInteger(peerId) || peerId <= 2_000_000_000) throw new Error('Invalid chat peer');
    const previous = this.pending.get(peerId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const entry = this.entries.get(peerId);
      if (entry?.active === active && entry.expiresAt > this.now()) return;
      try {
        await this.write(peerId, active);
      } catch (error: unknown) {
        this.entries.delete(peerId);
        throw error;
      }
      this.entries.delete(peerId);
      if (this.entries.size >= storageConfig.chatCacheLimit) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      this.entries.set(peerId, { active, expiresAt: this.now() + storageConfig.chatCacheTtlMs });
    });
    this.pending.set(peerId, current);
    try {
      await current;
    } finally {
      if (this.pending.get(peerId) === current) this.pending.delete(peerId);
    }
  }
}
