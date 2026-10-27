import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { APIError, VK, type APIRequest } from 'vk-io';
import { game } from '../src/config/game.js';
import { startNotifications } from '../src/handlers/notifications.js';
import { createReferralLinkResolver } from '../src/handlers/referrals.js';
import type { Notification } from '../src/types/game.js';
import type { NotificationQueue } from '../src/types/storage.js';
import { isRecord } from '../src/utils/validation.js';

test('vk.cc shortener omits the optional private flag for the community token', async context => {
  const vk = new VK({ token: 'test-token' });
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'utils.getShortLink');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.url, 'https://vk.me/club123?ref=kreox_456');
    assert.equal(Object.hasOwn(params, 'private'), false);
    assert.deepEqual(Object.keys(params), ['url']);
    const body = new URLSearchParams({ url: String(params.url) });
    assert.equal(body.has('private'), false);
    assert.equal(body.get('url'), 'https://vk.me/club123?ref=kreox_456');
    return { short_url: 'https://vk.cc/abc123', key: 'abc123', url: params.url };
  });
  context.after(() => api.mock.restore());
  assert.equal(await createReferralLinkResolver(vk, 123)(456), 'https://vk.cc/abc123');
});

test('notification retry survives a worker restart and reuses the committed random ID without a keyboard', async context => {
  const vk = new VK({ token: 'test-token' });
  const notification: Notification = {
    _id: 'referral:2', peerId: 1, randomId: 777, text: '👬 Награда',
    state: 'pending', nextAttemptAt: new Date(0), attempts: 0
  };
  let available = true;
  let round = Promise.withResolvers<void>();
  let delay = 0;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      if (!available || notification.state !== 'pending') {
        return null;
      }
      available = false;
      notification.attempts += 1;
      notification.leaseId = leaseId;
      return structuredClone(notification);
    },
    async finishNotification(id, leaseId, state, delayMs) {
      assert.equal(id, notification._id);
      assert.equal(leaseId, notification.leaseId);
      notification.state = state;
      delay = delayMs;
      round.resolve();
    }
  };
  let sends = 0;
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.random_id, 777);
    assert.equal(params.peer_id, 1);
    assert.equal(params.keyboard, undefined);
    assert.equal(params.disable_mentions, true);
    sends += 1;
    if (sends === 1) {
      throw new Error('Network failure with test-secret');
    }
    return [];
  });
  const logs: string[] = [];
  const logger = mock.method(console, 'error', (value: unknown) => { logs.push(String(value)); });
  context.after(() => { api.mock.restore(); logger.mock.restore(); });
  const stopFirst = startNotifications(queue, vk);
  await round.promise;
  await stopFirst();
  assert.equal(notification.state, 'pending');
  assert.equal(delay, game.notificationRetryMs);
  assert.equal(notification.randomId, 777);
  assert.ok(logs.every(value => !value.includes('test-secret')));
  available = true;
  round = Promise.withResolvers<void>();
  const stopSecond = startNotifications(queue, vk);
  await round.promise;
  await stopSecond();
  assert.equal(notification.state, 'sent');
  assert.equal(notification.attempts, 2);
  assert.equal(sends, 2);
});

test('closed DMs permanently fail only the notification, without retrying the economic reward', async context => {
  const vk = new VK({ token: 'test-token' });
  const finished = Promise.withResolvers<'sent' | 'failed' | 'pending'>();
  let leased = false;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      if (leased) {
        return null;
      }
      leased = true;
      return { _id: 'referral:2', peerId: 1, randomId: 20, text: 'Награда', state: 'pending',
        nextAttemptAt: new Date(0), attempts: 1, leaseId };
    },
    async finishNotification(_id, _leaseId, state) { finished.resolve(state); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async () => {
    throw new APIError({ error_code: 901, error_msg: 'Forbidden', request_params: [] });
  });
  const logger = mock.method(console, 'error', () => {});
  context.after(() => { api.mock.restore(); logger.mock.restore(); });
  const stop = startNotifications(queue, vk);
  assert.equal(await finished.promise, 'failed');
  await stop();
  assert.equal(api.mock.callCount(), 1);
});


test('shortener error diagnostics expose only a parameter hint, not the token or request data', async context => {
  const vk = new VK({ token: 'test-secret' });
  const error = new APIError({
    error_code: 100,
    error_msg: 'One of the parameters specified was missing or invalid: private should be boolean; test-secret',
    request_params: [{ key: 'access_token', value: 'test-secret' }, { key: 'private', value: 'true' }]
  });
  const api = mock.method(vk.api, 'callWithRequest', async () => { throw error; });
  const lines: string[] = [];
  const logger = mock.method(console, 'error', (value: unknown) => { lines.push(String(value)); });
  context.after(() => { api.mock.restore(); logger.mock.restore(); });
  await assert.rejects(createReferralLinkResolver(vk, 123)(456), (caught: unknown) => caught === error);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.ok(line);
  assert.equal(line.includes('test-secret'), false);
  assert.equal(line.includes('access_token'), false);
  const details: unknown = JSON.parse(line);
  assert.ok(isRecord(details));
  assert.equal(details.scope, 'referral_short_link');
  assert.equal(details.method, 'utils.getShortLink');
  assert.equal(details.code, 100);
  assert.equal(details.parameterHint, 'private');
});

