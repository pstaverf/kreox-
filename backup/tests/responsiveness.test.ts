import { startBankWorker } from '../src/handlers/bank-worker.js';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { diceChatKey } from '../src/services/dice-rules.js';
import { giveawayKey } from '../src/services/giveaway-rules.js';
import type { GameInput } from '../src/types/game.js';
import type { GameDatabase } from '../src/types/storage.js';
import { MemoryDatabase } from './memory.js';

const peer = 2_000_000_001;
const admin = 888801846;
async function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db);
  for (const vkId of [1, 2, admin]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 100_000;
  }
  return { db, service };
}
function instrument(db: MemoryDatabase) {
  const metrics = { records: 0, clock: 0, mailing: 0, players: 0, processed: 0 };
  const database: GameDatabase = {
    hasPlayer: vkId => db.hasPlayer(vkId),
    transaction: action => db.transaction(async store => {
      const get = store.casinoGet.bind(store);
      const now = store.now.bind(store);
      const join = store.joinMailing.bind(store);
      const player = store.player.bind(store);
      const processed = store.processed.bind(store);
      store.casinoGet = id => { metrics.records += 1; return get(id); };
      store.now = () => { metrics.clock += 1; return now(); };
      store.joinMailing = (vkId, date) => { metrics.mailing += 1; return join(vkId, date); };
      store.player = vkId => { metrics.players += 1; return player(vkId); };
      store.processed = eventId => { metrics.processed += 1; return processed(eventId); };
      return action(store);
    })
  };
  return { metrics, service: new GameService(database) };
}

test('giveaway processing uses exactly one current-state read and one receipt read per active claim', async () => {
  const f = await fixture();
  await f.service.handle({ eventId: 'giveaway', vkId: admin, peerId: peer, isChat: true, command: parseCommand('/force Раздача монеты 3 100', undefined, true) }, async () => 'Игрок');
  const state = f.db.state.casino.get(giveawayKey(peer));
  assert.ok(state?.kind === 'giveaway');
  const p = instrument(f.db);
  for (const vkId of [1, 2]) {
    p.metrics.records = 0;
    const reply = await p.service.handle({ eventId: `claim:${vkId}`, vkId, peerId: peer, isChat: true, command: { kind: 'giveaway_claim', peerId: peer, token: state.token } }, async () => 'Игрок');
    assert.equal(p.metrics.records, 2);
    assert.match(reply.text, /вы приняли участие/u);
    assert.equal(reply.text.split('\n\n').length, 2);
    assert.match(reply.text, /награды:\n💰 100 KC\n\nОсталось/u);
    assert.equal(f.db.player(vkId).kc, 110_000);
  }
  const saved = f.db.state.casino.get(giveawayKey(peer));
  assert.ok(saved?.kind === 'giveaway');
  assert.equal(saved.remaining, 1);
  p.metrics.records = 0;
  const cancelled = await p.service.handle({ eventId: 'cancel', vkId: admin, peerId: peer, isChat: true,
    command: { kind: 'giveaway_cancel', peerId: peer, token: state.token } }, async () => 'Игрок');
  assert.equal(p.metrics.records, 1);
  assert.match(cancelled.text, /Раздача отменена/u);
});

test('normal DM profile avoids an extra database clock read and replay only reads the processed event', async () => {
  const f = await fixture();
  const p = instrument(f.db);
  const input: GameInput = { eventId: 'dm-profile', vkId: 1, peerId: 1, command: { kind: 'profile' } };
  const first = await p.service.handle(input, async () => 'Игрок');
  assert.equal(p.metrics.clock, 1);
  assert.equal(p.metrics.mailing, 1);
  const joinedAt = f.db.state.mailingAudience.get(1);
  assert.deepEqual(joinedAt, f.db.time);
  p.metrics.clock = 0;
  p.metrics.mailing = 0;
  p.metrics.players = 0;
  p.metrics.processed = 0;
  f.db.time = new Date(f.db.time.getTime() + 60_000);
  assert.deepEqual(await p.service.handle(input, async () => 'Игрок'), first);
  assert.deepEqual(p.metrics, { records: 0, clock: 0, mailing: 0, players: 0, processed: 1 });
  await p.service.handle({ ...input, eventId: 'dm-profile-next' }, async () => 'Игрок');
  assert.deepEqual(f.db.state.mailingAudience.get(1), joinedAt);
});

