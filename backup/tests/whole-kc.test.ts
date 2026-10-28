import { settleDice } from '../src/services/dice.js';
import type { BalanceCurrency } from '../src/types/admin-balance.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bankConfig } from '../src/config/bank.js';
import { game } from '../src/config/game.js';
import { playerKcFields, playerKcFilter } from '../src/repositories/mongo-kc-migration.js';
import { bankMoney } from '../src/services/bank-texts.js';
import { depositValue, earlyDepositValue, parseBankMoney, settleSavings, transferNet } from '../src/services/bank-rules.js';
import { betPayout, casinoPercent, resolveCasinoStake } from '../src/services/casino-rules.js';
import { addCasinoCredit, payCasinoCredit } from '../src/services/casino-credits.js';
import { coinPayout } from '../src/services/coin-rules.js';
import { diceDistribution } from '../src/services/dice-rules.js';
import { diceMoney } from '../src/services/dice-texts.js';
import { giveawayAmount } from '../src/services/giveaway-texts.js';
import { isWholeKc, maxWholeKc, roundKc, roundKcRatio } from '../src/services/kc-money.js';
import { formatKc, formatMining, wholeKcNotice } from '../src/services/texts.js';
import { promoRewardText } from '../src/services/promo-texts.js';
import { GameService } from '../src/services/game.js';
import type { Deposit } from '../src/types/bank.js';
import { MemoryDatabase } from './memory.js';

test('KC rounds half up without floating-point arithmetic and never emits a fractional coin', () => {
  for (const [input, expected] of [[53_770, 53_800], [54_740, 54_700], [53_750, 53_800], [53_749, 53_700], [49, 0], [50, 100], [99, 100], [180_394_712, 180_394_700], [game.maxAmount, maxWholeKc]]) {
    assert.ok(input !== undefined && expected !== undefined);
    assert.equal(roundKc(input), expected);
    assert.equal(roundKc(roundKc(input)), expected);
    assert.ok(isWholeKc(expected));
    assert.equal(formatKc(input).includes(','), false);
  }
  assert.equal(roundKcRatio(1075n * 100n, 2n), 53_800);
  assert.equal(roundKcRatio(107499n, 2n), 53_700);
  assert.equal(formatKc(180_394_712), '1.803.947');
  for (const invalid of [-1, 1.5, Infinity, NaN, game.maxAmount + 1]) assert.throws(() => roundKc(invalid));
});

test('KC input and percentage calculations round monetary values, but EUR and BTC retain their precision', () => {
  assert.equal(parseBankMoney('537,7', 'kc'), 53_800);
  assert.equal(parseBankMoney('547,4', 'kc'), 54_700);
  assert.equal(parseBankMoney('537,5', 'kc'), 53_800);
  assert.equal(parseBankMoney('0,49', 'kc'), null);
  assert.equal(parseBankMoney('0,5', 'kc'), 100);
  assert.equal(parseBankMoney('537,7', 'euro'), 53_770);
  assert.equal(parseBankMoney('537,7', 'bitcoin'), 53_770_000_000);
  assert.equal(casinoPercent(5_377_000, 1), 53_800);
  assert.equal(casinoPercent(5_474_000, 1), 54_700);
  assert.equal(casinoPercent(5_375_000, 1), 53_800);
  assert.equal(transferNet(56_700, 'kc'), 53_900);
  assert.equal(transferNet(1000, 'kc'), 900);
  assert.equal(transferNet(56_700, 'euro'), 53_865);
  assert.equal(transferNet(56_700, 'bitcoin'), 53_865);
  assert.equal(resolveCasinoStake('half', 300), 200);
  assert.equal(resolveCasinoStake('half', 301, 'euro'), 150);
  assert.equal(resolveCasinoStake('half', 301, 'bitcoin'), 150);
});

test('savings and both deposit exits pay whole KC; rounded interest does not accumulate hidden cents', () => {
  const since = new Date('2026-10-20T00:00:00Z');
  const afterWeek = new Date(since.getTime() + bankConfig.weekMs);
  assert.equal(settleSavings(2500, since, afterWeek).balance, 2600);
  assert.equal(settleSavings(100, since, new Date(since.getTime() + 30 * bankConfig.weekMs)).balance, 100);
  const expiresAt = new Date(since.getTime() + 3 * bankConfig.dayMs);
  const deposit: Deposit = { _id: '1:1', vkId: 1, depositId: 1, amount: 2500, days: 3, createdAt: since, expiresAt, nextAttemptAt: expiresAt, state: 'active' };
  assert.equal(depositValue(deposit, expiresAt), 2600);
  assert.equal(depositValue(deposit, new Date(since.getTime() + bankConfig.dayMs)), 2500);
  assert.ok(isWholeKc(earlyDepositValue(deposit, new Date(since.getTime() + bankConfig.dayMs))));
});