test('item offer notifications preserve the inline purchase keyboard and durable random ID', async context => {
  const vk = new VK({ token: 'test-token' });
  const finished = Promise.withResolvers<void>();
  let leased = false;
  const queue: NotificationQueue = {
    async leaseNotification() {
      if (leased) {
        return null;
      }
      leased = true;
      return { _id: 'offer:test', peerId: 2, text: 'Предложение', randomId: 999, state: 'pending',
        nextAttemptAt: new Date(0), attempts: 1, keyboard: { kind: 'item_offer', offerId: 'test' } };
    },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); finished.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.random_id, 999);
    assert.equal(params.peer_id, 2);
    assert.equal(typeof params.keyboard, 'string');
    if (typeof params.keyboard !== 'string') {
      assert.fail('Missing offer keyboard');
    }
    const keyboard: unknown = JSON.parse(params.keyboard);
    assert.ok(isRecord(keyboard));
    assert.equal(keyboard.inline, true);
    return [];
  });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk);
  await finished.promise;
  await stop();
});

test('committed casino jobs can wake delivery immediately and shutdown disables future wakes', async context => {
  const vk = new VK({ token: 'test-token' });
  const finished = Promise.withResolvers<void>();
  let available = false;
  let leased = false;
  let reads = 0;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      reads += 1;
      if (!available || leased) return null;
      leased = true;
      return { _id: 'casino-wake', peerId: 2_000_000_001, text: 'Итоги', randomId: 777, state: 'pending', nextAttemptAt: new Date(0), attempts: 1, leaseId };
    },
    async finishNotification(_id, _leaseId, state) {
      assert.equal(state, 'sent');
      finished.resolve();
    }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    assert.equal(request.method, 'messages.send');
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.random_id, 777);
    return [];
  });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk);
  context.after(stop);
  await new Promise<void>(resolve => setImmediate(resolve));
  available = true;
  stop.wake();
  await finished.promise;
  await stop();
  const stoppedReads = reads;
  stop.wake();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(reads, stoppedReads);
  assert.equal(api.mock.callCount(), 1);
});

test('a blocked mailing recipient does not prevent delivery to the next recipient or add a keyboard', async context => {
  const vk = new VK({ token: 'test-token' });
  const notices: Notification[] = [1, 2].map(peerId => ({ _id: `mailing:test:${peerId}`, peerId, randomId: 100 + peerId,
    text: 'Новости\nПолный текст', priority: 1, state: 'pending', nextAttemptAt: new Date(0), attempts: 1 }));
  let index = 0;
  const states: string[] = [];
  const finished = Promise.withResolvers<void>();
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      const notice = notices[index++];
      return notice === undefined ? null : { ...notice, leaseId };
    },
    async finishNotification(_id, _leaseId, state) {
      states.push(state);
      if (states.length === 2) finished.resolve();
    }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => {
    const params: unknown = request.params;
    assert.ok(isRecord(params));
    assert.equal(params.message, 'Новости\nПолный текст');
    assert.equal(params.keyboard, undefined);
    if (params.peer_id === 1) throw new APIError({ error_code: 901, error_msg: 'Forbidden', request_params: [] });
    assert.equal(params.peer_id, 2);
    assert.equal(params.random_id, 102);
    return [];
  });
  const logger = mock.method(console, 'error', () => {});
  context.after(() => { api.mock.restore(); logger.mock.restore(); });
  const stop = startNotifications(queue, vk);
  context.after(stop);
  await finished.promise;
  await stop();
  assert.deepEqual(states, ['failed', 'sent']);
});

test('an immediate wake during an in-flight empty lease is retained instead of waiting for the interval', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const vk = new VK({ token: 'test-token' });
  const firstLease = Promise.withResolvers<Notification | null>();
  const sent = Promise.withResolvers<void>();
  let reads = 0;
  let available = false;
  const queue: NotificationQueue = {
    async leaseNotification(leaseId) {
      reads += 1;
      if (reads === 1) return firstLease.promise;
      if (!available) return null;
      available = false;
      return { _id: 'wake-during-lease', peerId: 1, randomId: 777, text: 'Награда', state: 'pending', attempts: 1, nextAttemptAt: new Date(0), leaseId };
    },
    async finishNotification(_id, _leaseId, state) { assert.equal(state, 'sent'); sent.resolve(); }
  };
  const api = mock.method(vk.api, 'callWithRequest', async (request: APIRequest) => { assert.equal(request.method, 'messages.send'); return 1; });
  context.after(() => api.mock.restore());
  const stop = startNotifications(queue, vk);
  context.after(stop);
  assert.equal(reads, 1);
  available = true;
  for (let index = 0; index < 10; index += 1) stop.wake();
  firstLease.resolve(null);
  await sent.promise;
  await stop();
  assert.equal(api.mock.callCount(), 1);
  assert.ok(reads <= 3);
});
