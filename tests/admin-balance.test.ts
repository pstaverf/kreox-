import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseAdminBalance } from '../src/handlers/admin-balance.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { texts } from '../src/services/texts.js';
import type { GameInput } from '../src/types/game.js';
import { MemoryDatabase } from './memory.js';

const adminId = 888801846;

async function fixture() {
  const database = new MemoryDatabase();
  const service = new GameService(database);
  for (const vkId of [1, 2, adminId]) {
    await service.handle({ vkId, eventId: `register-${vkId}`, command: { kind: 'profile' } }, async () => 'Игрок');
  }
  let sequence = 0;
  const send = (text: string, extra: Partial<GameInput> = {}) => service.handle({
    eventId: `balance-${sequence++}`, vkId: adminId, command: parseCommand(text, undefined), text, ...extra
  }, async () => { throw new Error('Admin commands must not resolve names'); });
  return { database, service, send };
}

test('admin parser accepts plain KC, k suffix, numeric targets and real VK user mentions', () => {
  assert.deepEqual(parseAdminBalance('!set 100'), { kind: 'admin_balance', operation: 'set', targetId: null, amount: 10_000 });
  assert.deepEqual(parseAdminBalance('!add 100k'), { kind: 'admin_balance', operation: 'add', targetId: null, amount: 10_000_000 });
  assert.deepEqual(parseAdminBalance(' !SET @id000123 100K '), { kind: 'admin_balance', operation: 'set', targetId: 123, amount: 10_000_000 });
  assert.deepEqual(parseAdminBalance('!add [id456|Имя Фамилия] 100к'), { kind: 'admin_balance', operation: 'add', targetId: 456, amount: 10_000_000 });
  assert.deepEqual(parseAdminBalance('!set 0'), { kind: 'admin_balance', operation: 'set', targetId: null, amount: 0 });
  assert.equal(parseAdminBalance('!setting 100'), null);
  assert.equal(parseAdminBalance('обычный текст'), null);
});

test('invalid amounts and targets cannot be interpreted as an administrative balance change', () => {
  for (const text of [
    '!set', '!add', '!set -1', '!add 1.5', '!set 1e6', '!set 0x10', '!set Infinity', '!add NaN',
    '!set 100m', '!set 100 k', '!set 100 extra', '!set @id0 100', '!set @club1 100', '!set [club1|Группа] 100',
    '!set @id9007199254740992 100', '!set 90071992547410', '!set 90071992548k', '!add 100k '.repeat(50)
  ]) {
    assert.deepEqual(parseAdminBalance(text), { kind: 'admin_balance_invalid' }, text);
  }
});

test('admin text takes precedence over payload and payload alone cannot create an admin command', () => {
  assert.deepEqual(parseCommand('!add @id2 100k', { command: 'profile', vkId: 999, amount: 1 }), {
    kind: 'admin_balance', operation: 'add', targetId: 2, amount: 10_000_000
  });
  assert.deepEqual(parseCommand(undefined, { command: 'admin_balance', operation: 'add', targetId: 1, amount: 100 }), { kind: 'development' });
});

test('set replaces KC and add increments it, leaving all other player data intact', async () => {
  const { send, database } = await fixture();
  database.player(1).kc = 500;
  database.player(1).euro = 123;
  database.player(1).bitcoin = 456;
  const before = structuredClone(database.player(1));
  assert.deepEqual((await send('!set @id1 100')).keyboard, { kind: 'none' });
  assert.equal(database.player(1).kc, 10_000);
  assert.equal((await send('!add @id1 100k')).text, 'Done.');
  assert.equal(database.player(1).kc, 10_010_000);
  assert.deepEqual(database.player(1), { ...before, kc: 10_010_000 });
  assert.equal((await send('!set @id1 0')).text, 'Done.');
  assert.equal(database.player(1).kc, 0);
});

test('reply selects its author, an explicit mention overrides the reply, and no target selects the admin', async () => {
  const { send, database } = await fixture();
  assert.equal((await send('!set 100', { replySenderId: 1 })).text, 'Done.');
  assert.equal(database.player(1).kc, 10_000);
  await send('!add @id2 1k', { replySenderId: 1 });
  assert.equal(database.player(2).kc, 100_000);
  assert.equal(database.player(1).kc, 10_000);
  await send('!set 100k');
  assert.equal(database.player(adminId).kc, 10_000_000);
  assert.equal((await send('!set 100', { replySenderId: -123 })).text, texts.adminBalanceTarget);
  assert.equal(database.player(adminId).kc, 10_000_000);
});

test('admin need not be registered, and unknown targets are never registered by a balance command', async () => {
  const { send, database } = await fixture();
  database.state.players.delete(adminId);
  const count = database.state.registrations;
  assert.equal((await send('!set @id1 100')).text, 'Done.');
  assert.equal(database.state.players.has(adminId), false);
  assert.equal((await send('!add @id999 100')).text, texts.adminBalanceMissing);
  assert.equal(database.state.players.has(999), false);
  assert.equal(database.state.registrations, count);
});

