import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PhotoAttachment, VK, type APIRequest } from 'vk-io';
import { rouletteConfig, roulettePhotos } from '../src/config/roulette.js';
import { startNotifications } from '../src/handlers/notifications.js';
import { createRoulettePhotoResolver, downloadRoulettePhoto } from '../src/handlers/roulette-photos.js';
import type { MessagePhotoCache } from '../src/types/message-photos.js';
import type { NotificationQueue } from '../src/types/storage.js';
import { isRecord } from '../src/utils/validation.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
function cache(): MessagePhotoCache {
  const photos = new Map<string, string>();
  return {
    messagePhoto: async key => photos.get(key) ?? null,
    saveMessagePhoto: async (key, value) => { photos.set(key, value); }
  };
}

test('configured JPEG downloads enforce an abort deadline, size limit and no redirects before upload', async () => {
  const url = roulettePhotos[0];
  assert.ok(url);
  const downloaded = await downloadRoulettePhoto(url, async (input, options) => {
    assert.equal(input, url);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return new Response(new Uint8Array(jpeg), { headers: { 'content-length': '4' } });
  });
  assert.deepEqual(downloaded, jpeg);
  await assert.rejects(downloadRoulettePhoto('http://127.0.0.1/private', async () => { throw new Error('Must not fetch unconfigured URLs'); }), /Unconfigured/);
  await assert.rejects(downloadRoulettePhoto(url, async () => new Response('Missing', { status: 404 })), /Invalid roulette photo response/);
  await assert.rejects(downloadRoulettePhoto(url, async () => new Response(new Uint8Array(jpeg), { headers: { 'content-length': String(rouletteConfig.maxPhotoBytes + 1) } })), /Invalid roulette photo response/);
  await assert.rejects(downloadRoulettePhoto(url, async () => new Response(new Uint8Array(rouletteConfig.maxPhotoBytes + 1))), /too large/);
  await assert.rejects(downloadRoulettePhoto(url, async () => new Response('<html>not a photo</html>')), /not JPEG/);
});

test('URL photos become actual VK photo attachments and durable cache entries scoped to peer and community', async context => {
  const vk = new VK({ token: 'test-token' });
  const stored = cache();
  let downloads = 0;
  const uploader = mock.method(vk.upload, 'messagePhoto', async (options: unknown) => {
    const value: unknown = options;
    assert.ok(isRecord(value) && isRecord(value.source) && Array.isArray(value.source.values));
    const source: unknown = value.source.values[0];
    assert.ok(isRecord(source));
    assert.deepEqual(source.value, jpeg);
    assert.equal(source.contentType, 'image/jpeg');
    assert.equal(value.source.timeout, rouletteConfig.photoTimeoutMs);
    assert.ok(value.peer_id === 2_000_000_001 || value.peer_id === 2_000_000_002);
    return new PhotoAttachment({ api: vk.api, payload: { id: 9, owner_id: -123, access_key: 'test_key' } });
  });
  context.after(() => uploader.mock.restore());
  const resolver = createRoulettePhotoResolver(vk, stored, 123, async url => {
    downloads += 1;
    assert.ok(url === roulettePhotos[2] || url === roulettePhotos[0]);
    return jpeg;
  });
  assert.equal(await resolver(2_000_000_001, 2), 'photo-123_9_test_key');
  assert.equal(await resolver(2_000_000_001, 2), 'photo-123_9_test_key');
  assert.equal(downloads, 1);
  const restarted = createRoulettePhotoResolver(vk, stored, 123, async () => { throw new Error('Cached photo must survive restart'); });
  assert.equal(await restarted(2_000_000_001, 2), 'photo-123_9_test_key');
  await resolver(2_000_000_002, 2);
  await resolver(2_000_000_001, 0);
  assert.equal(downloads, 3);
  assert.equal(uploader.mock.callCount(), 3);
  const otherCommunity = createRoulettePhotoResolver(vk, stored, 456, async () => { downloads += 1; return jpeg; });
  await otherCommunity(2_000_000_001, 2);
  assert.equal(downloads, 4);
  await assert.rejects(resolver(2_000_000_001, 37), /Invalid roulette photo identity/);
});

