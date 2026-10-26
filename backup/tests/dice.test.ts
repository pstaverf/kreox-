import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diceConfig } from '../src/config/dice.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { startDiceWorker } from '../src/handlers/dice-worker.js';
import { diceChatKey, diceDistribution, diceMinimum, validDiceStake } from '../src/services/dice-rules.js';
import { diceMoney, diceTexts } from '../src/services/dice-texts.js';
import { settleDice } from '../src/services/dice.js';
import { GameService } from '../src/services/game.js';
import type { BalanceCurrency } from '../src/types/admin-balance.js';
import type { CasinoRandom } from '../src/types/casino.js';
import type { DiceChat } from '../src/types/dice.js';
import type { Command } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

const peer = 2_000_000_001;
async function fixture(random: CasinoRandom = purpose => purpose.endsWith(':2') ? 11 : 0) {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, random);
  for (const vkId of [1, 2, 3, 4, 5, 6, diceConfig.commissionId]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    for (const currency of ['kc', 'euro', 'bitcoin'] as const) db.player(vkId)[currency] = vkId === diceConfig.commissionId ? 0 : 100_000_000_000;
  }
  let sequence = 0;
  const send = (command: Command, vkId = 1, peerId = peer, eventId = `dice:${sequence++}`) => service.handle({ eventId, command, vkId, peerId, isChat: peerId > 2_000_000_000 }, async () => 'Игрок');
  const text = (value: string, vkId = 1, peerId = peer, eventId?: string) => send(parseCommand(value, undefined, true), vkId, peerId, eventId);
  const click = (kind: 'dice_join' | 'dice_leave', vkId = 2, gameId = 1, peerId = peer, eventId?: string) => send({ kind, gameId, peerId }, vkId, peerId, eventId);
  const chat = (peerId = peer): DiceChat => {
    const value = db.state.casino.get(diceChatKey(peerId));
    assert.ok(value?.kind === 'dice_chat');
    return value;
  };
  return { db, service, send, text, click, chat };
}

test('dice parsing: three existing currencies, minimums, suffixes and 2–5 seats', async () => {
  const f = await fixture();
  assert.equal((await f.text('кости')).text, 'Костей нет.');
  for (const text of ['кости 10', 'кости 999', 'кости 0', 'кости 100 5']) assert.equal((await f.text(text)).text, '🎲 Ставка от 1.000 KC.');
  for (const text of ['кости донат 1', 'кости евро 1']) assert.equal((await f.text(text)).text, '🎲 Ставка от 10 💶.');
  for (const text of ['кости бит 1', 'кости биткоин 1']) assert.equal((await f.text(text)).text, '🎲 Ставка от 10₿.');
  assert.deepEqual(parseCommand('кости 10кк 3', undefined, true), { kind: 'dice_create', currency: 'kc', amount: 1_000_000_000, slots: 3 });
  assert.deepEqual(parseCommand('кости 1k', undefined, true), { kind: 'dice_create', currency: 'kc', amount: 100_000, slots: 2 });
  assert.deepEqual(parseCommand('кости биткоин 100 5', undefined, true), { kind: 'dice_create', currency: 'bitcoin', amount: 10_000_000_000, slots: 5 });
  for (const text of ['кости 1000 1', 'кости 1000 6', 'кости 1000 2.5', 'кости 1000 3 лишнее', 'кости евро нет', 'кости 1e6', 'кости 999999999999999999999']) assert.equal(parseCommand(text, undefined, true).kind, 'dice_invalid');
  assert.equal(parseCommand('кости 1000', undefined).kind, 'development');
  assert.equal(parseCommand('Играть', undefined, true).kind, 'development');
  assert.equal(parseCommand('Отмена', undefined, true).kind, 'development');
});