test('new durable notifications signal delivery only after commit; no polling wake for ordinary reads or duplicate events', async () => {
  const f = await fixture();
  await f.service.handle({ eventId: 'dice-create', vkId: 1, peerId: peer, isChat: true, command: parseCommand('кости 1000', undefined, true) }, async () => 'Игрок');
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const gated: GameDatabase = {
    hasPlayer: vkId => f.db.hasPlayer(vkId),
    transaction: action => f.db.transaction(async store => {
      const outcome = await action(store);
      ready.resolve();
      await release.promise;
      return outcome;
    })
  };
  let wakes = 0;
  const onCommit = (): void => {
    wakes += 1;
    assert.ok(f.db.state.notifications.some(value => value._id === `dice-result:${peer}:1`));
  };
  const input: GameInput = { eventId: 'dice-last', vkId: 2, peerId: peer, isChat: true, command: { kind: 'dice_join', peerId: peer, gameId: 1 } };
  const task = new GameService(gated).handle(input, async () => 'Игрок', undefined, onCommit);
  await ready.promise;
  assert.equal(wakes, 0);
  assert.equal(f.db.state.notifications.length, 0);
  const before = f.db.state.casino.get(diceChatKey(peer));
  assert.ok(before?.kind === 'dice_chat');
  assert.equal(before.games[0]?.players.length, 1);
  release.resolve();
  const reply = await task;
  assert.equal(wakes, 1);
  assert.equal(Object.hasOwn(reply, 'wake'), false);
  await f.service.handle(input, async () => 'Игрок', undefined, onCommit);
  await f.service.handle({ eventId: 'profile', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок', undefined, onCommit);
  assert.equal(wakes, 1);
  assert.equal(await f.db.transaction(async store => store.notificationsQueued()), false);
});

test('rolled-back notifications never wake delivery and a broken wake observer cannot turn a committed reward into a failed command', async context => {
  const f = await fixture();
  await f.service.handle({ eventId: 'dice-create', vkId: 1, peerId: peer, isChat: true, command: parseCommand('кости 1000', undefined, true) }, async () => 'Игрок');
  const input: GameInput = { eventId: 'dice-last', vkId: 2, peerId: peer, isChat: true, command: { kind: 'dice_join', peerId: peer, gameId: 1 } };
  let wakes = 0;
  f.db.failRemember = true;
  await assert.rejects(f.service.handle(input, async () => 'Игрок', undefined, () => { wakes += 1; }), /Simulated database failure/);
  assert.equal(wakes, 0);
  assert.equal(f.db.state.notifications.length, 0);
  assert.equal(f.db.player(2).kc, 100_000);
  f.db.failRemember = false;
  const logs: string[] = [];
  const logger = mock.method(console, 'error', (value: unknown) => { logs.push(String(value)); });
  context.after(() => logger.mock.restore());
  const reply = await f.service.handle(input, async () => 'Игрок', undefined, () => { throw new Error('private-test-secret'); });
  assert.equal(reply.text, '');
  assert.equal(f.db.state.notifications.length, 1);
  assert.ok(logs.some(line => line.includes('notification_wake')));
  assert.ok(logs.every(line => !line.includes('private-test-secret')));
  assert.ok([f.db.player(1).kc, f.db.player(2).kc].every(balance => Number.isSafeInteger(balance) && balance >= 0 && balance <= game.maxAmount));
});


test('automatic bank completion wakes its notification after crediting the deposit without waiting for the delivery interval', async () => {
  const f = await fixture();
  f.db.player().kc = 0;
  const expiresAt = new Date(f.db.time);
  f.db.state.deposits.set('deposit:1:1', { _id: 'deposit:1:1', vkId: 1, depositId: 1, amount: 100_000, days: 3,
    createdAt: new Date(expiresAt.getTime() - 3 * 24 * 60 * 60 * 1000), expiresAt, nextAttemptAt: expiresAt, state: 'active' });
  let wakes = 0;
  const stop = startBankWorker(f.db, () => {
    wakes += 1;
    assert.equal(f.db.player().kc, 102_000);
    assert.ok(f.db.state.notifications.some(value => value._id === 'deposit:deposit:1:1'));
  });
  await stop();
  assert.equal(wakes, 1);
});


test('first-message referral reward also wakes delivery after registration commits and never on event replay', async () => {
  const f = await fixture();
  let wakes = 0;
  const input: GameInput = { eventId: 'referred-registration', vkId: 777, peerId: 777, referrerId: 1, command: { kind: 'profile' } };
  const wake = (): void => {
    wakes += 1;
    assert.ok(f.db.state.players.has(777));
    assert.ok(f.db.state.notifications.some(value => value._id === 'referral:777'));
  };
  await f.service.handle(input, async () => 'Новичок', undefined, wake);
  assert.equal(wakes, 1);
  assert.equal(f.db.player().kc, 100_000 + game.referralRewardKC);
  await f.service.handle(input, async () => 'Новичок', undefined, wake);
  assert.equal(wakes, 1);
});