test('photo download failures fall back to text and never log URLs, token or error messages', async context => {
  const vk = new VK({ token: 'test-secret' });
  const lines: string[] = [];
  const logger = mock.method(console, 'error', (line: unknown) => { lines.push(String(line)); });
  context.after(() => logger.mock.restore());
  const resolver = createRoulettePhotoResolver(vk, cache(), 123, async () => { throw new Error('https://private.example/test-secret'); });
  assert.equal(await resolver(2_000_000_001, 0), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? '', /roulette_photo_upload/);
  assert.ok(lines.every(line => !line.includes('test-secret') && !line.includes('private.example')));
});

test('notification delivery attaches zero result photo with the committed random ID, not a text URL', async context => {
  const vk = new VK({ token: 'test-token' });
  const finished = Promise.withResolvers<void>();
  let leased = false;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      if (leased) return null;
      leased = true;
      return { _id: 'roulette:zero', peerId: 2_000_000_001, text: '🎰 Итоги игры "Рулетка":\n\n🎡 Выпало — 0🟢', roulettePhoto: 0,
        randomId: 555, state: 'pending', nextAttemptAt: new Date(0), attempts: 1, leaseId };
    },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); finished.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.attachment, 'photo-123_9_key');
    assert.equal(params.random_id, 555);
    assert.equal(params.peer_id, 2_000_000_001);
    assert.equal(params.message, '🎰 Итоги игры "Рулетка":\n\n🎡 Выпало — 0🟢');
    return [];
  });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk, async (peerId, result) => {
    assert.equal(peerId, 2_000_000_001);
    assert.equal(result, 0);
    return 'photo-123_9_key';
  });
  context.after(stop);
  await finished.promise;
  await stop();
});

test('failed image resolution still marks a successfully delivered text result as sent', async context => {
  const vk = new VK({ token: 'test-token' });
  const finished = Promise.withResolvers<void>();
  let leased = false;
  const queue: NotificationQueue = {
    async leaseNotification() {
      if (leased) return null;
      leased = true;
      return { _id: 'roulette:no-cdn', peerId: 2_000_000_001, text: 'Итоги', roulettePhoto: 14, randomId: 556,
        state: 'pending', nextAttemptAt: new Date(0), attempts: 1 };
    },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); finished.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(Object.hasOwn(params, 'attachment'), false);
    assert.equal(params.random_id, 556);
    return [];
  });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk, async () => null);
  context.after(stop);
  await finished.promise;
  await stop();
});

test('a failed cache write does not discard an uploaded attachment and corrupt cache entries are never sent', async context => {
  const vk = new VK({ token: 'test-token' });
  const stored: MessagePhotoCache = {
    async messagePhoto() { return 'https://not-a-vk-attachment.example'; },
    async saveMessagePhoto() { throw new Error('Cache write unavailable'); }
  };
  const upload = mock.method(vk.upload, 'messagePhoto', async () => new PhotoAttachment({ api: vk.api, payload: { id: 9, owner_id: -123 } }));
  const logger = mock.method(console, 'error', () => {});
  context.after(() => { upload.mock.restore(); logger.mock.restore(); });
  assert.equal(await createRoulettePhotoResolver(vk, stored, 123, async () => jpeg)(2_000_000_001, 0), 'photo-123_9');
  assert.equal(upload.mock.callCount(), 1);
});

test('photo result delivery retries after restart with the same persisted random ID and cached attachment', async context => {
  const vk = new VK({ token: 'test-token' });
  const stored = cache();
  let available = true;
  let finished = Promise.withResolvers<'sent' | 'failed' | 'pending'>();
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      if (!available) return null;
      available = false;
      return { _id: 'roulette:retry', peerId: 2_000_000_001, text: 'Итоги', roulettePhoto: 0, randomId: 557,
        state: 'pending', nextAttemptAt: new Date(0), attempts: 1, leaseId };
    },
    async finishNotification(_id, _leaseId, state) { finished.resolve(state); }
  };
  const upload = mock.method(vk.upload, 'messagePhoto', async () => new PhotoAttachment({ api: vk.api, payload: { id: 9, owner_id: -123 } }));
  let sends = 0;
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.random_id, 557);
    assert.equal(params.attachment, 'photo-123_9');
    sends += 1;
    if (sends === 1) throw new Error('Temporary network failure');
    return [];
  });
  const logger = mock.method(console, 'error', () => {});
  context.after(() => { upload.mock.restore(); api.mock.restore(); logger.mock.restore(); });
  const stopFirst = startNotifications(queue, vk, createRoulettePhotoResolver(vk, stored, 123, async () => jpeg));
  context.after(stopFirst);
  assert.equal(await finished.promise, 'pending');
  await stopFirst();
  finished = Promise.withResolvers<'sent' | 'failed' | 'pending'>();
  available = true;
  const stopSecond = startNotifications(queue, vk, createRoulettePhotoResolver(vk, stored, 123, async () => { throw new Error('Must use durable cache'); }));
  context.after(stopSecond);
  assert.equal(await finished.promise, 'sent');
  await stopSecond();
  assert.equal(sends, 2);
  assert.equal(upload.mock.callCount(), 1);
});