test('creation reserves once, exact card and inline green/red buttons remain in a chat', async () => {
  const f = await fixture();
  const start = f.db.player().kc;
  const card = await f.text('кости 1000', 1, peer, 'same-create');
  assert.equal(card.text, '🎲 Игра в кости #1\n💰 Ставка: 1.000 KC\n\n👥 Мест: [1/2]\n✅ Игроки:\n[id1|Игрок 1]\n\n⏱️ До отмены игры: 30 мин. 0 сек.');
  assert.deepEqual(card.keyboard, { kind: 'dice_game', peerId: peer, gameId: 1 });
  const raw: unknown = JSON.parse(buildKeyboard(card.keyboard).toString());
  assert.ok(isRecord(raw) && raw.inline === true && Array.isArray(raw.buttons));
  assert.match(JSON.stringify(raw), /positive/);
  assert.match(JSON.stringify(raw), /negative/);
  assert.match(JSON.stringify(raw), /dice_join/);
  assert.match(JSON.stringify(raw), /dice_leave/);
  assert.deepEqual(parseCommand(undefined, { command: 'dice_join', peerId: peer, gameId: 1 }), { kind: 'dice_join', peerId: peer, gameId: 1 });
  assert.deepEqual(await f.text('кости 1000', 1, peer, 'same-create'), card);
  assert.equal(f.db.player().kc, start - 100_000);
  assert.equal(f.chat().games.length, 1);
});

test('each chat has its own monotonically increasing numbers and a hard five-game limit', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 8 }, (_, index) => f.text('кости 1000 5', index % 5 + 1)));
  assert.equal(f.chat().games.length, 5);
  assert.equal(f.chat().lastGame, 5);
  assert.equal((await f.text('кости 1000')).text, diceTexts.full);
  await f.text('кости 1000', 2, peer + 1);
  assert.equal(f.chat(peer + 1).lastGame, 1);
  await f.click('dice_leave', 1);
  assert.equal(f.chat().games.length, 4);
  await f.text('кости 1000');
  assert.equal(f.chat().lastGame, 6);
});

test('lists each active game in a separate durable message with an actual remaining timer', async () => {
  const f = await fixture();
  await f.text('кости 1000');
  await f.text('кости евро 10 5');
  f.db.time = new Date(f.db.time.getTime() + 6 * 60_000 + 31_000);
  const listed = await f.text('кости', 1, peer, 'list-once');
  assert.equal(listed.text, '');
  const notices = f.db.state.notifications.filter(value => value._id.startsWith('dice-list:'));
  assert.equal(notices.length, 2);
  assert.ok(notices.every(value => value.text.includes('23 мин. 29 сек.') && value.keyboard?.kind === 'dice_game'));
  await f.text('кости', 1, peer, 'list-once');
  assert.equal(f.db.state.notifications.filter(value => value._id.startsWith('dice-list:')).length, 2);
  assert.equal((await f.text('кости', 1, peer + 1)).text, 'Костей нет.');
});

test('two players roll 1–12 once, winner takes 99%, admin 1%, stale buttons are silent', async () => {
  const f = await fixture();
  const before = f.db.player(2).kc;
  await f.text('кости 1000');
  assert.equal((await f.click('dice_join', 1)).text, diceTexts.alreadyPlaying);
  assert.equal((await f.click('dice_join', 2)).text, '');
  assert.equal(f.db.player(2).kc, before - 100_000 + 198_000);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 2_000);
  assert.equal(f.chat().games.length, 0);
  const result = f.db.state.notifications.find(value => value._id === `dice-result:${peer}:1`);
  assert.equal(result?.text, '🎲 Игра в кости #1:\n\n[id1|Игрок 1]: 1\n[id2|Игрок 2]: 12\n\n💰 Победитель: [id2|Игрок 2], он забирает весь банк в 1.980 KC');
  for (const kind of ['dice_join', 'dice_leave'] as const) assert.equal((await f.click(kind, 3)).text, '');
  assert.equal(f.db.state.notifications.filter(value => value._id.startsWith('dice-result:')).length, 1);
});

test('ties at the maximum split with 3.45% fee; other players receive nothing; rounding conserves the pot', async () => {
  for (const slots of [2, 3, 4, 5]) {
    const f = await fixture(() => 7);
    await f.text(`кости 1001 ${slots}`);
    for (let vkId = 2; vkId <= slots; vkId += 1) await f.click('dice_join', vkId);
    const distribution = diceDistribution(100_100, slots, slots);
    for (let vkId = 1; vkId <= slots; vkId += 1) assert.equal(f.db.player(vkId).kc, 100_000_000_000 - 100_100 + distribution.each);
    assert.equal(f.db.player(diceConfig.commissionId).kc, distribution.commission);
    assert.equal(BigInt(distribution.each) * BigInt(slots) + BigInt(distribution.commission), 100_100n * BigInt(slots));
    assert.match(f.db.state.notifications.find(value => value._id.startsWith('dice-result:'))?.text ?? '', /делят между собой весь банк\. Каждый получает:/u);
  }
  const f = await fixture(purpose => purpose.endsWith(':1') ? 0 : 9);
  await f.text('кости 1000 3');
  await f.click('dice_join', 2);
  await f.click('dice_join', 3);
  assert.equal(f.db.player(1).kc, 100_000_000_000 - 100_000);
  assert.equal(f.db.player(2).kc, 100_000_000_000 - 100_000 + 144_825);
  assert.equal(f.db.player(3).kc, 100_000_000_000 - 100_000 + 144_825);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 10_350);
});

