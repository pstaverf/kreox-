import { maxWholeKc } from '../src/services/kc-money.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateCasinoConfig } from '../src/config/private-casino.js';
import { game } from '../src/config/game.js';
import { startJackpotWorker } from '../src/handlers/jackpot-worker.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { coinKey, coinMultiplier, coinPayout } from '../src/services/coin-rules.js';
import { nextJackpot, settleJackpot } from '../src/services/jackpot.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { privateCasinoTexts } from '../src/services/private-casino-texts.js';
import { casinoTexts } from '../src/services/casino-texts.js';
import type { CasinoRandom } from '../src/types/casino.js';
import type { Command, PreparedReply } from '../src/types/game.js';
import type { CoinSide, CoinState, PrivateCasinoCommand } from '../src/types/private-casino.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture(random: CasinoRandom = () => 0) {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, random);
  for (const vkId of [1, 2, 3]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 10_000_000;
  }
  let index = 0;
  const send = (command: Command, vkId = 1, eventId = `private:${index++}`, isChat = false) => service.handle({ eventId, vkId, peerId: isChat ? 2_000_000_001 : vkId, isChat, command }, async () => 'Игрок');
  const text = (text: string, eventId = `text:${index++}`) => service.handle({ eventId, vkId: 1, peerId: 1, text, command: parseCommand(text, undefined) }, async () => 'Игрок');
  const state = (): CoinState => {
    const record = db.state.casino.get(coinKey(1));
    assert.ok(record?.kind === 'coin');
    return record;
  };
  const click = (reply: PreparedReply, side: CoinSide = 'diamond', cashout = false): PrivateCasinoCommand => {
    assert.equal(reply.keyboard.kind, 'coin');
    if (reply.keyboard.kind !== 'coin') throw new Error('Expected coin keyboard');
    return cashout ? { kind: 'coin_cashout', token: reply.keyboard.token, step: reply.keyboard.step }
      : { kind: 'coin_flip', side, token: reply.keyboard.token, step: reply.keyboard.step };
  };
  return { db, service, send, text, state, click };
}

test('casino lobby shows current dealer and compact paragraphs; chat navigation is a genuine URL button', async () => {
  const f = await fixture();
  f.db.state.dealer.holderId = 2;
  f.db.state.dealer.earnedKC = 123_400;
  const lobby = await f.send({ kind: 'casino' });
  assert.equal(lobby.text, '[id1|Игрок 1], казино:\n\n🤑 Крупье: [id2|Игрок 2] (заработал: 1.234 KC)');
  assert.equal(lobby.keyboard.kind, 'casino');
  const chats = await f.send({ kind: 'casino_chats' });
  assert.equal(chats.text, '💬 Беседы');
  const keyboard: unknown = JSON.parse(buildKeyboard(chats.keyboard).toString());
  assert.ok(isRecord(keyboard) && Array.isArray(keyboard.buttons));
  const first: unknown = keyboard.buttons[0];
  assert.ok(Array.isArray(first));
  const link: unknown = first[0];
  assert.ok(isRecord(link) && isRecord(link.action));
  assert.equal(link.action.type, 'open_link');
  assert.equal(link.action.link, privateCasinoConfig.chatUrl);
  assert.equal(link.action.label, 'Чат #1');
  assert.equal((await f.send({ kind: 'casino' }, 1, undefined, true)).text, privateCasinoTexts.private);
  assert.equal(f.db.player().kc, 10_000_000);
});

test('all private-casino actions require validated payloads and coin keyboards carry bounded session/step tokens', async () => {
  for (const text of ['🎰 Джекпот', '☑️ Участвовать', '🪙 Монетка', '💎', '🟢', 'Забрать выигрыш']) assert.equal(parseCommand(text, undefined).kind, 'development');
  for (const command of ['casino', 'casino_chats', 'jackpot', 'jackpot_join', 'coin']) assert.deepEqual(parseCommand(undefined, { command }), { kind: command });
  for (const payload of [
    { command: 'coin_flip', side: 'diamond' }, { command: 'coin_flip', side: 'gold', token: 'x', step: 0 },
    { command: 'coin_cashout', token: '', step: 0 }, { command: 'coin_cashout', token: 'x', step: 8 },
    { command: 'coin_cashout', token: 'x', step: -1 }, { command: 'coin_cashout', token: 'x', step: 1.5 }
  ]) assert.equal(parseCommand(undefined, payload).kind, 'development');
  const f = await fixture();
  const reply = await f.send({ kind: 'coin' }, 1, 'x'.repeat(200));
  const keyboard: unknown = JSON.parse(buildKeyboard(reply.keyboard).toString());
  assert.ok(isRecord(keyboard) && Array.isArray(keyboard.buttons));
  for (const rawRow of keyboard.buttons) {
    const row: unknown = rawRow;
    assert.ok(Array.isArray(row));
    for (const rawButton of row) {
      const button: unknown = rawButton;
      assert.ok(isRecord(button) && isRecord(button.action) && typeof button.action.payload === 'string');
      assert.ok(Buffer.byteLength(button.action.payload) <= 255);
      assert.notEqual(parseCommand(undefined, button.action.payload).kind, 'development');
    }
  }
});