test('photo abort diagnostics distinguish CDN body download from VK upload without disclosing network details', async context => {
  const vk = new VK({ token: 'test-secret' });
  const lines: string[] = [];
  const logger = mock.method(console, 'error', (line: unknown) => { lines.push(String(line)); });
  context.after(() => logger.mock.restore());
  const failure = new DOMException('https://private.example/test-secret', 'AbortError');
  const fromCdn = createRoulettePhotoResolver(vk, cache(), 123, async () => { throw failure; });
  assert.equal(await fromCdn(2_000_000_001, 25), null);
  const upload = mock.method(vk.upload, 'messagePhoto', async () => { throw failure; });
  context.after(() => upload.mock.restore());
  const fromVk = createRoulettePhotoResolver(vk, cache(), 123, async () => jpeg);
  assert.equal(await fromVk(2_000_000_001, 25), null);
  const brokenCache: MessagePhotoCache = {
    async messagePhoto() { throw new Error('test-secret'); },
    async saveMessagePhoto() { throw new Error('Must not write after a cache read failure'); }
  };
  assert.equal(await createRoulettePhotoResolver(vk, brokenCache, 123, async () => jpeg)(2_000_000_001, 25), null);
  assert.equal(lines.length, 3);
  for (const [index, stage] of ['download', 'vk_upload', 'cache_read'].entries()) {
    const value: unknown = JSON.parse(lines[index] ?? 'null');
    assert.ok(isRecord(value));
    assert.equal(value.scope, 'roulette_photo_upload');
    assert.equal(value.stage, stage);
    assert.equal(value.number, 25);
    assert.equal(value.timeoutMs, 30_000);
    assert.ok(typeof value.elapsedMs === 'number' && value.elapsedMs >= 0);
    if (stage !== 'cache_read') assert.equal(value.type, 'AbortError');
  }
  assert.ok(lines.every(line => !line.includes('test-secret') && !line.includes('private.example')));
});

test('download timeout remains active while reading the body, not just waiting for HTTP headers', async context => {
  const abort = new AbortController();
  const deadline = mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 30_000);
    return abort.signal;
  });
  context.after(() => deadline.mock.restore());
  const url = roulettePhotos[25];
  assert.ok(url);
  await assert.rejects(downloadRoulettePhoto(url, async (_input, options) => {
    const signal = options?.signal;
    assert.equal(signal, abort.signal);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        queueMicrotask(() => abort.abort(new DOMException('Timed out', 'AbortError')));
      }
    });
    return new Response(body);
  }), { name: 'AbortError' });
  assert.equal(deadline.mock.callCount(), 1);
});

test('result delivery reuses a still-running prefetch rather than uploading the same photo twice', async context => {
  const vk = new VK({ token: 'test-token' });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Buffer>();
  let downloads = 0;
  const upload = mock.method(vk.upload, 'messagePhoto', async () => new PhotoAttachment({ api: vk.api, payload: { id: 9, owner_id: -123 } }));
  context.after(() => upload.mock.restore());
  const stored = cache();
  const resolve = createRoulettePhotoResolver(vk, stored, 123, async () => {
    downloads += 1;
    started.resolve();
    return release.promise;
  });
  const prefetch = resolve(2_000_000_001, 25);
  await started.promise;
  const result = resolve(2_000_000_001, 25);
  assert.equal(downloads, 1);
  release.resolve(jpeg);
  assert.deepEqual(await Promise.all([prefetch, result]), ['photo-123_9', 'photo-123_9']);
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(await resolve(2_000_000_001, 25), 'photo-123_9');
  assert.equal(downloads, 1);
});
