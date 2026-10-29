import { maxWholeKc, roundKcRatio } from '../src/services/kc-money.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bankConfig } from '../src/config/bank.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { bankDays, depositButtons, depositValue, earlyDepositValue, parseBankMoney, settleSavings, transferNet } from '../src/services/bank-rules.js';
import { bankTexts, depositDate, depositEndText, depositText } from '../src/services/bank-texts.js';
import { finishDeposit, settleBankDeposits } from '../src/services/bank-deposits.js';
import type { BankCommand, DepositDays } from '../src/types/bank.js';
import type { Command, GameInput, KeyboardSpec } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture(roll: (maximum: number) => number = () => 0) {
  const db = new MemoryDatabase();
  let service = new GameService(db, undefined, async name => {
    assert.equal(name, 'kreox_owner');
    await db.transaction(async () => {});
    return 2;
  }, undefined, undefined, roll);
  let sequence = 0;
  const send = (command: Command, id = 1, extra: Partial<GameInput> = {}) => service.handle({ eventId: `bank-${sequence++}`, vkId: id, command, ...extra }, async () => `Игрок ${id}`);
  const text = (value: string, id = 1, extra: Partial<GameInput> = {}) => send(parseCommand(value, undefined, extra.isChat ?? false), id, { text: value, ...extra });
  for (const id of [1, 2, 3]) await send({ kind: 'profile' }, id);
  const create = async (amount = '100', days: DepositDays = 3, id = 1) => {
    await send({ kind: 'bank_deposit_create' }, id);
    const term = await text(amount, id);
    assert.ok(term.keyboard.kind === 'bank_deposit_term', term.text);
    const result = await send({ kind: 'bank_deposit_term', days, token: term.keyboard.token }, id);
    assert.equal(result.text, bankTexts.deposits);
    const record = [...db.state.deposits.values()].filter(deposit => deposit.vkId === id).at(-1);
    assert.ok(record);
    return record;
  };
  return { db, send, text, create, restart: () => { service = new GameService(db, undefined, undefined, undefined, undefined, roll); } };
}

test('bank keyboards carry bounded payloads, correct rows and inline deposit controls', () => {
  const specs: KeyboardSpec[] = [{ kind: 'city' }, { kind: 'bank' }, { kind: 'bank_savings' }, { kind: 'bank_transfer_menu' },
    { kind: 'bank_back', destination: 'bank_savings' }, { kind: 'bank_deposits', depositIds: [1, 2, 3, 4, 5] },
    { kind: 'bank_deposit_amount', amounts: depositButtons(1_762_790_200) }, { kind: 'bank_deposit_term', token: 'test' },
    { kind: 'bank_deposit_early', depositId: 1 }, { kind: 'bank_deposit_confirm', token: 'test' }];
  for (const spec of specs) {
    const value: unknown = JSON.parse(buildKeyboard(spec).toString());
    assert.ok(isRecord(value));
    assert.ok(Array.isArray(value.buttons));
    assert.ok(value.buttons.length <= 10);
    assert.equal(Boolean(value.inline), spec.kind === 'bank_deposit_early' || spec.kind === 'bank_deposit_confirm');
    for (const row of value.buttons) {
      assert.ok(Array.isArray(row)); assert.ok(row.length <= 4);
      for (const button of row) {
        assert.ok(isRecord(button)); assert.ok(isRecord(button.action));
        assert.equal(button.action.type, 'text');
        assert.equal(typeof button.action.payload, 'string');
        if (typeof button.action.payload !== 'string') throw new Error('Missing payload');
        assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        assert.notEqual(parseCommand(undefined, button.action.payload).kind, 'development');
      }
    }
  }
  assert.deepEqual(depositButtons(1_762_790_200), [88_139_500, 176_279_000, 352_558_000, 881_395_100, 1_762_790_200]);
  for (const label of ['🏦 Банк', '👵 Пенсия', '💲 Накопительный счет', '➕ Создать депозит', '3 дня', 'Подтвердить']) assert.equal(parseCommand(label, undefined).kind, 'development');
});

