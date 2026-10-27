import { game } from '../config/game.js';

export interface ResponseIdRange { first: number; last: number }
export class ResponseIds {
  private next = 1;
  private last = 0;
  private pending: Promise<void> | undefined;

  constructor(private readonly reserve: () => Promise<ResponseIdRange>) {}

  async take(): Promise<number> {
    while (this.next > this.last) {
      this.pending ??= this.refill().finally(() => { this.pending = undefined; });
      await this.pending;
    }
    const id = this.next;
    this.next += 1;
    return id;
  }

  private async refill(): Promise<void> {
    const range = await this.reserve();
    if (!Number.isSafeInteger(range.first) || !Number.isSafeInteger(range.last)
      || range.first <= this.last || range.first > range.last || range.last > game.maxRandomId) {
      throw new Error('Invalid response ID range');
    }
    this.next = range.first;
    this.last = range.last;
  }
}
