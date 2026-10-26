export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${String(value)}`);
}