test('bank money parsing, net fee and weekly compounding use integer arithmetic at boundaries', () => {
  assert.equal(parseBankMoney('1кк', 'kc'), 100_000_000);
  assert.equal(parseBankMoney('10.000.000', 'kc'), bankConfig.maxDeposit);
  assert.equal(parseBankMoney('1,116', 'bitcoin'), 111_600_000);
  assert.equal(parseBankMoney('50.25', 'euro'), 5025);
  for (const value of ['-1', '0', 'NaN', '1e6', '0x10', '99999999999999999']) assert.equal(parseBankMoney(value, 'kc'), null);
  assert.equal(transferNet(10_000), 9500);
  assert.equal(transferNet(game.maxAmount), maxWholeKc - roundKcRatio(BigInt(game.maxAmount) * 5n, 100n));
  const since = new Date('2026-10-25T00:00:00Z');
  assert.equal(settleSavings(10_000_000, since, new Date(since.getTime() + bankConfig.weekMs - 1)).balance, 10_000_000);
  assert.equal(settleSavings(10_000_000, since, new Date(since.getTime() + bankConfig.weekMs)).balance, 10_200_000);
  assert.equal(settleSavings(10_000_000, since, new Date(since.getTime() + 2 * bankConfig.weekMs)).balance, 10_404_000);
  assert.equal(settleSavings(1, since, new Date('9999-01-01')).balance, 0);
  assert.equal(settleSavings(game.maxAmount, since, new Date('9999-01-01')).balance, maxWholeKc);
});

test('city, bank and casino lobby navigation do not change balances', async () => {
  const { send, db } = await fixture();
  assert.deepEqual((await send({ kind: 'city' })).keyboard, { kind: 'city' });
  assert.equal((await send({ kind: 'city' })).text, '🏙️ Город:');
  assert.equal((await send({ kind: 'bank' })).text, '🏛️ Банк:');
  assert.match((await send({ kind: 'casino' })).text, /казино:\n\n🤑 Крупье:/);
  assert.equal(db.player().kc, 0);
});

test('savings deposit/withdraw conserve KC, accrue whole weeks, reset time on movement and survive restart', async () => {
  const { db, send, text, restart } = await fixture();
  db.player().kc = 20_000_000;
  assert.equal((await send({ kind: 'bank_savings' })).text, '💲 Накопительный счет:\n\n💰 У вас: 0 KC');
  assert.equal((await send({ kind: 'bank_deposit_money' })).text, '💰 Введите количество денег, которое вы хотите положить (у вас: 200.000 KC).');
  const deposited = await text('100к', 1, { eventId: 'save-once' });
  assert.equal(deposited.text, '💱 Транзакция совершена.\n\n💰 На руках: 100.000 KC\n💳 На счету: 100.000 KC');
  await text('100к', 1, { eventId: 'save-once' });
  assert.equal(db.player().kc, 10_000_000);
  assert.equal(db.player().savingsBalance, 10_000_000);
  db.time = new Date(db.time.getTime() + bankConfig.weekMs);
  restart();
  assert.equal((await send({ kind: 'bank_savings' })).text, '💲 Накопительный счет:\n\n💰 У вас: 102.000 KC');
  await send({ kind: 'bank_withdraw_money' });
  assert.equal((await text('2к')).text, '💱 Транзакция совершена.\n\n💰 На руках: 102.000 KC\n💳 На счету: 100.000 KC');
  assert.equal(db.player().savingsSince?.getTime(), db.time.getTime());
  await send({ kind: 'bank_withdraw_money' });
  assert.equal((await text('101к')).text, bankTexts.funds);
  assert.equal(db.player().savingsBalance, 10_000_000);
});

test('failed savings movement and event recording roll back funds, interest and draft', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 10_000;
  await send({ kind: 'bank_deposit_money' });
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(text('100'));
  assert.deepEqual(db.state, before);
  db.failRemember = false;
  await send({ kind: 'bank' });
  assert.equal(db.player().bankDraft, undefined);
});

