import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doubleConfig, doublePhotos } from '../src/config/double.js';
import { casinoConfig } from '../src/config/casino.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { selectOutcome, roundKey, closeKey, betPayout } from '../src/services/casino-rules.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { betMaximum, betMinimum, casinoTexts, roundClosed, historyText } from '../src/services/casino-texts.js';
import type { CasinoMode, CasinoRound } from '../src/types/casino.js';
import type { Notification } from '../src/types/game.js';
import { MemoryDatabase } from './memory.js';

async function fixture(ticket = 125) {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, (purpose, maximum) => purpose.endsWith(':double') ? ticket : maximum - 1);
  let index = 0;
  for (const vkId of [1, 2]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 1_000_000_000;
  }
  const send = (text: string, vkId = 1, eventId = `double:${index++}`, peerId = 2_000_000_001) => service.handle({ eventId, vkId, peerId, isChat: true, text, command: parseCommand(text, undefined, true) }, async () => 'Игрок');
  const round = (mode: CasinoMode = 'double', peerId = 2_000_000_001): CasinoRound => {
    const value = db.state.casino.get(roundKey(peerId, mode));
    assert.ok(value?.kind === 'round');
    return value;
  };
  const drain = async () => {
    for (let index = 0; index < 200; index += 1) {
      for (const notice of db.state.notifications) notice.state = 'sent';
      await settleCasino(db);
      db.time = new Date(db.time.getTime() + 250);
      if ([...db.state.casino.values()].every(value => value.kind !== 'round' || value.stage === 'finished')) return;
    }
    throw new Error('Double did not settle');
  };
  const results = (): Notification[] => db.state.notifications.filter(notice => notice._id.startsWith('result:'));
  return { db, send, round, drain, results };
}

test('double parses only the four approved sectors, KC shorthand and relative stakes, without adding a text button alias', () => {
  assert.deepEqual(parseCommand('дабл 50 100к', undefined, true), { kind: 'casino_bets', lines: [{ mode: 'double', target: 50, amount: 10_000_000 }] });
  assert.deepEqual(parseCommand('ДАБЛ 2 пол', undefined, true), { kind: 'casino_bets', lines: [{ mode: 'double', target: 2, amount: 'half' }] });
  for (const text of ['дабл', 'дабл 4 1000', 'дабл x3 1000', 'дабл 3', 'дабл 2 1000 extra', 'дабл -2 1000']) {
    assert.deepEqual(parseCommand(text, undefined, true), { kind: 'casino_bets', lines: [{ error: '⛔️ Использование: дабл <сектор> <ставка>' }] });
  }
  assert.equal(parseCommand('дабл 2 1000', undefined).kind, 'development');
});