test('creator leaves only their own seat; rejoining and leaving cannot duplicate a refund', async () => {
  const f = await fixture();
  await f.text('кости 1000 3');
  const deadline = f.chat().games[0]?.expiresAt;
  assert.equal((await f.click('dice_join', 2)).text, diceTexts.accepted);
  assert.equal((await f.click('dice_leave', 3)).text, diceTexts.notPlaying);
  assert.equal((await f.click('dice_leave', 1)).text, diceTexts.left);
  assert.equal(f.db.player(1).kc, 100_000_000_000);
  assert.deepEqual(f.chat().games[0]?.players.map(value => value.vkId), [2]);
  assert.equal((await f.click('dice_join', 1)).text, diceTexts.accepted);
  assert.equal((await f.click('dice_leave', 1)).text, diceTexts.left);
  assert.equal(f.db.player(1).kc, 100_000_000_000);
  assert.deepEqual(f.chat().games[0]?.expiresAt, deadline);
  assert.equal((await f.click('dice_leave', 1)).text, diceTexts.notPlaying);
  await f.click('dice_leave', 2);
  assert.equal(f.chat().games.length, 0);
  assert.equal(f.db.player(2).kc, 100_000_000_000);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 0);
});

test('all three currency balances are isolated and commission uses the same currency', async () => {
  for (const [currency, command] of [['kc', 'кости 1000'], ['euro', 'кости донат 10'], ['bitcoin', 'кости бит 10']] as const) {
    const f = await fixture();
    await f.text(command);
    await f.click('dice_join', 2);
    const amount = diceMinimum(currency);
    const distribution = diceDistribution(amount, 2, 1);
    assert.equal(f.db.player(1)[currency], 100_000_000_000 - amount);
    assert.equal(f.db.player(2)[currency], 100_000_000_000 - amount + distribution.each);
    assert.equal(f.db.player(diceConfig.commissionId)[currency], distribution.commission);
    for (const other of ['kc', 'euro', 'bitcoin'] as const) if (other !== currency) assert.equal(f.db.player(2)[other], 100_000_000_000);
  }
});

test('expiry survives service restart, refunds exactly once and sends chat plus private notices in the right currency', async () => {
  for (const [currency, command] of [['kc', 'кости 1000 3'], ['euro', 'кости евро 10 3'], ['bitcoin', 'кости биткоин 10 3']] as const) {
    const f = await fixture();
    await f.text(command);
    await f.click('dice_join', 2);
    f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs);
    await Promise.all([settleDice(f.db), settleDice(f.db)]);
    assert.equal(f.chat().games.length, 0);
    for (const vkId of [1, 2]) {
      assert.equal(f.db.player(vkId)[currency], 100_000_000_000);
      assert.ok(f.db.state.notifications.some(value => value.peerId === vkId && value.text.includes('возвращена') && value.text.includes(diceMoney(diceMinimum(currency), currency))));
    }
    assert.ok(f.db.state.notifications.some(value => value.peerId === peer && value.text === 'Игра в кости #1 отменена в связи с истечением времени.'));
    const credits = [...f.db.state.casino.values()].filter(value => value.kind === 'dice_credit');
    assert.equal(credits.length, 2);
    await settleDice(f.db);
    assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'dice_credit').length, 2);
  }
});

test('expired buttons cannot start a game, list expires old games and creates a new number', async () => {
  const f = await fixture();
  await f.text('кости 1000');
  f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs);
  assert.equal((await f.click('dice_join', 2)).text, '');
  assert.equal((await f.text('кости')).text, 'Костей нет.');
  assert.equal(f.db.player().kc, 100_000_000_000);
  await f.text('кости 1000');
  assert.equal(f.chat().lastGame, 2);
});