for (const [currency, alias, scale] of [['kc', 'монеты', game.kcScale], ['euro', 'евро', game.euroScale], ['bitcoin', 'бит', game.bitcoinScale]] as const) {
  test(`${currency} transfer deducts gross, credits 95%, notifies once and leaves other currencies intact`, async () => {
    const { db, send, text } = await fixture();
    db.player()[currency] = 100 * scale;
    const other = structuredClone(db.player());
    const first = await text(`${alias} 100`, 1, { replySenderId: 2, isChat: true, eventId: `transfer-${currency}` });
    assert.ok(first.text.startsWith('Вы успешно передали 95'));
    assert.ok(first.text.endsWith('игроку [id2|Игрок 2].'));
    assert.deepEqual(first.keyboard, { kind: 'none' });
    assert.equal(db.player()[currency], 0);
    assert.equal(db.player(2)[currency], 95 * scale);
    assert.equal(db.state.notifications.length, 1);
    assert.match(db.state.notifications[0]?.text ?? '', /передал вам 95/);
    await text(`${alias} 100`, 1, { replySenderId: 2, isChat: true, eventId: `transfer-${currency}` });
    assert.equal(db.player(2)[currency], 95 * scale);
    for (const key of ['kc', 'euro', 'bitcoin'] as const) if (key !== currency) assert.equal(db.player()[key], other[key]);
    const prompt = await send({ kind: 'bank_currency', currency });
    assert.equal(prompt.text, bankTexts.target);
    await text('@id2');
    db.player()[currency] = 100 * scale;
    assert.ok((await text('100')).text.startsWith('✅ Вы успешно передали 95'));
  });
}

test('transfer targeting supports bot IDs, explicit VK IDs, screen resolution and reply precedence', async () => {
  const { db, text } = await fixture();
  db.player().kc = 100_000;
  assert.equal(parseCommand('монеты @id2 100', undefined).kind, 'bank_transfer');
  await text('монеты @id2 100', 1, { isChat: true, replySenderId: 3 });
  assert.equal(db.player(2).kc, 9500);
  await text('монеты 1 100', 1, { isChat: true });
  assert.equal(db.player(2).kc, 19_000);
  await text('монеты @kreox_owner 100', 1, { isChat: true });
  assert.equal(db.player(2).kc, 28_500);
  assert.equal((await text('монеты @id1 100', 1, { isChat: true })).text, bankTexts.self);
  assert.equal((await text('монеты 100', 1, { isChat: true })).text, bankTexts.usage);
  assert.equal((await text('монеты @id999 100', 1, { isChat: true })).text, bankTexts.missing);
});

test('parallel transfers cannot overspend, overflow rejects without debit and event failures roll back both wallets', async () => {
  const { db, text } = await fixture();
  db.player().kc = 10_000;
  const results = await Promise.all(Array.from({ length: 8 }, () => text('монеты @id2 100', 1, { isChat: true })));
  assert.equal(results.filter(reply => reply.text.startsWith('Вы успешно')).length, 1);
  assert.equal(db.player().kc, 0);
  assert.equal(db.player(2).kc, 9500);
  db.player().kc = 10_000;
  db.player(2).kc = game.maxAmount;
  assert.equal((await text('монеты @id2 100', 1, { isChat: true })).text, bankTexts.limit);
  assert.equal(db.player().kc, 10_000);
  db.player(2).kc = 0;
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(text('монеты @id2 100', 1, { isChat: true }));
  assert.deepEqual(db.state, before);
});

test('pension ages, rolling 24h cooldown and tier changes are calculated from persisted registration', async () => {
  const { db, send, restart } = await fixture(maximum => maximum - 1);
  assert.equal((await send({ kind: 'bank_pension' })).text, bankTexts.young);
  db.time = new Date(db.time.getTime() + 30 * bankConfig.dayMs);
  const rewards = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'bank_pension' })));
  assert.equal(rewards.filter(reply => reply.text === '✅ Ваша пенсия составила 5.000 KC').length, 1);
  assert.equal(db.player().kc, 500_000);
  assert.equal((await send({ kind: 'bank_pension' })).text, '⏳ Подождите 24 ч. 0 мин. 0 сек. до следующей пенсии.');
  restart();
  db.time = new Date(db.time.getTime() + bankConfig.dayMs - 1);
  assert.match((await send({ kind: 'bank_pension' })).text, /0 ч\. 0 мин\. 1 сек\./);
  db.time = new Date(db.time.getTime() + 1);
  assert.equal((await send({ kind: 'bank_pension' })).text, '✅ Ваша пенсия составила 5.000 KC');
  const registered = db.player().registeredAt;
  assert.ok(registered);
  db.time = new Date(registered.getTime() + 61 * bankConfig.dayMs);
  assert.equal((await send({ kind: 'bank_pension' })).text, '✅ Ваша пенсия составила 25.000 KC');
  assert.equal(bankDays(registered, db.time), 61);
});

