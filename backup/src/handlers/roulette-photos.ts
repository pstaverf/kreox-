import { roulettePhotoErrorContext } from './roulette-photo-errors.js';
import type { VK } from 'vk-io';
import { rouletteConfig, roulettePhotos } from '../config/roulette.js';
import { validRouletteNumber } from '../services/roulette-rules.js';
import type { MessagePhotoCache, RoulettePhotoResolver } from '../types/message-photos.js';
import { logError } from '../utils/log.js';
import { isPositiveId } from '../utils/validation.js';

export function isMessagePhotoAttachment(value: string): boolean { return /^photo-?\d+_\d+(?:_[A-Za-z0-9_-]+)?$/.test(value); }
export async function downloadRoulettePhoto(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  if (!roulettePhotos.includes(url)) throw new Error('Unconfigured roulette photo URL');
  const response = await fetcher(url, { signal: AbortSignal.timeout(rouletteConfig.photoTimeoutMs), redirect: 'error' });
  const length = response.headers.get('content-length');
  if (!response.ok || response.body === null || (length !== null && (!/^\d+$/.test(length) || Number(length) > rouletteConfig.maxPhotoBytes))) {
    await response.body?.cancel();
    throw new Error('Invalid roulette photo response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > rouletteConfig.maxPhotoBytes) {
        await reader.cancel();
        throw new Error('Roulette photo is too large');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks, size);
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new Error('Roulette photo is not JPEG');
  return buffer;
}
export function createRoulettePhotoResolver(vk: VK, cache: MessagePhotoCache, groupId: number, download: (url: string) => Promise<Buffer> = downloadRoulettePhoto): RoulettePhotoResolver {
  if (!isPositiveId(groupId)) throw new Error('Invalid photo community');
  const pending = new Map<string, Promise<string | null>>();
  const resolve: RoulettePhotoResolver = async (peerId, result) => {
    if (!isPositiveId(peerId) || !validRouletteNumber(result)) throw new Error('Invalid roulette photo identity');
    const url = roulettePhotos[result];
    if (url === undefined) throw new Error('Missing roulette photo URL');
    const key = `${groupId}:${peerId}:${url}`;
    let stage = 'cache_read';
    let photoBytes: number | undefined;
    let startedAt = Date.now();
    try {
      const cached = await cache.messagePhoto(key);
      if (cached !== null && isMessagePhotoAttachment(cached)) return cached;
      stage = 'download';
      startedAt = Date.now();
      const value = await download(url);
      photoBytes = value.byteLength;
      stage = 'vk_upload';
      startedAt = Date.now();
      const photo = await vk.upload.messagePhoto({ peer_id: peerId, source: { values: [{ value, filename: `roulette-${result}.jpg`, contentType: 'image/jpeg' }], timeout: rouletteConfig.photoTimeoutMs } });
      const attachment = photo.toString();
      if (!isMessagePhotoAttachment(attachment)) throw new Error('Invalid uploaded photo attachment');
      await cache.saveMessagePhoto(key, attachment).catch((error: unknown) => { logError('roulette_photo_cache', error, { number: result }); });
      return attachment;
    } catch (error: unknown) {
      logError('roulette_photo_upload', error, { number: result, stage, elapsedMs: Math.max(0, Date.now() - startedAt), timeoutMs: rouletteConfig.photoTimeoutMs,
        ...(photoBytes === undefined ? {} : { photoBytes }), ...(stage === 'vk_upload' ? roulettePhotoErrorContext(error) : {}) });
      return null;
    }
  };
  return async (peerId, result) => {
    const key = `${peerId}:${result}`;
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    const task = resolve(peerId, result).finally(() => { pending.delete(key); });
    pending.set(key, task);
    return task;
  };
}
