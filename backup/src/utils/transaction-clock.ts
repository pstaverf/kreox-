export class TransactionClock {
  private time: Promise<number> | undefined;

  constructor(private readonly read: () => Promise<Date>) {}

  async now(): Promise<Date> {
    this.time ??= this.read().then(date => {
      const value = date.getTime();
      if (!Number.isFinite(value)) throw new Error('Database time is unavailable');
      return value;
    });
    return new Date(await this.time);
  }
}