test('profile adds registration only in DMs and keeps compact lines', async () => {
  const { db, send } = await fixture();
  db.time = new Date(db.time.getTime() + 32 * bankConfig.dayMs);
  const profile = await send({ kind: 'profile' });
  assert.match(profile.text, /🤖 В боте 32 дней\. \| 23\.10\.26 03:00\n🆔0$/);
  assert.equal(profile.text.includes('\n\n'), false);
  assert.equal(profile.text.split('\n').length, 8);
  assert.equal((await send({ kind: 'profile' }, 1, { isChat: true })).text.split('\n').length, 7);
});

test('deposits validate max, available KC and five active slots with persistent personal IDs', async () => {
  const { db, send, text, create } = await fixture();
  db.player().kc = 2_000_000_000;
  await send({ kind: 'bank_deposit_create' });
  assert.equal((await text('10кк')).text, bankTexts.depositTerm);
  await send({ kind: 'bank_deposit_create' });
  assert.equal((await text('10кк1')).text, bankTexts.invalid);
  assert.equal((await text('10000001')).text, bankTexts.depositMax);
  db.player().kc = 100_000;
  assert.equal((await text('1001')).text, bankTexts.funds);
  for (let i = 0; i < 5; i += 1) await create();
  assert.equal((await send({ kind: 'bank_deposit_create' })).text, bankTexts.depositLimit);
  assert.equal(db.state.deposits.size, 5);
  assert.deepEqual([...db.state.deposits.values()].map(deposit => deposit.depositId), [1, 2, 3, 4, 5]);
  assert.deepEqual((await send({ kind: 'bank_deposits' })).keyboard, { kind: 'bank_deposits', depositIds: [1, 2, 3, 4, 5] });
});

