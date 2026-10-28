import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PhotoAttachment, VK, type APIRequest } from 'vk-io';
import { createMessagePhotoResolver, downloadMessagePhoto } from '../src/handlers/message-photos.js';
import { doublePhotos } from '../src/config/double.js';
import { rouletteConfig } from '../src/config/roulette.js';
import { startNotifications } from '../src/handlers/notifications.js';
import type { MessagePhotoCache } from '../src/types/message-photos.js';
import type { Notification, PreparedReply } from '../src/types/game.js';
import type { NotificationQueue } from '../src/types/storage.js';
import { isRecord } from '../src/utils/validation.js';
import { createMessageHandler } from '../src/handlers/messages.js';
import { GameService } from '../src/services/game.js';
import { MessageContext, UpdateSource } from 'vk-io';
import { MemoryDatabase } from './memory.js';

const jpeg = Buffer.from([255, 216, 255, 217]);
function cache(): MessagePhotoCache {
  const values = new Map<string, string>();
  return { messagePhoto: async key => values.get(key) ?? null, saveMessagePhoto: async (key, value) => { values.set(key, value); } };
}

test('double and boss photos upload real attachments with persistent peer/community-scoped caching and concurrent upload coalescing', async context => {
  const vk = new VK({ token: 'test' });
  const stored = cache();
  const upload = mock.method(vk.upload, 'messagePhoto', async () => new PhotoAttachment({ api: vk.api, payload: { id: 17, owner_id: -123 } }));
  context.after(() => upload.mock.restore());
  let downloads = 0;
  const resolver = createMessagePhotoResolver(vk, stored, 123, async () => { downloads += 1; return jpeg; });
  const url = doublePhotos[3];
  assert.ok(url);
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => resolver(1, url))), Array.from({ length: 5 }, () => 'photo-123_17'));
  assert.equal(downloads, 1);
  assert.equal(upload.mock.callCount(), 1);
  assert.equal(await createMessagePhotoResolver(vk, stored, 123, async () => { throw new Error('Cache must persist'); })(1, url), 'photo-123_17');
  await resolver(2, url);
  assert.equal(downloads, 2);
  await createMessagePhotoResolver(vk, stored, 456, async () => { downloads += 1; return jpeg; })(1, url);
  assert.equal(downloads, 3);
});

test('photo downloading accepts JPEG/PNG, rejects untrusted hosts/redirects/oversized data and sets a deadline', async () => {
  const url = doublePhotos[2];
  assert.ok(url);
  assert.deepEqual(await downloadMessagePhoto(url, async (_url, options) => {
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response(new Uint8Array(jpeg));
  }), jpeg);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(await downloadMessagePhoto(url, async () => new Response(new Uint8Array(png))), png);
  for (const bad of ['http://127.0.0.1/a', 'https://evil.example/a', 'https://cdn.kleymorf.xyz.evil.example/a', 'https://secret@cdn.kleymorf.xyz/a']) await assert.rejects(downloadMessagePhoto(bad), /Unconfigured/u);
  await assert.rejects(downloadMessagePhoto(url, async () => new Response('<svg>not supported</svg>')), /not JPEG or PNG/u);
  await assert.rejects(downloadMessagePhoto(url, async () => new Response(new Uint8Array(jpeg), { headers: { 'content-length': String(rouletteConfig.maxPhotoBytes + 1) } })), /Invalid message photo response/u);
});

test('double notifications attach the selected cached photo without sending its external URL', async context => {
  const vk = new VK({ token: 'test' });
  const done = Promise.withResolvers<void>();
  let leased = false;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) { if (leased) return null; leased = true; return { _id: 'double-result', peerId: 2_000_000_001, text: 'Итоги', photoUrl: doublePhotos[5] ?? '', randomId: 123, state: 'pending', attempts: 1, nextAttemptAt: new Date(0), leaseId }; },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); done.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.attachment, 'photo-123_17');
    assert.equal(params.random_id, 123);
    assert.equal(JSON.stringify(params).includes('cdn.kleymorf.xyz'), false);
    return 1;
  });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk, undefined, async (_peerId, url) => { assert.equal(url, doublePhotos[5]); return 'photo-123_17'; });
  await done.promise;
  await stop();
  assert.equal(api.mock.callCount(), 1);
});

test('queued boss announcements are discarded after unsubscribe or death, without a VK call', async context => {
  const vk = new VK({ token: 'test' });
  const done = Promise.withResolvers<void>();
  let leased = false;
  const notification: Notification = { _id: 'boss-summon:old:1', peerId: 1, text: 'Босс призван', bossSummon: 'boss:old', randomId: 4, state: 'pending', attempts: 1, nextAttemptAt: new Date(0) };
  const queue: NotificationQueue = {
    async leaseNotification() { if (leased) return null; leased = true; return notification; },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); done.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async () => { throw new Error('Must not send an obsolete boss notice'); });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk, undefined, undefined, async (vkId, runId) => { assert.equal(vkId, 1); assert.equal(runId, 'boss:old'); return false; });
  await done.promise;
  await stop();
  assert.equal(api.mock.callCount(), 0);
});

test('boss menu photos resolve after the business transaction, use persisted random IDs and do not become text links', async context => {
  const vk = new VK({ token: 'test' });
  const db = new MemoryDatabase();
  const service = new GameService(db);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  await service.handle({ eventId: 'summon', vkId: 888801846, command: { kind: 'boss_create', health: 100, name: 'Ахиллес', color: '💙', photo: 'https://cdn.kleymorf.xyz/boss.jpg' } }, async () => 'Админ');
  const replies: PreparedReply[] = [];
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.attachment, 'photo-123_17');
    return 1;
  });
  context.after(() => api.mock.restore());
  const handle = createMessageHandler(vk, service, 123, undefined, async () => {
    const record = db.state.messages.get('123:1:7');
    assert.ok(record);
    replies.push(record.reply);
    return 'photo-123_17';
  });
  const message = new MessageContext({ api: vk.api, upload: vk.upload, source: UpdateSource.WEBHOOK, updateType: 'message_new', groupId: 123, payload: { client_info: { button_actions: ['text'], keyboard: true, inline_keyboard: true, carousel: false, lang_id: 0 }, message: { id: 7, conversation_message_id: 7, date: 1, peer_id: 1, from_id: 1, random_id: 0, attachments: [], important: false, text: '🎩 Босс', payload: JSON.stringify({ command: 'boss' }), out: 0 } } });
  await handle(message);
  assert.equal(replies.length, 1);
  assert.equal(api.mock.callCount(), 1);
});
