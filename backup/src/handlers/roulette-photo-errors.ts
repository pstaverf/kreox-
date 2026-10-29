import { APIError, ExecuteError } from 'vk-io';
import { isRecord } from '../utils/validation.js';

const methods = ['photos.getMessagesUploadServer', 'photos.saveMessagesPhoto'] as const;

export function roulettePhotoErrorContext(error: unknown): Record<string, string> {
  if (!(error instanceof APIError)) return {};
  const params: unknown = error.params;
  const parameter: unknown = Array.isArray(params) ? params.find((entry: unknown) => isRecord(entry) && entry.key === 'method') : undefined;
  const requested: unknown = error instanceof ExecuteError ? error.method : isRecord(parameter) ? parameter.value : undefined;
  const method = methods.find(value => value === requested) ?? 'unknown';
  const parameterHint = error.code === 100 ? /\b(peer_id|photo|server|hash)\b/i.exec(error.message)?.[1]?.toLowerCase() : undefined;
  return { method, ...(parameterHint === undefined ? {} : { parameterHint }) };
}