test('deposit income grows linearly and exact maturity pays once automatically with the specified notification', async () => {
  const { db, create, restart } = await fixture();
  db.time = new Date('2026-10-24T21:02:09Z');
  db.player().kc = 10_000;
  const deposit = await create();
  assert.equal(db.player().kc, 0);
  assert.equal(depositDate(deposit.createdAt), '25 октября 2026 00:02:09');
  assert.equal(depositValue(deposit, new Date(deposit.createdAt.getTime() + 1.5 * bankConfig.dayMs)), 10_100);
  db.time = new Date(deposit.expiresAt.getTime() - 1);
  assert.equal(await settleBankDeposits(db), 0);
  restart();
  db.time = new Date(deposit.expiresAt);
  const results = await Promise.all(Array.from({ length: 8 }, () => settleBankDeposits(db)));
  assert.equal(results.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(db.player().kc, 10_200);
  assert.equal(db.state.notifications.length, 1);
  assert.equal(db.state.notifications[0]?.text, '🏧 Ваш депозит ID: 1 был окончен.\n\nБаланс до: 100 KC\nБаланс после: 102 KC\nПроцент: 2%\n💰 Вы заработали 2 KC');
  assert.equal(depositEndText(deposit, 10_200), db.state.notifications[0]?.text);
  assert.equal(await settleBankDeposits(db), 0);
});

test('early withdrawal confirmation pays 90% of current value once, frees a slot and blocks foreign owners', async () => {
  const { db, create, send } = await fixture();
  db.player().kc = 10_000;
  const deposit = await create();
  db.time = new Date(deposit.createdAt.getTime() + 1.5 * bankConfig.dayMs);
  assert.equal(earlyDepositValue(deposit, db.time), 9100);
  assert.equal((await send({ kind: 'bank_deposit', depositId: 1 }, 2)).text, bankTexts.unavailable);
  const quote = await send({ kind: 'bank_deposit_early', depositId: 1 });
  assert.match(quote.text, /91 KC/);
  assert.ok(quote.keyboard.kind === 'bank_deposit_confirm');
  const token = quote.keyboard.token;
  const command: BankCommand = { kind: 'bank_deposit_confirm', token };
  const replies = await Promise.all(Array.from({ length: 8 }, () => send(command)));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅ Вы сняли депозит')).length, 1);
  assert.equal(db.player().kc, 9100);
  assert.equal((await send({ kind: 'bank_deposits' })).text, bankTexts.deposits);
  db.time = new Date(deposit.expiresAt);
  assert.equal(await settleBankDeposits(db), 0);
  assert.equal(db.player().kc, 9100);
});

test('confirmation at the expiry boundary pays full yield without early penalty', async () => {
  const { db, create, send } = await fixture();
  db.player().kc = 10_000;
  const deposit = await create();
  const quote = await send({ kind: 'bank_deposit_early', depositId: 1 });
  assert.ok(quote.keyboard.kind === 'bank_deposit_confirm');
  db.time = new Date(deposit.expiresAt);
  assert.equal((await send({ kind: 'bank_deposit_confirm', token: quote.keyboard.token })).text, bankTexts.ended);
  assert.equal(db.player().kc, 10_200);
  assert.equal(db.state.notifications.length, 1);
});

test('mature deposit with a full wallet is retained and retried without blocking other payouts', async () => {
  const { db, create } = await fixture();
  db.player().kc = 10_000;
  db.player(2).kc = 10_000;
  const first = await create();
  await create('100', 3, 2);
  db.player().kc = game.maxAmount;
  db.time = new Date(first.expiresAt);
  assert.equal(await settleBankDeposits(db), 1);
  assert.equal(db.player().kc, game.maxAmount);
  assert.equal(db.player(2).kc, 10_200);
  assert.equal(db.state.deposits.get(first._id)?.state, 'active');
  db.player().kc = 0;
  db.time = new Date(db.time.getTime() + bankConfig.retryMs);
  assert.equal(await settleBankDeposits(db), 1);
  assert.equal(db.player().kc, 10_200);
});

test('deposit creation and payout roll back completely on failures, including notification writes', async () => {
  const { db, send, text, create } = await fixture();
  db.player().kc = 10_000;
  await send({ kind: 'bank_deposit_create' });
  const term = await text('100');
  assert.ok(term.keyboard.kind === 'bank_deposit_term');
  const token = term.keyboard.token;
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(send({ kind: 'bank_deposit_term', token, days: 10 }));
  assert.deepEqual(db.state, before);
  db.failRemember = false;
  const deposit = await create('100', 10);
  db.time = new Date(deposit.expiresAt);
  const matureBefore = structuredClone(db.state);
  await assert.rejects(db.transaction(async store => {
    const current = await store.deposit(1, deposit.depositId);
    assert.ok(current);
    assert.equal(await finishDeposit(store, current, await store.now()), true);
    throw new Error('Rollback after deposit notification');
  }));
  assert.deepEqual(db.state, matureBefore);
  assert.equal(await settleBankDeposits(db), 1);
  assert.equal(db.player().kc, 10_400);
});

test('savings income rounds to whole KC and frequent views do not restart interest', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 100;
  await send({ kind: 'bank_deposit_money' });
  await text('1');
  const start = db.player().savingsSince;
  assert.ok(start);
  db.time = new Date(start.getTime() + bankConfig.weekMs - 1);
  await send({ kind: 'bank_savings' });
  assert.equal(db.player().savingsSince?.getTime(), start.getTime());
  db.time = new Date(start.getTime() + bankConfig.weekMs);
  await send({ kind: 'bank_withdraw_money' });
  assert.equal(db.player().savingsBalance, 100);
  await text('1,02');
  assert.equal(db.player().kc, 100);
  assert.equal(db.player().savingsBalance, 0);
});