test('coin multipliers are slightly reduced, bounded at seven steps and do not create a positive role-combined expectation', () => {
  assert.deepEqual(privateCasinoConfig.coinMultipliers, [180, 360, 720, 1440, 2880, 5760, 11520]);
  for (let step = 1; step <= 7; step += 1) {
    assert.equal(coinPayout(1_000_000, step), 1_800_000 * 2 ** (step - 1));
    assert.equal(coinMultiplier(step) / 100 / 2 ** step, 0.9);
    assert.ok(coinMultiplier(step) / 100 / 2 ** step + 0.02 < 1);
  }
  assert.throws(() => coinMultiplier(0));
  assert.throws(() => coinMultiplier(8));
  assert.equal(coinPayout(game.maxAmount, 7), null);
});

test('coin prompts distinguish missing stake from cashout before the first flip and do not debit either prompt', async () => {
  const f = await fixture();
  const open = await f.send({ kind: 'coin' });
  assert.equal(open.text, privateCasinoTexts.intro);
  assert.equal((await f.send(f.click(open))).text, privateCasinoTexts.firstStake);
  assert.equal((await f.send(f.click(open, 'diamond', true))).text, privateCasinoTexts.firstStake);
  assert.equal((await f.text('999')).text, privateCasinoTexts.stakeUsage);
  const stake = await f.text('10к');
  assert.equal(stake.text, '💰 Ставка 10.000 KC сделана. Выбирайте монетку или измените ставку!');
  assert.equal(f.db.player().kc, 9_000_000);
  assert.equal((await f.send(f.click(stake, 'diamond', true))).text, privateCasinoTexts.noFlips);
  assert.equal(f.db.player().kc, 9_000_000);
});

test('changing a pre-flip stake adjusts only escrow delta and cannot farm director income', async () => {
  const f = await fixture();
  await f.send({ kind: 'director_view' });
  const director = f.db.state.casino.get('director');
  assert.ok(director?.kind === 'director');
  director.holderId = 2;
  await f.send({ kind: 'coin' });
  const first = await f.text('10к');
  assert.equal(f.db.player().kc, 9_000_000);
  await f.text('20к');
  assert.equal(f.db.player().kc, 8_000_000);
  const replaced = await f.text('5к');
  assert.equal(f.db.player().kc, 9_500_000);
  assert.equal(f.state().amount, 500_000);
  const before = f.db.state.casino.get('director');
  assert.ok(before?.kind === 'director');
  assert.equal(before.earnedKC, 0);
  assert.equal((await f.send(f.click(first))).text, casinoTexts.stale);
  const flipped = await f.send(f.click(replaced));
  const after = f.db.state.casino.get('director');
  assert.ok(after?.kind === 'director');
  assert.equal(after.earnedKC, 5000);
  assert.equal(f.db.player().kc, 9_500_000);
  assert.equal((await f.text('10к')).text, privateCasinoTexts.cannotChange);
  assert.equal(f.state().amount, 500_000);
  await f.send(f.click(flipped));
  const twice = f.db.state.casino.get('director');
  assert.ok(twice?.kind === 'director');
  assert.equal(twice.earnedKC, 5000);
});