test('payload cannot move money across chats/DMs or impersonate a participant', async () => {
  const f = await fixture();
  await f.text('кости 1000');
  assert.equal((await f.send({ kind: 'dice_join', peerId: peer, gameId: 1 }, 2, peer + 1)).text, '');
  assert.equal((await f.send({ kind: 'dice_join', peerId: peer, gameId: 1 }, 2, 2)).text, '');
  assert.equal(f.db.player(2).kc, 100_000_000_000);
  const command = parseCommand(undefined, { command: 'dice_leave', peerId: peer, gameId: 1, vkId: 1 });
  assert.equal((await f.send(command, 3)).text, diceTexts.notPlaying);
  assert.equal(f.chat().games[0]?.players.length, 1);
  for (const payload of [{ command: 'dice_join', peerId: peer, gameId: 0 }, { command: 'dice_join', peerId: 1, gameId: 1 }, { command: 'dice_join', peerId: peer, gameId: 1.5 }]) assert.equal(parseCommand(undefined, payload, true).kind, 'development');
});

test('insufficient balances, full pot bounds and failed creation leave no escrow or hot empty expiry record', async () => {
  const f = await fixture();
  f.db.player().kc = 99_999;
  assert.equal((await f.text('кости 1000')).text, diceTexts.funds);
  assert.equal(f.chat().lastGame, 0);
  assert.ok(f.chat().dueAt > f.db.time);
  f.db.player().kc = game.maxAmount;
  assert.equal((await f.send({ kind: 'dice_create', amount: game.maxAmount, currency: 'kc', slots: 2 })).text, diceTexts.limit);
  await f.text('кости 1000');
  f.db.player(2).kc = 1;
  assert.equal((await f.click('dice_join', 2)).text, diceTexts.funds);
  assert.equal(f.chat().games[0]?.players.length, 1);
  assert.equal(f.db.player(2).kc, 1);
  assert.equal(validDiceStake('kc', game.maxAmount, 5), false);
});

test('racing final joins, cancels, duplicate event IDs and workers cannot double-pay or accept a sixth player', async () => {
  const f = await fixture();
  await f.text('кости 1000 5');
  await Promise.all(Array.from({ length: 10 }, (_, index) => f.click('dice_join', index % 5 + 2, 1, peer, `race:${index}`)));
  assert.equal(f.chat().games.length, 0);
  assert.equal(f.db.state.notifications.filter(value => value._id.startsWith('dice-result:')).length, 1);
  const total = [1, 2, 3, 4, 5, 6, diceConfig.commissionId].reduce((sum, vkId) => sum + BigInt(f.db.player(vkId).kc), 0n);
  assert.equal(total, 600_000_000_000n);
  const g = await fixture();
  await g.text('кости 1000');
  await Promise.all(Array.from({ length: 8 }, () => g.click('dice_leave', 1, 1, peer, 'cancel-once')));
  assert.equal(g.db.player().kc, 100_000_000_000);
  assert.equal([...g.db.state.casino.values()].filter(value => value.kind === 'dice_credit').length, 1);
});

test('transaction failure rolls back the stake, completed game, commission, credits and result outbox', async () => {
  const f = await fixture();
  await f.text('кости 1000');
  f.db.failRemember = true;
  await assert.rejects(f.click('dice_join', 2), /Simulated database failure/);
  assert.equal(f.chat().games[0]?.players.length, 1);
  assert.equal(f.db.player(2).kc, 100_000_000_000);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 0);
  assert.equal(f.db.state.notifications.length, 0);
  assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'dice_credit').length, 0);
  f.db.failRemember = false;
  await f.click('dice_join', 2);
  assert.equal(f.chat().games.length, 0);
});