test('pension overflow and failed event recording never consume a daily claim', async () => {
  const { db, send } = await fixture();
  db.time = new Date(db.time.getTime() + 30 * bankConfig.dayMs);
  db.player().kc = game.maxAmount;
  assert.equal((await send({ kind: 'bank_pension' })).text, bankTexts.limit);
  assert.equal(db.player().nextPensionAt, undefined);
  db.player().kc = 0;
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(send({ kind: 'bank_pension' }));
  assert.deepEqual(db.state, before);
});

test('deposit term tokens and pending early confirmations cannot be forged, reused or used by another owner', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 20_000;
  await send({ kind: 'bank_deposit_create' });
  const term = await text('100');
  assert.ok(term.keyboard.kind === 'bank_deposit_term');
  const token = term.keyboard.token;
  assert.equal((await send({ kind: 'bank_deposit_term', token, days: 3 }, 2)).text, bankTexts.stale);
  assert.equal((await send({ kind: 'bank_deposit_term', token: 'forged', days: 3 })).text, bankTexts.stale);
  const replies = await Promise.all(Array.from({ length: 8 }, () => send({ kind: 'bank_deposit_term', token, days: 3 })));
  assert.equal(replies.filter(reply => reply.text === bankTexts.deposits).length, 1);
  assert.equal(db.player().kc, 10_000);
  assert.equal(db.state.deposits.size, 1);
  const quote = await send({ kind: 'bank_deposit_early', depositId: 1 });
  assert.ok(quote.keyboard.kind === 'bank_deposit_confirm');
  assert.equal((await send({ kind: 'bank_deposit_confirm', token: quote.keyboard.token }, 2)).text, bankTexts.stale);
  const before = structuredClone(db.state);
  db.failRemember = true;
  await assert.rejects(send({ kind: 'bank_deposit_confirm', token: quote.keyboard.token }));
  assert.deepEqual(db.state, before);
  assert.equal(db.state.deposits.get('1:1')?.state, 'active');
});

test('chat transfers preserve an active DM wizard and UI money fields cannot be supplied by payload', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 10_000;
  await send({ kind: 'bank_deposit_create' });
  await text('монеты @id2 100', 1, { isChat: true });
  assert.deepEqual(db.player().bankDraft, { step: 'deposit_amount' });
  for (const payload of [
    { command: 'bank_transfer', amount: 1000000, targetId: 2 },
    { command: 'bank_deposit_confirm', token: '' }, { command: 'bank_deposit_term', days: 999, token: 'x' },
    { command: 'bank_deposit_amount', amount: -1 }, { command: 'bank_currency', currency: 'name' }
  ]) assert.equal(parseCommand(undefined, payload).kind, 'development');
});


test('savings money movements cannot earn interest for time before a top-up or reopen an old empty-account week', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 1_000_000;
  db.player().savingsBalance = 0;
  db.player().savingsSince = new Date(db.time.getTime() - 20 * bankConfig.weekMs);
  await send({ kind: 'bank_deposit_money' });
  await text('1000');
  const firstDeposit = new Date(db.time);
  assert.equal(db.player().savingsSince?.getTime(), firstDeposit.getTime());
  db.time = new Date(firstDeposit.getTime() + bankConfig.weekMs - 1);
  await send({ kind: 'bank_savings' });
  assert.equal(db.player().savingsBalance, 100_000);
  await send({ kind: 'bank_deposit_money' });
  await text('1000');
  const topUp = new Date(db.time);
  assert.equal(db.player().savingsSince?.getTime(), topUp.getTime());
  db.time = new Date(firstDeposit.getTime() + bankConfig.weekMs);
  await send({ kind: 'bank_savings' });
  assert.equal(db.player().savingsBalance, 200_000);
  db.time = new Date(topUp.getTime() + bankConfig.weekMs);
  await send({ kind: 'bank_savings' });
  assert.equal(db.player().savingsBalance, 204_000);
});

test('deposit cards use correct Russian day forms for both supported terms', async () => {
  const f = await fixture();
  f.db.player().kc = 100_000;
  for (const days of [3, 10] as const) {
    const deposit = await f.create('100', days);
    assert.ok(depositText(deposit, f.db.time).includes(days === 3 ? 'за 3 дня)' : 'за 10 дней)'));
  }
});