test('active coins block back/menu, survive restart, and cash out once despite concurrent clicks and event replay', async () => {
  const f = await fixture();
  await f.send({ kind: 'coin' });
  const stake = await f.text('10к');
  for (const kind of ['casino', 'menu', 'profile', 'bank'] as const) assert.equal((await f.send({ kind })).text, privateCasinoTexts.active);
  const first = await f.send(f.click(stake), 1, 'first-flip');
  assert.match(first.text, /Множитель: x1.8 \(вы получите 18.000 KC/);
  assert.match(first.text, /Баланс: 90.000 KC$/);
  assert.equal((await f.send(f.click(stake), 1, 'first-flip')).randomId, first.randomId);
  assert.equal((await f.send(f.click(stake))).text, casinoTexts.stale);
  const service = new GameService(f.db);
  const command = f.click(first, 'diamond', true);
  const settled = await Promise.all(Array.from({ length: 12 }, (_, index) => service.handle({ eventId: `cash:${index}`, vkId: 1, peerId: 1, command }, async () => 'Игрок')));
  assert.equal(settled.filter(reply => reply.text.startsWith('✅ Вы забрали')).length, 1);
  assert.equal(f.db.player().kc, 10_800_000);
  assert.equal(f.state().stage, 'finished');
  assert.equal((await f.send({ kind: 'casino' })).keyboard.kind, 'casino');
});

test('seven correct flips automatically pay the full total once and show net profit only in the final text', async () => {
  const f = await fixture();
  await f.send({ kind: 'coin' });
  let reply = await f.text('10к');
  for (let step = 1; step <= 7; step += 1) {
    reply = await f.send(f.click(reply));
    if (step < 7) assert.equal(f.db.player().kc, 9_000_000);
  }
  assert.equal(reply.text, '✅ Вы дошли до конца!\n\n💰 Ваш чистый выигрыш составил: 1.142.000 KC');
  assert.equal(f.db.player().kc, 124_200_000);
  assert.equal(f.state().stage, 'finished');
  assert.equal(f.state().history.length, 7);
  await f.send(f.click(reply, 'diamond', true));
  assert.equal(f.db.player().kc, 124_200_000);
});

test('a failed flip loses only the original escrow, credits the losing-stake dealer fee once and keeps history in order', async () => {
  let coin = 0;
  const f = await fixture((purpose) => purpose.startsWith('coin:') ? coin : 0);
  f.db.state.dealer.holderId = 3;
  await f.send({ kind: 'coin' });
  let reply = await f.text('10к');
  reply = await f.send(f.click(reply));
  coin = 1;
  reply = await f.send(f.click(reply, 'emerald'));
  assert.match(reply.text, /На монетке выпадало: 💎🟢/);
  reply = await f.send(f.click(reply, 'diamond'), 1, 'lost');
  assert.equal(reply.text, '❌ Вы не угадали. Вся ставка потеряна.\n\n💸 Баланс: 90.000 KC');
  assert.equal(f.db.player().kc, 9_000_000);
  await settleCasino(f.db);
  assert.equal(f.db.state.dealer.earnedKC, 10_000);
  await settleCasino(f.db);
  assert.equal(f.db.state.dealer.earnedKC, 10_000);
});

test('coin escrow, role earnings, decisions and payouts roll back with event recording failures', async () => {
  const f = await fixture();
  await f.send({ kind: 'coin' });
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.text('10к'), /Simulated database failure/);
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  const stake = await f.text('10к');
  const escrow = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.send(f.click(stake)), /Simulated database failure/);
  assert.deepEqual(f.db.state, escrow);
  f.db.failRemember = false;
  const win = await f.send(f.click(stake));
  const winning = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.send(f.click(win, 'diamond', true)), /Simulated database failure/);
  assert.deepEqual(f.db.state, winning);
});

test('coin limits reject unsafe liability before debit; full wallets retain an exact durable payout', async () => {
  const f = await fixture();
  await f.send({ kind: 'coin' });
  f.db.player().kc = maxWholeKc;
  const balance = f.db.player().kc;
  assert.equal((await f.text('всё')).text, casinoTexts.limit);
  assert.equal(f.db.player().kc, balance);
  const stake = await f.text('10к');
  const win = await f.send(f.click(stake));
  f.db.player().kc = maxWholeKc;
  const paid = await f.send(f.click(win, 'diamond', true));
  assert.match(paid.text, /Выплата сохранена/);
  assert.equal(f.state().stage, 'finished');
  const credits = [...f.db.state.casino.values()].filter(record => record.kind === 'credit');
  assert.equal(credits.length, 1);
  assert.ok(credits[0]?.kind === 'credit');
  assert.equal(credits[0].amount, 1_800_000);
  await settleCasino(f.db);
  assert.equal(f.db.player().kc, maxWholeKc);
  f.db.player().kc = 0;
  f.db.time = new Date(f.db.time.getTime() + 60_000);
  await settleCasino(f.db);
  assert.equal(f.db.player().kc, 1_800_000);
});

