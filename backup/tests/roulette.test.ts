import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rouletteConfig, roulettePhotos } from '../src/config/roulette.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { betPayout, closeKey, roundKey, selectOutcome } from '../src/services/casino-rules.js';
import { betAccepted, casinoTexts, historyText, roundClosed, roundHeading, winningBet } from '../src/services/casino-texts.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { GameService } from '../src/services/game.js';
import { parseRouletteTarget, rouletteMultiplier, rouletteWins, validRouletteTarget } from '../src/services/roulette-rules.js';
import { rouletteColor, rouletteOutcome } from '../src/services/roulette-texts.js';
import type { CasinoMode, CasinoRound } from '../src/types/casino.js';
import { MemoryDatabase } from './memory.js';

async function fixture(number = 2) {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, (purpose, maximum) => purpose.endsWith(':roulette') ? number : maximum - 1);
  let index = 0;
  for (const vkId of [1, 2, 3]) {
    await service.handle({ eventId: `register-${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 10_000_000;
  }
  const chat = (text: string, vkId = 1, peerId = 2_000_000_001, eventId = `roulette-${index++}`) => service.handle({ eventId, vkId, peerId, isChat: true, text, command: parseCommand(text, undefined, true) }, async () => 'Игрок');
  const round = (mode: CasinoMode = 'roulette', peerId = 2_000_000_001): CasinoRound => {
    const record = db.state.casino.get(roundKey(peerId, mode));
    assert.ok(record?.kind === 'round');
    return record;
  };
  const drain = async () => {
    for (let index = 0; index < 100; index += 1) {
      for (const notification of db.state.notifications) notification.state = 'sent';
      const count = await settleCasino(db);
      db.time = new Date(db.time.getTime() + 250);
      if (count === 0 && [...db.state.casino.values()].every(record => record.kind !== 'round' || record.stage === 'finished')) return;
    }
    throw new Error('Roulette did not drain');
  };
  return { db, chat, round, drain };
}

test('European roulette has exactly 37 uniformly selected results and correct 18 red / 18 black numbers', () => {
  for (let number = 0; number <= 36; number += 1) {
    assert.deepEqual(selectOutcome('roulette', (purpose, maximum) => { assert.equal(maximum, 37); assert.match(purpose, /:roulette$/); return number; }, 'round'), { result: number, bonus: 1 });
  }
  assert.equal(rouletteConfig.red.length, 18);
  assert.equal(rouletteConfig.black.length, 18);
  assert.equal(new Set([...rouletteConfig.red, ...rouletteConfig.black]).size, 36);
  assert.equal(rouletteColor(0), '🟢');
  for (const number of [1, 14, 36]) assert.equal(rouletteColor(number), '🔴');
  for (const number of [2, 15, 35]) assert.equal(rouletteColor(number), '⚫');
  assert.throws(() => rouletteColor(37));
});

test('roulette targets, contiguous quarters and every multiplier match the requested European payouts', () => {
  for (let number = 0; number <= 36; number += 1) {
    assert.equal(parseRouletteTarget(String(number)), number);
    assert.equal(rouletteMultiplier(number), 36);
    assert.equal(betPayout('roulette', 100_000, number, 1), 3_600_000);
    for (let outcome = 0; outcome <= 36; outcome += 1) assert.equal(rouletteWins(number, outcome), number === outcome);
  }
  for (const group of rouletteConfig.groups) {
    assert.equal(parseRouletteTarget(group.label.toUpperCase()), group.target);
    assert.equal(rouletteMultiplier(group.target), group.multiplier);
    assert.equal(group.numbers.length * group.multiplier, 36);
    for (let outcome = 0; outcome <= 36; outcome += 1) assert.equal(rouletteWins(group.target, outcome), group.numbers.includes(outcome));
    assert.equal(rouletteWins(group.target, 0), false);
  }
  for (const label of ['чётное', 'нечётное', 'чёрное']) assert.ok(parseRouletteTarget(label) !== null);
  const quarter = parseRouletteTarget('ч3');
  assert.ok(quarter !== null);
  for (const [number, wins] of [[18, false], [19, true], [27, true], [28, false]] as const) assert.equal(rouletteWins(quarter, number), wins);
  for (const invalid of ['37', '-1', '0-36', '1-18', 'п3', 'д4', 'ч5', 'красный', '2.0']) assert.equal(parseRouletteTarget(invalid), null);
  assert.equal(validRouletteTarget(52), false);
  assert.equal(betPayout('roulette', game.maxAmount, 0, 1), null);
});

test('mixed roulette/crash/dream multiline commands accept aliases and reject only malformed lines', async () => {
  const f = await fixture();
  const reply = await f.chat('краш 1.7 1к\nрулетка красное 2к\nдрим 2 1000\nрулетка 0 пол\nрулетка 37 1000');
  assert.equal(reply.keyboard.kind, 'none');
  assert.equal(reply.text.split('\n').filter(line => line.startsWith('✅')).length, 4);
  assert.match(reply.text, /2.000 KC на красное/);
  assert.match(reply.text, /48.000 KC на 0/);
  assert.equal(reply.text.split('\n').at(-1), casinoTexts.rouletteUsage);
  assert.equal(f.db.player().kc, 4_800_000);
  assert.equal(f.round('crash').closesAt.getTime() - f.db.time.getTime(), 10_000);
  assert.equal(f.round('dream').closesAt.getTime() - f.db.time.getTime(), 10_000);
  assert.equal(f.round().closesAt.getTime() - f.db.time.getTime(), 10_500);
  assert.deepEqual(parseCommand('лог рулетка', undefined, true), { kind: 'casino_log', mode: 'roulette' });
  assert.equal(parseCommand('рулетка 2 1000', undefined, false).kind, 'development');
});

test('roulette caps ten bets, deduplicates events and isolates rounds across chats', async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({ length: 15 }, () => f.chat('рулетка п1 1000')));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 10);
  assert.equal(f.db.player().kc, 9_000_000);
  assert.match(replies.at(-1)?.text ?? '', /Не более 10 ставок в режиме «Рулетка»/);
  const first = await f.chat('рулетка 2 1000', 2, 2_000_000_002, 'roulette-replay');
  assert.equal((await f.chat('рулетка 2 1000', 2, 2_000_000_002, 'roulette-replay')).randomId, first.randomId);
  assert.equal(f.db.player(2).kc, 9_900_000);
  assert.equal(f.round('roulette', 2_000_000_002).total, 100_000);
});

test('roulette payouts and role income settle once; only the first result page requests its exact photo', async () => {
  const f = await fixture(2);
  await f.chat('директор');
  const director = f.db.state.casino.get('director');
  assert.ok(director?.kind === 'director');
  director.holderId = 2;
  f.db.state.dealer.holderId = 3;
  await f.chat('рулетка 2 1000\nрулетка ч1 1000\nрулетка красное 1000');
  assert.equal(f.db.player().kc, 9_700_000);
  f.db.time = new Date(f.round().closesAt);
  assert.equal((await f.chat('рулетка 2 1000')).text, '');
  await f.drain();
  assert.equal(f.db.player().kc, 13_700_000);
  assert.equal(f.db.state.dealer.earnedKC, 1000);
  const paidDirector = f.db.state.casino.get('director');
  assert.ok(paidDirector?.kind === 'director');
  assert.equal(paidDirector.earnedKC, 3000);
  const results = f.db.state.notifications.filter(notice => notice._id.startsWith('result:'));
  assert.equal(results[0]?.roulettePhoto, 2);
  assert.match(results[0]?.text ?? '', /^🎰 Итоги игры "Рулетка":\n\n🎡 Выпало — 2⚫/);
  assert.match(results[0]?.text ?? '', /на ч1\n— Приз: 4.000 KC/);
  assert.match(results[0]?.text ?? '', /Проиграно: 1.000 KC/);
  assert.equal(results.filter(result => result.roulettePhoto !== undefined).length, 1);
  const before = structuredClone(f.db.state);
  await settleCasino(f.db);
  assert.deepEqual(f.db.state, before);
  assert.equal((await f.chat('лог рулетка')).text, 'Последние 20 выпавших чисел\n\n⚫ 2');
});

test('zero loses even/color/group bets, pays straight zero and remains a photo outcome rather than absence', async () => {
  const f = await fixture(0);
  await f.chat('рулетка четное 1000\nрулетка черное 1000\nрулетка малые 1000', 1);
  await f.chat('рулетка 0 1000', 2);
  f.db.time = new Date(f.round().closesAt);
  await f.drain();
  assert.equal(f.db.player(1).kc, 9_700_000);
  assert.equal(f.db.player(2).kc, 13_500_000);
  const result = f.db.state.notifications.find(notice => notice._id.startsWith('result:'));
  assert.equal(result?.roulettePhoto, 0);
  assert.match(result?.text ?? '', /Выпало — 0🟢/);
  assert.match(result?.text ?? '', /Проиграно: 3.000 KC/);
  assert.match(result?.text ?? '', /Приз: 36.000 KC/);
});

test('roulette all-loss result, history ordering, numeric labels and photo table are exact', async () => {
  const f = await fixture(14);
  await f.chat('рулетка черное 1000');
  f.round().history = Array.from({ length: 20 }, (_, result) => ({ result, bonus: 1 }));
  f.db.time = new Date(f.round().closesAt);
  await f.drain();
  const result = f.db.state.notifications.find(notice => notice._id.startsWith('result:'));
  assert.equal(result?.text, '🎰 Итоги игры "Рулетка":\n\n🎡 Выпало — 14🔴\n\n❌ Все ставки проиграли!\n\n💰 Проиграно: 1.000 KC');
  assert.equal(f.round().history.length, 20);
  assert.equal(f.round().history[0]?.result, 1);
  assert.ok(historyText('roulette', f.round().history).endsWith('🔴 14'));
  assert.equal(rouletteOutcome(14), '14🔴');
  assert.equal(roulettePhotos.length, 37);
  assert.equal(new Set(roulettePhotos).size, 37);
  for (const url of roulettePhotos) assert.match(url, /^https:\/\/cdn\.kleymorf\.xyz\/other\/[a-z0-9_]+\.jpg$/);
  assert.match(betAccepted(f.db.player(), 'roulette', 100_000, 0), /на 0$/);
  const firstBet = [...f.db.state.casino.values()].find(record => record.kind === 'bet');
  assert.ok(firstBet?.kind === 'bet');
  assert.match(winningBet(firstBet, 'roulette', 200_000), /на черное\n— Приз: 2.000 KC$/);
  assert.match(roundHeading(f.round()), /🎡 Выпало — 14🔴$/);
});

test('roulette maximum payout guards, transaction rollback and durable full-wallet winnings preserve KC', async () => {
  const f = await fixture(2);
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.chat('рулетка 2 все'));
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  f.db.player(2).kc = game.maxAmount;
  assert.equal((await f.chat('рулетка 2 все', 2)).text, casinoTexts.limit);
  assert.equal(f.db.player(2).kc, game.maxAmount);
  await f.chat('рулетка 2 1000');
  f.db.player().kc = game.maxAmount;
  f.db.time = new Date(f.round().closesAt);
  await f.drain();
  assert.equal(f.db.player().kc, game.maxAmount);
  assert.equal(f.round().stage, 'finished');
  const credit = [...f.db.state.casino.values()].find(record => record.kind === 'credit');
  assert.ok(credit?.kind === 'credit');
  assert.equal(credit.amount, 3_600_000);
  assert.equal(credit.stage, 'pending');
  f.db.player().kc = 0;
  f.db.time = new Date(f.db.time.getTime() + 60_000);
  await f.drain();
  assert.equal(f.db.player().kc, 3_600_000);
});

test('bare roulette targets accept every group and individual number without stealing unrelated or single-number commands', () => {
  const targets = [...rouletteConfig.groups.map(group => group.label), ...Array.from({ length: 37 }, (_, index) => String(index)), 'ЧЁТНОЕ', 'ЧЁРНОЕ'];
  for (const target of targets) {
    assert.deepEqual(parseCommand(`${target} 10к`, undefined, true), parseCommand(`рулетка ${target} 10к`, undefined, true));
  }
  for (const text of ['1', '36', '1000', 'ч1', '37 10к', 'п3 10к', 'привет 10к']) {
    assert.equal(parseCommand(text, undefined, true).kind, 'development');
  }
  assert.equal(parseCommand('ч1 10к', undefined, false).kind, 'development');
  for (const text of ['ч1 неверно', 'ч1 10к лишнее', 'ч1 100', '5 минут', '10 человек']) {
    assert.equal(parseCommand(text, undefined, true).kind, 'development');
  }
  assert.equal(parseCommand('рулетка ч1 100', undefined, true).kind, 'casino_bets');
});

test('short roulette bets share balance, round extensions, caps and event deduplication with full commands', async () => {
  const f = await fixture();
  const first = await f.chat('ч1 10к', 1, 2_000_000_001, 'short-replayed');
  assert.match(first.text, /✅ .*10.000 KC на ч1/);
  assert.equal(f.db.player().kc, 9_000_000);
  assert.equal((await f.chat('ч1 10к', 1, 2_000_000_001, 'short-replayed')).randomId, first.randomId);
  assert.equal(f.db.player().kc, 9_000_000);
  const reply = await f.chat('КРАСНОЕ 1к\nкраш 1.7 1к\nрулетка 0 1к\nдрим 2 1к\nЧЁРНОЕ пол');
  assert.equal(reply.text.split('\n').filter(line => line.startsWith('✅')).length, 5);
  assert.equal(f.db.player().kc, 4_300_000);
  assert.equal(f.round().total, 5_500_000);
  assert.equal(f.round().closesAt.getTime() - f.db.time.getTime(), 11_500);
  const capped = await f.chat(Array.from({ length: 7 }, () => 'п1 1000').join('\n'));
  assert.equal(capped.text.split('\n').filter(line => line.startsWith('✅')).length, 6);
  assert.match(capped.text.split('\n').at(-1) ?? '', /Не более 10 ставок/);
  const remaining = f.db.player().kc;
  await f.chat('ч1 неверно');
  assert.equal(f.db.player().kc, remaining);
});


test('all-in roulette preserves exact fractional KC and formats the stake and payout with a decimal comma', async () => {
  const f = await fixture(16);
  f.db.player().kc = 180_394_712;
  const reply = await f.chat('16 все');
  assert.equal(reply.text, '✅ [id1|Игрок 1] — 1.803.947,12 KC на 16');
  assert.equal(f.db.player().kc, 0);
  const bet = [...f.db.state.casino.values()].find(value => value.kind === 'bet');
  assert.ok(bet?.kind === 'bet');
  assert.equal(bet.amount, 180_394_712);
  f.db.time = new Date(f.round().closesAt);
  await f.drain();
  assert.equal(f.db.player().kc, 6_494_209_632);
  const result = f.db.state.notifications.find(value => value._id.startsWith('result:'));
  assert.ok(result?.text.includes('✅ [id1|Игрок 1] — 1.803.947,12 KC на 16\n— Приз: 64.942.096,32 KC'));
});

test('late all-in bets and the casino worker share a single committed close notice without debits or duplicate replies', async () => {
  const f = await fixture();
  await f.chat('16 1000');
  const round = f.round();
  const balance = f.db.player(2).kc;
  const total = round.total;
  f.db.time = new Date(round.closesAt);
  const replies = await Promise.all([
    ...Array.from({ length: 10 }, () => f.chat('16 все', 2)),
    settleCasino(f.db)
  ]);
  for (const reply of replies) if (typeof reply !== 'number') assert.equal(reply.text, '');
  assert.equal(f.db.player(2).kc, balance);
  assert.equal(f.round().total, total);
  assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'bet').length, 1);
  const notices = f.db.state.notifications.filter(value => value._id === closeKey(round));
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.text, roundClosed('roulette'));
  assert.equal(notices[0]?.text.includes('\n\n'), false);
  assert.equal(f.round().stage, 'closed');
  const replay = await f.chat('16 все', 2, round.peerId, 'late-once');
  assert.deepEqual(await f.chat('16 все', 2, round.peerId, 'late-once'), replay);
  f.db.player(2).kc = 0;
  assert.equal((await f.chat('16 все', 2)).text, '');
  assert.equal(f.db.state.notifications.length, 1);
});

test('close notice created by a late bet is rolled back with the event on database failure', async () => {
  const f = await fixture();
  await f.chat('16 1000');
  f.db.time = new Date(f.round().closesAt);
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.chat('16 все', 2), /Simulated database failure/);
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  assert.equal((await f.chat('16 все', 2)).text, '');
  await settleCasino(f.db);
  assert.equal(f.db.state.notifications.length, 1);
  assert.equal(f.round().stage, 'closed');
});

test('mixed messages omit silent closed lines without hiding a valid bet in another game or adding blank lines', async () => {
  const f = await fixture();
  await f.chat('16 1000');
  f.db.time = new Date(f.round().closesAt);
  const reply = await f.chat('16 все\nкраш 1.7 1000\n16 все', 2);
  assert.equal(reply.text, '✅ [id2|Игрок 2] — 1.000 KC на x1.7');
  assert.equal(f.db.player(2).kc, 9_900_000);
  assert.equal(f.round('crash').total, 100_000);
  assert.equal(f.round().total, 100_000);
  assert.equal(f.db.state.notifications.length, 1);
});