test('double uses exactly 158 tickets with approved weights and returns the complete multiplied stake', () => {
  const counts = new Map<number, number>();
  for (let ticket = 0; ticket < doubleConfig.tickets; ticket += 1) {
    const selected = selectOutcome('double', (purpose, maximum) => { assert.equal(maximum, 158); assert.match(purpose, /:double$/u); return ticket; }, 'round');
    assert.equal(selected.bonus, 1);
    counts.set(selected.result, (counts.get(selected.result) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { 2: 75, 3: 50, 5: 30, 50: 3 });
  for (const target of doubleConfig.sectors) assert.equal(betPayout('double', 100_000, target, 1), 100_000 * target);
});

test('double minimum, maximum and funds errors are exact and do not debit or open an empty round', async () => {
  const f = await fixture();
  assert.equal((await f.send('дабл 5 999')).text, betMinimum('double'));
  assert.equal((await f.send('дабл 5 1000001')).text, '💰 Максимальная ставка в режиме «Дабл» — 1.000.000 KC');
  assert.equal((await f.send('дабл 5 90071992547410')).text, betMaximum('double'));
  f.db.player().kc = 99_900;
  assert.equal((await f.send('дабл 5 1000')).text, '💰 Недостаточно средств.');
  assert.equal(f.db.player().kc, 99_900);
  assert.equal([...f.db.state.casino.values()].some(value => value.kind === 'round'), false);
});

test('all four modes enforce the million-KC cap including half/all stakes, and crash already permits at most ten bets', async () => {
  for (const [mode, text] of [['roulette', 'рулетка 2'], ['dream', 'дрим 5'], ['crash', 'краш 2'], ['double', 'дабл 2']]) {
    assert.ok(mode === 'roulette' || mode === 'dream' || mode === 'crash' || mode === 'double');
    const f = await fixture();
    assert.equal((await f.send(`${text} все`)).text, betMaximum(mode));
    assert.equal((await f.send(`${text} пол`)).text, betMaximum(mode));
    assert.match((await f.send(`${text} 1000000`)).text, /✅/u);
  }
  const f = await fixture();
  for (let index = 0; index < 10; index += 1) assert.match((await f.send('краш 2 1000')).text, /✅/u);
  const before = f.db.player().kc;
  assert.equal((await f.send('краш 2 1000')).text, '💰 Не более 10 ставок в режиме «Краш».');
  assert.equal(f.db.player().kc, before);
});

test('double accepts the exact receipt, ten-bet cap, replay-safe debit and isolated chat/mode deadlines', async () => {
  const f = await fixture();
  const first = await f.send('дабл 5 1000', 1, 'once');
  assert.equal(first.text, '✅ [id1|Игрок 1] — 1.000 KC на x5 (дабл)');
  const closes = f.round().closesAt.getTime();
  const before = f.db.player().kc;
  assert.equal((await f.send('дабл 5 1000', 1, 'once')).randomId, first.randomId);
  assert.equal(f.db.player().kc, before);
  assert.equal(f.round().closesAt.getTime(), closes);
  await f.send('дабл 2 1000');
  assert.equal(f.round().closesAt.getTime(), closes + casinoConfig.extensionMs);
  await f.send('рулетка 2 1000');
  await f.send('дабл 3 1000', 2, 'other-chat', 2_000_000_002);
  assert.equal(f.round().closesAt.getTime(), closes + casinoConfig.extensionMs);
  for (let index = 2; index < 10; index += 1) await f.send('дабл 2 1000');
  const afterTen = f.db.player().kc;
  assert.equal((await f.send('дабл 2 1000')).text, '💰 Не более 10 ставок в режиме «Дабл».');
  assert.equal(f.db.player().kc, afterTen);
});

test('double late bets are silent and debit nothing, share one close record, and retain delivery-gated results', async () => {
  const f = await fixture();
  await f.send('дабл 5 1000');
  f.db.time = f.round().closesAt;
  const before = f.db.player().kc;
  await Promise.all([f.send('дабл 3 1000'), settleCasino(f.db), f.send('дабл 5 все')]);
  assert.equal(f.db.player().kc, before);
  assert.equal(f.db.state.notifications.filter(notice => notice._id === closeKey(f.round())).length, 1);
  assert.equal(f.db.state.notifications.find(notice => notice._id === closeKey(f.round()))?.text, '🎰 Приём ставок для игры "Дабл" закрыт.\n🕒 Итоги раунда через 5 секунд...');
  f.db.time = new Date(f.db.time.getTime() + 60_000);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'closed');
  for (const notice of f.db.state.notifications) notice.state = 'sent';
  f.db.time = new Date(f.db.time.getTime() + 250);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'waiting');
  assert.equal(f.round().dueAt.getTime(), f.db.time.getTime() + 5000);
  assert.equal((await f.send('дабл 2 1000')).text, '');
});

test('winning double results have exactly the requested layout, correct credits, loss total and cached-photo source', async () => {
  const f = await fixture();
  await f.send('дабл 5 1000\nдабл 2 2000');
  const balance = f.db.player().kc;
  f.db.time = f.round().closesAt;
  await f.drain();
  assert.equal(f.db.player().kc, balance + 500_000);
  assert.equal(f.results()[0]?.text, '↔️ Итоги игры "Дабл":\n\n💸 Выпал множитель x5\n\n✅ [id1|Игрок 1] — 1.000 KC на 5\n— Приз: 5.000 KC\n\n💰 Проиграно: 2.000 KC');
  assert.equal(f.results()[0]?.photoUrl, doublePhotos[5]);
  assert.equal(f.results()[0]?.roulettePhoto, undefined);
  const after = f.db.player().kc;
  await f.drain();
  assert.equal(f.db.player().kc, after);
});

test('losing double result has no phantom prize, exact blank lines, and x50 photo', async () => {
  const f = await fixture(157);
  await f.send('дабл 2 1000\nдабл 3 1000');
  f.db.time = f.round().closesAt;
  await f.drain();
  assert.equal(f.results()[0]?.text, '↔️ Итоги игры "Дабл":\n\n💸 Выпал множитель x50\n\n❌ Все ставки проиграли!\n\n💰 Проиграно: 2.000 KC');
  assert.equal(f.results()[0]?.photoUrl, doublePhotos[50]);
});