test('set can use the largest whole KC amount, add refuses overflow without a partial increment', async () => {
  const { send, database } = await fixture();
  assert.equal((await send('!set @id1 90071992547409')).text, 'Done.');
  assert.equal(database.player(1).kc, 9_007_199_254_740_900);
  assert.equal((await send('!add @id1 1')).text, texts.adminBalanceLimit);
  assert.equal(database.player(1).kc, 9_007_199_254_740_900);
  database.player(1).kc = game.maxAmount - 100;
  assert.equal((await send('!add @id1 1')).text, 'Done.');
  assert.equal(database.player(1).kc, game.maxAmount);
  assert.equal((await send('!add @id1 0')).text, 'Done.');
});

test('admin commands bypass the promo wizard without corrupting or cancelling its draft', async () => {
  const { send, database } = await fixture();
  database.player(adminId).promoDraft = { step: 'activate' };
  await send('!add 1k');
  assert.equal(database.player(adminId).kc, 100_000);
  assert.deepEqual(database.player(adminId).promoDraft, { step: 'activate' });
});

test('a replayed add after restart returns the same response and credits only once', async () => {
  const { send, database } = await fixture();
  const first = await send('!add @id1 100k', { eventId: 'same-add' });
  const service = new GameService(database);
  const again = await service.handle({
    eventId: 'same-add', vkId: adminId, command: parseCommand('!add @id1 100k', undefined)
  }, async () => 'Игрок');
  assert.deepEqual(again, first);
  assert.equal(database.player(1).kc, 10_000_000);
});

test('parallel delivery of one add is idempotent, while distinct adds each apply once', async () => {
  const { send, database } = await fixture();
  const replies = await Promise.all(Array.from({ length: 10 }, () => send('!add @id1 1k', { eventId: 'parallel-add' })));
  assert.ok(replies.every(reply => reply.randomId === replies[0]?.randomId));
  assert.equal(database.player(1).kc, 100_000);
  await Promise.all(Array.from({ length: 10 }, () => send('!add @id1 1k')));
  assert.equal(database.player(1).kc, 1_100_000);
});

test('a failure remembering the response rolls back the balance with the event', async () => {
  const { send, database } = await fixture();
  const before = structuredClone(database.state);
  database.failRemember = true;
  await assert.rejects(send('!add @id1 100k', { eventId: 'failed-add' }));
  assert.deepEqual(database.state, before);
  database.failRemember = false;
  assert.equal((await send('!add @id1 100k', { eventId: 'failed-add' })).text, 'Done.');
  assert.equal(database.player(1).kc, 10_000_000);
});

test('authorization is checked before cached events, and direct invalid commands fail closed', async () => {
  const { send, service, database } = await fixture();
  const first = await send('!add @id1 100k', { eventId: 'authorized-add' });
  await assert.rejects(send('!add @id1 100k', { eventId: 'authorized-add', vkId: 1 }));
  await assert.rejects(send('!set', { vkId: 1 }));
  const reply = await service.handle({
    eventId: 'bad-direct-command', vkId: adminId,
    command: { kind: 'admin_balance', operation: 'add', targetId: 1, amount: -1 }
  }, async () => 'Игрок');
  assert.equal(reply.text, texts.adminBalanceUsage);
  assert.equal(database.player(1).kc, 10_000_000);
  assert.equal(first.text, 'Done.');
});

test('wallet admin parser accepts all six commands, bare VK IDs, mentions and reply amounts with exact scaling', () => {
  for (const [suffix, currency, scale] of [['donut', 'euro', game.euroScale], ['bit', 'bitcoin', game.bitcoinScale]] as const) {
    for (const operation of ['set', 'add', 'take'] as const) {
      assert.deepEqual(parseAdminBalance(`!${operation}${suffix} 123 10`), { kind: 'admin_balance', operation, currency, targetId: 123, amount: 10 * scale });
      assert.deepEqual(parseAdminBalance(`!${operation}${suffix} @id123 10k`), { kind: 'admin_balance', operation, currency, targetId: 123, amount: 10_000 * scale });
      assert.deepEqual(parseAdminBalance(`!${operation}${suffix} [id123|Имя 123] 0`), { kind: 'admin_balance', operation, currency, targetId: 123, amount: 0 });
      assert.deepEqual(parseAdminBalance(`!${operation}${suffix} 1`), { kind: 'admin_balance', operation, currency, targetId: null, amount: scale });
    }
  }
  assert.deepEqual(parseAdminBalance('!SETDONUT id2 50,25'), { kind: 'admin_balance', operation: 'set', currency: 'euro', targetId: 2, amount: 5025 });
  assert.deepEqual(parseAdminBalance('!addbit 2 1.116'), { kind: 'admin_balance', operation: 'add', currency: 'bitcoin', targetId: 2, amount: 111_600_000 });
  for (const text of ['!setdonut 1 1.001', '!addbit 1 0.0001', '!takebit -1', '!takedonut 1 -10', '!setbit 1 NaN', '!setbit 1 1e4', '!adddonut 1 1 extra', '!takebit @id0 1', '!setbit 1 90071993', '!setdonut 1 90071992547409.92']) {
    const command = parseAdminBalance(text);
    assert.equal(command?.kind, 'admin_balance_invalid', text);
  }
  assert.equal(parseAdminBalance('!setbitcoin 1 100'), null);
});