test('casino payouts and coin multipliers round the actual payout before it is written', () => {
  assert.equal(betPayout('crash', 100_100, 150, 1), 150_200);
  assert.equal(coinPayout(100_100, 1), 180_200);
  assert.equal(betPayout('roulette', 100_100, 16, 1), 3_603_600);
  assert.equal(betPayout('crash', maxWholeKc, 500_000, 1), null);
  assert.equal(coinPayout(maxWholeKc, 7), null);
});

test('dice conserve the complete KC pot after rounding tied shares, without negative commission or EUR/BTC changes', () => {
  for (const amount of [100_000, 100_100, 123_400, 999_900]) {
    for (const players of [2, 3, 4, 5]) for (let winners = 1; winners <= players; winners += 1) {
      const value = diceDistribution(amount, players, winners, 'kc');
      assert.ok(isWholeKc(value.each));
      assert.ok(isWholeKc(value.commission));
      assert.equal(value.each * winners + value.commission, amount * players);
    }
  }
  assert.deepEqual(diceDistribution(2800, 2, 2, 'euro'), { each: 2703, commission: 194 });
  assert.deepEqual(diceDistribution(2800, 2, 2, 'bitcoin'), { each: 2703, commission: 194 });
});

test('legacy wallet normalization is idempotent and touches only existing KC fields', () => {
  const legacy = { kc: 180_394_712, savingsBalance: 53_750, stolenKC: 54_740 };
  const normalized = playerKcFields(legacy);
  assert.deepEqual(normalized, { kc: 180_394_700, savingsBalance: 53_800, stolenKC: 54_700 });
  assert.deepEqual(playerKcFields(normalized), normalized);
  assert.deepEqual(playerKcFields({ kc: 50 }), { kc: 100 });
  assert.deepEqual(playerKcFields({ kc: game.maxAmount }), { kc: maxWholeKc });
});

test('every KC formatter prints a whole coin while euro and satoshi formatting remain unchanged', () => {
  assert.equal(bankMoney(53_750, 'kc'), '538 KC');
  assert.equal(diceMoney(53_750, 'kc'), '538 KC');
  assert.equal(giveawayAmount({ kind: 'currency', currency: 'kc', amount: 53_750 }), '538');
  assert.equal(promoRewardText('kc', 53_750), '💰 538 KC');
  assert.equal(bankMoney(53_750, 'euro'), '537,5💶');
  assert.equal(diceMoney(53_750, 'euro'), '537,5 💶');
  assert.equal(formatMining(111_600_000), '1,116');
});