test('failed receipts roll back stake/round/director changes and mixed lines include the exact funds text', async () => {
  const f = await fixture();
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.send('дабл 5 1000'));
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  f.db.player().kc = 150_000;
  assert.equal((await f.send('дабл 5 1000\nрулетка 2 1000')).text, '✅ [id1|Игрок 1] — 1.000 KC на x5 (дабл)\n💰 Недостаточно средств.');
  assert.equal(casinoTexts.funds, '💰 Недостаточно средств.');
  assert.equal(roundClosed('double').includes('\n\n'), false);
});


test('double history command is chat-only and preserves the other three log commands', () => {
  for (const text of ['лог дабл', '  ЛОГ ДАБЛ  ']) assert.deepEqual(parseCommand(text, undefined, true), { kind: 'casino_log', mode: 'double' });
  for (const [text, mode] of [['лог краш', 'crash'], ['лог дрим', 'dream'], ['лог рулетка', 'roulette']]) {
    assert.deepEqual(parseCommand(text, undefined, true), { kind: 'casino_log', mode });
  }
  for (const text of ['лог дабл', 'лог дабл лишнее']) assert.equal(parseCommand(text, undefined).kind, 'development');
  assert.equal(parseCommand('лог дабл лишнее', undefined, true).kind, 'development');
});

test('double log renders the exact compact multiplier list, limits it to twenty and keeps newest last', () => {
  const results = [5, 2, 2, 2, 50, 3, 3, 3, 3, 2, 3, 2, 3, 50, 2, 2, 3, 50, 3, 2];
  const history = results.map(result => ({ result, bonus: 1 }));
  const expected = `Последние 20 выпавших множителей\n\n${results.map(result => `x${result}`).join('\n')}`;
  assert.equal(historyText('double', history), expected);
  assert.equal(historyText('double', [{ result: 50, bonus: 1 }, ...history]), expected);
  assert.equal(historyText('double', []).split('\n\n').length, 2);
  assert.equal(historyText('double', []), 'Последние 20 выпавших множителей\n\nПока нет завершённых раундов.');
  assert.equal(history.length, 20);
});

test('double log reads persisted completed rounds without changing money or timers and appends a new result at the bottom', async () => {
  const f = await fixture();
  assert.equal((await f.send('лог дабл')).text, 'Последние 20 выпавших множителей\n\nПока нет завершённых раундов.');
  assert.match((await f.send('дабл 5 1000')).text, /^✅/u);
  const results = [5, 2, 2, 2, 50, 3, 3, 3, 3, 2, 3, 2, 3, 50, 2, 2, 3, 50, 3, 2];
  f.round().history = results.map(result => ({ result, bonus: 1 }));
  const before = structuredClone(f.round());
  const balance = f.db.player().kc;
  const read = await f.send('лог дабл', 1, 'double-log');
  assert.equal(read.text, historyText('double', before.history));
  assert.deepEqual(read.keyboard, { kind: 'none' });
  assert.deepEqual(f.round(), before);
  assert.equal(f.db.player().kc, balance);
  assert.equal((await f.send('лог дабл', 1, 'double-log')).randomId, read.randomId);
  assert.equal((await f.send('лог дабл', 2)).text, read.text);
  assert.equal((await f.send('лог дабл', 1, 'other-double-log', 2_000_000_002)).text, historyText('double', []));
  assert.equal((await f.send('лог дрим')).text, historyText('dream', []));
  f.db.time = new Date(before.closesAt);
  await f.drain();
  assert.deepEqual(f.round().history, [...before.history.slice(1), { result: 5, bonus: 1 }]);
  const logged = await f.send('лог дабл');
  assert.equal(logged.text, historyText('double', f.round().history));
  assert.equal(logged.text.split('\n').length, 22);
  assert.ok(logged.text.endsWith('x2\nx5'));
  const restarted = new GameService(f.db);
  const reply = await restarted.handle({ eventId: 'restarted-double-log', vkId: 1, peerId: 2_000_000_001, isChat: true, command: parseCommand('лог дабл', undefined, true) }, async () => 'Игрок');
  assert.equal(reply.text, logged.text);
});