test('jackpot deadlines are exactly 19:30 Moscow including equality and date boundaries', () => {
  assert.equal(nextJackpot(new Date('2026-10-26T16:29:59.999Z')).toISOString(), '2026-10-26T16:30:00.000Z');
  assert.equal(nextJackpot(new Date('2026-10-26T16:30:00.000Z')).toISOString(), '2026-10-27T16:30:00.000Z');
  assert.equal(nextJackpot(new Date('2026-12-31T22:00:00.000Z')).toISOString(), '2027-01-01T16:30:00.000Z');
});

test('jackpot seeds and growth use whole KC and inclusive ranges; free registration is once per player per day', async () => {
  const f = await fixture((_purpose, maximum) => maximum - 1);
  const initial = await f.send({ kind: 'jackpot' });
  assert.equal(initial.text, '🎰 Накоплено: 1.000.000 KC\n\n💰 Участников: 0');
  const first = await f.send({ kind: 'jackpot_join' }, 1, 'join:1');
  assert.equal(first.text, privateCasinoTexts.registered);
  assert.equal((await f.send({ kind: 'jackpot_join' }, 1, 'join:1')).randomId, first.randomId);
  const replies = await Promise.all(Array.from({ length: 12 }, () => f.send({ kind: 'jackpot_join' })));
  assert.ok(replies.every(reply => reply.text === privateCasinoTexts.already));
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  assert.equal(state.amount, 110_000_000);
  assert.equal(state.participants, 1);
  assert.equal(f.db.player().kc, 10_000_000);
  const other = await fixture();
  await other.send({ kind: 'jackpot_join' });
  const minimum = other.db.state.casino.get('jackpot');
  assert.ok(minimum?.kind === 'jackpot');
  assert.equal(minimum.amount, 100_000);
  assert.equal(minimum.participants, 1);
});

test('jackpot chooses one uniform participant, broadcasts every loser, resets daily and pays one exact credit', async () => {
  const f = await fixture((purpose) => purpose.startsWith('jackpot:winner:') ? 1 : 0);
  for (const vkId of [1, 2, 3]) await f.send({ kind: 'jackpot_join' }, vkId);
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  const roundId = state.roundId;
  f.db.time = new Date(state.dueAt);
  assert.equal((await f.send({ kind: 'jackpot_join' })).text, privateCasinoTexts.settling);
  await Promise.all([settleJackpot(f.db, purpose => purpose.startsWith('jackpot:winner:') ? 1 : 0), settleJackpot(f.db)]);
  await settleCasino(f.db);
  assert.equal(f.db.player(2).kc, 10_100_000);
  assert.equal(f.db.player(1).kc, 10_000_000);
  assert.equal(f.db.player(3).kc, 10_000_000);
  const notices = f.db.state.notifications.filter(notice => notice._id.startsWith(`jackpot-result:${roundId}`));
  assert.deepEqual(notices.map(notice => notice.peerId), [1, 3]);
  assert.ok(notices.every(notice => notice.text === '🎰 [id2|Игрок 2] получает джекпот: 1.000 KC' && notice.priority === 1));
  const winner = f.db.state.notifications.filter(notice => notice.text.startsWith('🎰 ДЖЕКПОТ!'));
  assert.equal(winner.length, 1);
  assert.equal(winner[0]?.peerId, 2);
  assert.equal(winner[0]?.text, '🎰 ДЖЕКПОТ! Вы стали победителем джекпота\n\n💰 Ваш выигрыш составил 1.000 KC');
  const next = f.db.state.casino.get('jackpot');
  assert.ok(next?.kind === 'jackpot');
  assert.notEqual(next.roundId, roundId);
  assert.equal(next.participants, 0);
  await settleJackpot(f.db);
  await settleCasino(f.db);
  assert.equal(f.db.player(2).kc, 10_100_000);
  assert.equal((await f.send({ kind: 'jackpot_join' })).text, privateCasinoTexts.registered);
});

