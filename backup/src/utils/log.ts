import { APIError } from 'vk-io';
import { MongoServerError } from 'mongodb';

export function logError(scope: string, error: unknown, context: Record<string, string | number> = {}): void {
  console.error(JSON.stringify({
    scope,
    type: error instanceof Error ? error.name : 'UnknownError',
    code: error instanceof APIError || error instanceof MongoServerError ? error.code : undefined,
    ...context
  }));
}