test('full wallets retain durable currency-aware refunds and payouts until there is room', async () => {
  const f = await fixture();
  await f.text('кости евро 10');
  f.db.player().euro = game.maxAmount;
  f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs);
  await settleDice(f.db);
  assert.equal(f.db.player().euro, game.maxAmount);
  assert.equal(f.db.state.notifications.filter(value => value.peerId === 1).length, 0);
  const credit = [...f.db.state.casino.values()].find(value => value.kind === 'dice_credit');
  assert.ok(credit?.kind === 'dice_credit' && credit.stage === 'pending');
  f.db.player().euro = 0;
  f.db.time = new Date(f.db.time.getTime() + diceConfig.retryMs);
  await settleDice(f.db);
  await settleDice(f.db);
  assert.equal(f.db.player().euro, 1_000);
  assert.equal(f.db.state.notifications.filter(value => value.peerId === 1 && value.text.includes('возвращена')).length, 1);
  const g = await fixture();
  await g.text('кости бит 10');
  g.db.player(2).bitcoin = game.maxAmount;
  await g.click('dice_join', 2);
  assert.ok([...g.db.state.casino.values()].some(value => value.kind === 'dice_credit' && value.stage === 'pending' && value.vkId === 2 && value.currency === 'bitcoin'));
  g.db.player(2).bitcoin = 0;
  g.db.time = new Date(g.db.time.getTime() + diceConfig.retryMs);
  await settleDice(g.db);
  assert.equal(g.db.player(2).bitcoin, 1_980_000_000);
});

test('missing admin does not lose commission, admin participation does not create extra money', async () => {
  const f = await fixture();
  f.db.state.players.delete(diceConfig.commissionId);
  await f.text('кости 1000');
  await f.click('dice_join', 2);
  assert.ok([...f.db.state.casino.values()].some(value => value.kind === 'dice_credit' && value.vkId === diceConfig.commissionId && value.stage === 'pending'));
  await f.send({ kind: 'profile' }, diceConfig.commissionId, diceConfig.commissionId);
  f.db.time = new Date(f.db.time.getTime() + diceConfig.retryMs);
  await settleDice(f.db);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 2_000);
  const g = await fixture(() => 5);
  g.db.player(diceConfig.commissionId).kc = 100_000;
  await g.text('кости 1000');
  await g.click('dice_join', diceConfig.commissionId);
  assert.equal(g.db.player(1).kc + g.db.player(diceConfig.commissionId).kc, 100_000_100_000);
});

test('integer payout arithmetic is exact near the safe limit and money text preserves all paid atomic units', () => {
  for (const currency of ['kc', 'euro', 'bitcoin'] as const satisfies readonly BalanceCurrency[]) {
    const amount = Math.floor(game.maxAmount / 5);
    for (const winners of [1, 2, 3, 4, 5]) {
      const value = diceDistribution(amount, 5, winners);
      assert.equal(BigInt(value.each) * BigInt(winners) + BigInt(value.commission), BigInt(amount) * 5n);
      assert.ok(Number.isSafeInteger(value.each));
    }
    assert.ok(diceMoney(game.maxAmount, currency).includes(','));
  }
  assert.equal(diceMoney(100_001, 'kc'), '1.000,01 KC');
  assert.equal(diceMoney(2_703, 'euro'), '27,03 💶');
  assert.equal(diceMoney(1_000_000_001, 'bitcoin'), '10,00000001₿');
  assert.deepEqual(diceDistribution(2_800, 2, 2), { each: 2_703, commission: 194 });
  assert.throws(() => diceDistribution(game.maxAmount, 2, 1));
});

test('dice worker runs immediately, wakes deliveries after expiry, and can stop gracefully', async () => {
  const f = await fixture();
  await f.text('кости 1000');
  f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs);
  let wake = 0;
  const stop = startDiceWorker(f.db, () => { wake += 1; });
  await stop();
  assert.equal(f.chat().games.length, 0);
  assert.equal(wake, 1);
});

test('deadline crossed during a final join rolls back all economic writes before retrying silently', async () => {
  let advance = (): void => {};
  let advanced = false;
  const f = await fixture(() => {
    if (!advanced) { advanced = true; advance(); }
    return 0;
  });
  advance = () => { f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs); };
  await f.text('кости 1000');
  assert.equal((await f.click('dice_join', 2)).text, '');
  assert.equal(f.db.player(2).kc, 100_000_000_000);
  assert.equal(f.db.player(diceConfig.commissionId).kc, 0);
  assert.equal(f.db.state.notifications.length, 0);
  assert.equal(f.chat().games[0]?.players.length, 1);
  await settleDice(f.db);
  assert.equal(f.db.player().kc, 100_000_000_000);
  assert.ok(f.db.state.notifications.every(value => !value._id.startsWith('dice-result:')));
});