test('rounded credits and events commit together; rollback and retries cannot round or pay twice', async () => {
  const db = new MemoryDatabase();
  const service = new GameService(db);
  await service.handle({ eventId: 'register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  await db.transaction(store => addCasinoCredit(store, 'rounded', 1, 53_750));
  const before = structuredClone(db.state);
  await assert.rejects(db.transaction(async store => { await payCasinoCredit(store, db.time); throw new Error('Rollback'); }), /Rollback/);
  assert.deepEqual(db.state, before);
  await db.transaction(store => payCasinoCredit(store, db.time));
  assert.equal(db.player().kc, 53_800);
  assert.equal(await db.transaction(store => payCasinoCredit(store, db.time)), false);
  assert.equal(db.player().kc, 53_800);
  await db.transaction(async store => {
    assert.equal(await store.updateBalance(1, 'euro', 'add', 53_750), true);
    assert.equal(await store.updateBalance(1, 'bitcoin', 'add', 53_750), true);
    assert.equal(await store.updateBalance(1, 'kc', 'add', 54_740), true);
  });
  assert.equal(db.player().kc, 108_500);
  assert.equal(db.player().euro, 53_750);
  assert.equal(db.player().bitcoin, 53_750);
});


test('legacy payout notices round only their known KC amount and preserve euro/BTC text', () => {
  assert.equal(wholeKcNotice('💰 Возвращено: 537,5 KC. Евро: 2,5💶', 53_750), '💰 Возвращено: 538 KC. Евро: 2,5💶');
  assert.equal(wholeKcNotice('💰 Возвращено: 1.803.947.12 KC', 180_394_712), '💰 Возвращено: 1.803.947 KC');
  assert.equal(wholeKcNotice('1.999,5 KC / 999,5 KC', 99_950), '1.999,5 KC / 1.000 KC');
});


test('migration CAS matches the old amounts and the absence of optional fields, not just an account ID', () => {
  assert.deepEqual(playerKcFilter({ _id: 1, kc: 53_750 }), { _id: 1, kc: 53_750, savingsBalance: { $exists: false }, stolenKC: { $exists: false } });
  assert.deepEqual(playerKcFilter({ _id: 1, kc: 53_750, savingsBalance: 0, stolenKC: 54_740 }), { _id: 1, kc: 53_750, savingsBalance: 0, stolenKC: 54_740 });
});

test('old fractional pending credits are normalized once, including zero credits with no account', async () => {
  const db = new MemoryDatabase();
  const service = new GameService(db);
  await service.handle({ eventId: 'legacy-register', vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
  await db.transaction(store => store.casinoInsert({ _id: 'credit:legacy', kind: 'credit', version: 0, vkId: 1, amount: 53_750, destination: 'wallet', notice: 'Возвращено: 537.5 KC', stage: 'pending', dueAt: new Date(0) }));
  await db.transaction(store => payCasinoCredit(store, db.time));
  assert.equal(db.player().kc, 53_800);
  const notice = db.state.notifications.find(value => value._id === 'notice:credit:legacy');
  assert.equal(notice?.text, 'Возвращено: 538 KC');
  assert.equal(await db.transaction(store => payCasinoCredit(store, db.time)), false);
  await db.transaction(store => store.casinoInsert({ _id: 'credit:zero', kind: 'credit', version: 0, vkId: 99, amount: 49, destination: 'wallet', notice: '', stage: 'pending', dueAt: new Date(0) }));
  await db.transaction(store => payCasinoCredit(store, db.time));
  const zero = db.state.casino.get('credit:zero');
  assert.ok(zero?.kind === 'credit');
  assert.equal(zero.stage, 'paid');
  assert.equal(zero.amount, 0);
  assert.equal(db.state.players.has(99), false);
});


test('early KC penalty rounds half up before subtraction', () => {
  const createdAt = new Date('2026-10-20T00:00:00Z');
  const expiresAt = new Date(createdAt.getTime() + 3 * bankConfig.dayMs);
  const deposit: Deposit = { _id: '1:2', vkId: 1, depositId: 2, amount: 10_500, days: 3, createdAt, expiresAt, nextAttemptAt: expiresAt, state: 'active' };
  assert.equal(earlyDepositValue(deposit, createdAt), 9400);
});

test('legacy dice credits round KC once and keep exact EUR/BTC payouts', async () => {
  const currencies: BalanceCurrency[] = ['kc', 'euro', 'bitcoin'];
  for (const currency of currencies) {
    const db = new MemoryDatabase();
    const service = new GameService(db);
    await service.handle({ eventId: `register-${currency}`, vkId: 1, command: { kind: 'profile' } }, async () => 'Игрок');
    await db.transaction(store => store.casinoInsert({ _id: `dice-credit:old-${currency}`, kind: 'dice_credit', version: 0, vkId: 1, currency, amount: 53_750, notice: '', stage: 'pending', dueAt: new Date(0) }));
    assert.equal(await settleDice(db), 1);
    assert.equal(db.player()[currency], currency === 'kc' ? 53_800 : 53_750);
    assert.equal(await settleDice(db), 0);
  }
});


test('KC text is strictly whole coins for the reported balance, sub-coin values and safe limits', () => {
  for (const value of [0, 12, 49, 50, 99, 100, 12_657_990_412, 12_657_990_450, game.maxAmount]) {
    const text = formatKc(value);
    assert.match(text, /^\d{1,3}(?:\.\d{3})*$/u);
    assert.equal(BigInt(text.replaceAll('.', '')) * BigInt(game.kcScale), BigInt(roundKc(value)));
  }
  assert.equal(formatKc(12_657_990_412), '126.579.904');
  assert.equal(formatKc(12_657_990_450), '126.579.905');
});