test('wallet set/add/take alter only the selected currency and reply author is overridden by explicit VK ID', async () => {
  const { send, database } = await fixture();
  for (const [suffix, currency, scale] of [['donut', 'euro', game.euroScale], ['bit', 'bitcoin', game.bitcoinScale]] as const) {
    const before = structuredClone(database.player(1));
    assert.equal((await send(`!set${suffix} 1 10`, { replySenderId: 2, isChat: true })).text, 'Done.');
    assert.equal((await send(`!add${suffix} 1 2`)).text, 'Done.');
    assert.equal((await send(`!take${suffix} 1 3`)).text, 'Done.');
    assert.deepEqual(database.player(1), { ...before, [currency]: 9 * scale });
    assert.equal((await send(`!set${suffix} 5`, { replySenderId: 2 })).text, 'Done.');
    assert.equal(database.player(2)[currency], 5 * scale);
    assert.equal((await send(`!take${suffix} 1 9`)).text, 'Done.');
    assert.equal(database.player(1)[currency], 0);
    assert.deepEqual((await send(`!set${suffix} 1 0`)).keyboard, { kind: 'none' });
  }
});

test('wallet take refuses underflow, add refuses overflow and exact decimal boundaries remain safe integers', async () => {
  const { send, database } = await fixture();
  for (const [suffix, currency, scale] of [['donut', 'euro', game.euroScale], ['bit', 'bitcoin', game.bitcoinScale]] as const) {
    database.player(1)[currency] = scale - 1;
    assert.equal((await send(`!take${suffix} 1 1`)).text, texts.adminWalletLimit);
    assert.equal(database.player(1)[currency], scale - 1);
    database.player(1)[currency] = game.maxAmount;
    assert.equal((await send(`!add${suffix} 1 1`)).text, texts.adminWalletLimit);
    assert.equal(database.player(1)[currency], game.maxAmount);
    assert.equal((await send(`!take${suffix} 1 0`)).text, 'Done.');
  }
  assert.equal((await send('!setdonut 1 90071992547409.91')).text, 'Done.');
  assert.equal(database.player(1).euro, game.maxAmount);
  assert.equal((await send('!setbit 1 90071992.547')).text, 'Done.');
  assert.equal(database.player(1).bitcoin, 9_007_199_254_700_000);
  assert.equal((await send('!takebit 1 0,001')).text, 'Done.');
  assert.equal(database.player(1).bitcoin, 9_007_199_254_600_000);
});

test('wallet admin authorization, unknown targets and payload forgery fail without changing balances', async () => {
  const { send, database } = await fixture();
  const before = structuredClone(database.state);
  await assert.rejects(send('!adddonut 1 50', { vkId: 1 }));
  await assert.rejects(send('!takebit', { vkId: 1 }));
  assert.deepEqual(database.state, before);
  assert.equal((await send('!setdonut 999 50')).text, texts.adminBalanceMissing);
  assert.equal(database.state.players.has(999), false);
  assert.deepEqual(parseCommand(undefined, { command: 'admin_balance', currency: 'euro', operation: 'add', targetId: 1, amount: 5000 }), { kind: 'development' });
  assert.equal((await send('!takebit 1 -1')).text, texts.adminWalletUsage);
  database.state.players.delete(adminId);
  assert.equal((await send('!adddonut 1 50')).text, 'Done.');
  assert.equal(database.state.players.has(adminId), false);
});

test('wallet admin events are deduplicated after restart and concurrent takes cannot make balances negative', async () => {
  const { send, database } = await fixture();
  const first = await send('!adddonut 1 50', { eventId: 'once-donut' });
  const restart = new GameService(database);
  assert.deepEqual(await restart.handle({ eventId: 'once-donut', vkId: adminId, command: parseCommand('!adddonut 1 50', undefined) }, async () => 'Игрок'), first);
  assert.equal(database.player(1).euro, 5000);
  const takes = await Promise.all(Array.from({ length: 8 }, () => send('!takedonut 1 50')));
  assert.equal(takes.filter(reply => reply.text === 'Done.').length, 1);
  assert.equal(database.player(1).euro, 0);
  await send('!setbit 1 1.5');
  const repeated = await Promise.all(Array.from({ length: 8 }, () => send('!takebit 1 0.5', { eventId: 'once-takebit' })));
  assert.ok(repeated.every(reply => reply.randomId === repeated[0]?.randomId));
  assert.equal(database.player(1).bitcoin, game.bitcoinScale);
});

test('wallet balance writes roll back with a failed event and leave ongoing donate wizard intact', async () => {
  const { send, database } = await fixture();
  database.player(adminId).donateDraft = { step: 'nickname' };
  await send('!setdonut 1 100');
  assert.deepEqual(database.player(adminId).donateDraft, { step: 'nickname' });
  const before = structuredClone(database.state);
  database.failRemember = true;
  await assert.rejects(send('!takedonut 1 50'));
  assert.deepEqual(database.state, before);
});