test('an empty jackpot resets without carrying money or creating a fake winner; missed draws recover after downtime', async () => {
  const f = await fixture((_purpose, maximum) => maximum - 1);
  await f.send({ kind: 'jackpot' });
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  f.db.time = new Date(state.dueAt.getTime() + 3 * 86_400_000);
  await settleJackpot(f.db, () => 0);
  const next = f.db.state.casino.get('jackpot');
  assert.ok(next?.kind === 'jackpot');
  assert.equal(next.amount, 100_000);
  assert.equal(next.participants, 0);
  assert.ok(next.dueAt > f.db.time);
  assert.equal(f.db.state.notifications.length, 0);
  assert.equal([...f.db.state.casino.values()].filter(record => record.kind === 'credit').length, 0);
});

test('jackpot enrollment rolls back its growth and participant record when event recording fails', async () => {
  const f = await fixture((_purpose, maximum) => maximum - 1);
  await f.send({ kind: 'jackpot' });
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.send({ kind: 'jackpot_join' }), /Simulated database failure/);
  assert.deepEqual(f.db.state, before);
});

test('jackpot winner credits remain exact when the wallet is full and pay once after it has room', async () => {
  const f = await fixture((purpose) => purpose.endsWith(':chance') ? 1 : 0);
  await f.send({ kind: 'jackpot_join' });
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  assert.equal(state.amount, 600_000);
  f.db.player().kc = game.maxAmount;
  f.db.time = new Date(state.dueAt);
  await settleJackpot(f.db, () => 0);
  await settleCasino(f.db);
  assert.equal(f.db.player().kc, game.maxAmount);
  assert.equal(f.db.state.notifications.filter(notice => notice.text.startsWith('🎰 ДЖЕКПОТ!')).length, 0);
  const credit = [...f.db.state.casino.values()].find(record => record.kind === 'credit' && record._id.startsWith('credit:jackpot:'));
  assert.ok(credit?.kind === 'credit');
  assert.equal(credit.amount, 600_000);
  assert.equal(credit.stage, 'pending');
  f.db.player().kc = 0;
  f.db.time = new Date(f.db.time.getTime() + 60_000);
  await settleCasino(f.db);
  await settleCasino(f.db);
  assert.equal(f.db.player().kc, 600_000);
  assert.equal(f.db.state.notifications.filter(notice => notice.text.startsWith('🎰 ДЖЕКПОТ!')).length, 1);
});

test('jackpot paginated announcements preserve all participants and only notify people who joined', async () => {
  const f = await fixture();
  for (let vkId = 4; vkId <= 48; vkId += 1) {
    await f.service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => 'Игрок');
  }
  for (let vkId = 1; vkId <= 47; vkId += 1) await f.send({ kind: 'jackpot_join' }, vkId);
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  f.db.time = new Date(state.dueAt);
  await settleJackpot(f.db, () => 0);
  await settleCasino(f.db);
  const results = f.db.state.notifications.filter(notice => notice._id.startsWith('jackpot-result:'));
  assert.equal(results.length, 46);
  assert.equal(new Set(results.map(notice => notice.peerId)).size, 46);
  assert.equal(results.some(notice => notice.peerId === 48), false);
  assert.equal(f.db.state.notifications.filter(notice => notice.text.startsWith('🎰 ДЖЕКПОТ!')).length, 1);
});

test('the jackpot worker recovers a due round and wakes notifications only after the draw and all loser notices commit', async context => {
  const f = await fixture();
  for (const vkId of [1, 2, 3]) await f.send({ kind: 'jackpot_join' }, vkId);
  const state = f.db.state.casino.get('jackpot');
  assert.ok(state?.kind === 'jackpot');
  f.db.time = new Date(state.dueAt);
  const committed = Promise.withResolvers<void>();
  const stop = startJackpotWorker(f.db, () => {
    const next = f.db.state.casino.get('jackpot');
    assert.ok(next?.kind === 'jackpot');
    assert.equal(next.participants, 0);
    assert.equal(f.db.state.notifications.filter(notice => notice._id.startsWith('jackpot-result:')).length, 2);
    assert.equal([...f.db.state.casino.values()].filter(record => record.kind === 'credit').length, 1);
    committed.resolve();
  });
  context.after(stop);
  await committed.promise;
  await stop();
});


test('coin half stake rounds before checking the minimum and debits the same whole amount', async () => {
  const f = await fixture();
  await f.send({ kind: 'coin' });
  f.db.player().kc = 199_900;
  await f.text('пол');
  assert.equal(f.state().stage, 'staked');
  assert.equal(f.state().amount, 100_000);
  assert.equal(f.db.player().kc, 99_900);
});