test('dice relative stake aliases parse for KC, euro and bitcoin with optional player counts', () => {
  for (const [alias, amount] of [['все', 'all'], ['всё', 'all'], ['вб', 'all'], ['пол', 'half']] as const) {
    for (const [prefix, currency] of [['', 'kc'], ['евро ', 'euro'], ['донат ', 'euro'], ['бит ', 'bitcoin'], ['биткоин ', 'bitcoin']] as const) {
      assert.deepEqual(parseCommand(`кости ${prefix}${alias}`, undefined, true), { kind: 'dice_create', currency, amount, slots: 2 });
      assert.deepEqual(parseCommand(`КОСТИ ${prefix}${alias} 5`, undefined, true), { kind: 'dice_create', currency, amount, slots: 5 });
    }
  }
});

test('relative stakes reserve the current balance of the chosen currency, enforce minimums and round half down', async () => {
  for (const [prefix, currency] of [['', 'kc'], ['евро ', 'euro'], ['бит ', 'bitcoin']] as const) {
    for (const alias of ['все', 'всё', 'вб', 'пол']) {
      const f = await fixture();
      const minimum = diceMinimum(currency);
      f.db.player()[currency] = minimum * 2 + 1;
      await f.text(`кости ${prefix}${alias} 3`);
      const amount = alias === 'пол' ? minimum : minimum * 2 + 1;
      assert.equal(f.chat().games[0]?.amount, amount);
      assert.equal(f.db.player()[currency], alias === 'пол' ? minimum + 1 : 0);
      for (const other of ['kc', 'euro', 'bitcoin'] as const) if (other !== currency) assert.equal(f.db.player()[other], 100_000_000_000);
      await f.click('dice_leave', 1);
      assert.equal(f.db.player()[currency], minimum * 2 + 1);
    }
    for (const [alias, balance] of [['всё', diceMinimum(currency) - 1], ['пол', diceMinimum(currency) * 2 - 1], ['вб', 0]] as const) {
      const f = await fixture();
      f.db.player()[currency] = balance;
      const result = await f.text(`кости ${prefix}${alias}`);
      assert.equal(result.text, currency === 'kc' ? '🎲 Ставка от 1.000 KC.' : currency === 'euro' ? '🎲 Ставка от 10 💶.' : '🎲 Ставка от 10₿.');
      assert.equal(f.db.player()[currency], balance);
      assert.equal(f.db.state.casino.has(diceChatKey(peer)), false);
    }
  }
});

test('relative stakes include refunds made in the same transaction, replay once and cannot reserve the same money twice', async () => {
  const f = await fixture();
  f.db.player().kc = 300_001;
  await f.text('кости 1000');
  f.db.time = new Date(f.db.time.getTime() + diceConfig.lifetimeMs);
  await f.text('кости пол', 1, peer, 'half-after-expiry');
  assert.equal(f.chat().games[0]?.amount, 150_000);
  assert.equal(f.db.player().kc, 150_001);
  await f.text('кости пол', 1, peer, 'half-after-expiry');
  assert.equal(f.db.player().kc, 150_001);
  const g = await fixture();
  g.db.player().kc = 300_001;
  await Promise.all([g.text('кости все'), g.text('кости вб')]);
  assert.equal(g.chat().games.length, 1);
  assert.equal(g.chat().games[0]?.amount, 300_001);
  assert.equal(g.db.player().kc, 0);
  const h = await fixture();
  h.db.player().kc = game.maxAmount;
  assert.equal((await h.text('кости всё 5')).text, diceTexts.limit);
  assert.equal(h.db.player().kc, game.maxAmount);
});

test('listed dice cards have exactly two blank lines and consecutive heading, seats and participant lines', async () => {
  const f = await fixture();
  await f.text('кости 1000 3');
  await f.click('dice_join', 2);
  await f.text('кости');
  const card = f.db.state.notifications.find(value => value._id.startsWith('dice-list:'));
  assert.ok(card !== undefined);
  assert.equal(card.text, '🎲 Игра в кости #1\n💰 Ставка: 1.000 KC\n\n👥 Мест: [2/3]\n✅ Игроки:\n[id1|Игрок 1]\n[id2|Игрок 2]\n\n⏱️ До отмены игры: 30 мин. 0 сек.');
  assert.equal(card.text.split('\n\n').length, 3);
});
