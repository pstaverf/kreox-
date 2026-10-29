import { roulettePhotoErrorContext } from './roulette-photo-errors.js';
import type { VK } from 'vk-io';
import { rouletteConfig } from '../config/roulette.js';
import { trustedPhotoUrl } from '../services/boss-rules.js';
import type { MessagePhotoCache, MessagePhotoResolver } from '../types/message-photos.js';
import { isMessagePhotoAttachment } from './roulette-photos.js';
import { logError } from '../utils/log.js';
import { isPositiveId } from '../utils/validation.js';
function isJpeg(value: Buffer): boolean { return value.length >= 4 && value[0] === 255 && value[1] === 216 && value[2] === 255; }
export async function downloadMessagePhoto(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  if (!trustedPhotoUrl(url)) throw new Error('Unconfigured message photo URL');
  const response = await fetcher(url, { signal: AbortSignal.timeout(rouletteConfig.photoTimeoutMs), redirect: 'error' });
  const length = response.headers.get('content-length');
  if (!response.ok || response.body === null || (length !== null && (!/^\d+$/.test(length) || Number(length) > rouletteConfig.maxPhotoBytes))) {
    await response.body?.cancel();
    throw new Error('Invalid message photo response');
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
        throw new Error('Message photo is too large');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks, size);
  if (!isJpeg(buffer) && !(buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) throw new Error('Message photo is not JPEG or PNG');
  return buffer;
}
export function createMessagePhotoResolver(vk: VK, cache: MessagePhotoCache, groupId: number, download: (url: string) => Promise<Buffer> = downloadMessagePhoto): MessagePhotoResolver {
  if (!isPositiveId(groupId)) throw new Error('Invalid photo community');
  const pending = new Map<string, Promise<string | null>>();
  const resolve: MessagePhotoResolver = async (peerId, url) => {
    if (!isPositiveId(peerId) || !trustedPhotoUrl(url)) throw new Error('Invalid message photo identity');
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
      const photo = await vk.upload.messagePhoto({ peer_id: peerId, source: { values: [{ value, filename: isJpeg(value) ? 'image.jpg' : 'image.png', contentType: isJpeg(value) ? 'image/jpeg' : 'image/png' }], timeout: rouletteConfig.photoTimeoutMs } });
      const attachment = photo.toString();
      if (!isMessagePhotoAttachment(attachment)) throw new Error('Invalid uploaded photo attachment');
      await cache.saveMessagePhoto(key, attachment).catch((error: unknown) => { logError('message_photo_cache', error, { source: 'message' }); });
      return attachment;
    } catch (error: unknown) {
      logError('message_photo_upload', error, { source: 'message', stage, elapsedMs: Math.max(0, Date.now() - startedAt), timeoutMs: rouletteConfig.photoTimeoutMs,
        ...(photoBytes === undefined ? {} : { photoBytes }), ...(stage === 'vk_upload' ? roulettePhotoErrorContext(error) : {}) });
      return null;
    }
  };
  return async (peerId, url) => {
    const key = `${peerId}:${url}`;
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    if (pending.size >= rouletteConfig.maxPendingPhotoLoads) return null;
    const task = resolve(peerId, url).finally(() => { pending.delete(key); });
    pending.set(key, task);
    return task;
  };
}
