import { betMaximum } from '../src/services/casino-texts.js';
import { roundKcRatio } from '../src/services/kc-money.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { casinoConfig } from '../src/config/casino.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { betPayout, cachedCasinoRandom, casinoRandom, nextElection, roundKey, selectOutcome, parseCasinoStake, resolveCasinoStake } from '../src/services/casino-rules.js';
import { casinoTexts, coefficient, historyText, roundClosed, winningBet } from '../src/services/casino-texts.js';
import { addCasinoCredit, payCasinoCredit } from '../src/services/casino-credits.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { GameService } from '../src/services/game.js';
import type { CasinoRandom, CasinoRound, DirectorState } from '../src/types/casino.js';
import type { Command, GameInput, RankingMetric } from '../src/types/game.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

async function fixture(random: CasinoRandom = (_purpose, maximum) => maximum - 1, count = 4) {
  const db = new MemoryDatabase();
  let service = new GameService(db, undefined, undefined, undefined, undefined, undefined, random);
  let sequence = 0;
  const send = (command: Command, id = 1, extra: Partial<GameInput> = {}) => service.handle({ eventId: `casino-${sequence++}`, vkId: id, command, ...extra }, async () => `Игрок ${id}`);
  const text = (value: string, id = 1, extra: Partial<GameInput> = {}) => send(parseCommand(value, undefined, extra.isChat ?? false), id, { text: value, ...extra });
  const chat = (value: string, id = 1, peerId = 2_000_000_001, extra: Partial<GameInput> = {}) => text(value, id, { isChat: true, peerId, ...extra });
  for (let id = 1; id <= count; id += 1) {
    await send({ kind: 'profile' }, id);
    db.player(id).kc = 100_000_000;
  }
  const round = (mode: 'crash' | 'dream' = 'crash', peerId = 2_000_000_001): CasinoRound => {
    const record = db.state.casino.get(roundKey(peerId, mode));
    assert.ok(record?.kind === 'round');
    return record;
  };
  const root = (): DirectorState => {
    const record = db.state.casino.get('director');
    assert.ok(record?.kind === 'director');
    return record;
  };
  const acknowledge = () => { for (const notification of db.state.notifications) notification.state = 'sent'; };
  const advance = (ms: number) => { db.time = new Date(db.time.getTime() + ms); };
  const drain = async (steps = 160) => {
    for (let index = 0; index < steps; index += 1) {
      acknowledge();
      const work = await settleCasino(db, random);
      advance(casinoConfig.workerMs);
      if (work === 0 && [...db.state.casino.values()].every(record => record.kind !== 'round' || record.stage === 'finished')) return;
    }
    throw new Error('Casino jobs did not drain');
  };
  const bid = async (value: string, id = 1) => {
    await send({ kind: 'director_bid' }, id);
    const confirmation = await text(value, id);
    assert.ok(confirmation.keyboard.kind === 'director_confirm', confirmation.text);
    return send({ kind: 'director_confirm', token: confirmation.keyboard.token }, id);
  };
  return { db, send, text, chat, root, round, acknowledge, advance, drain, bid, restart: () => { service = new GameService(db, undefined, undefined, undefined, undefined, undefined, random); } };
}

test('all requested leaderboard aliases are chat-only and have no buttons', async () => {
  const { chat, text } = await fixture();
  const aliases: [string, RankingMetric][] = [['Топ', 'kc'], ['Топ бит', 'bitcoin'], ['Топ биткоин', 'bitcoin'], ['Топ вор', 'stolenKC'], ['Топ воров', 'stolenKC'], ['Топ реп', 'reputation'], ['Топ донат', 'euro'], ['Топ евро', 'euro'], ['Топ реф', 'referrals'], ['Топ рефералы', 'referrals'], ['Топ майнинг', 'mining']];
  for (const [alias, metric] of aliases) {
    assert.deepEqual(parseCommand(alias, undefined, true), { kind: 'ranking', metric });
    assert.equal((await chat(alias)).keyboard.kind, 'none');
    assert.equal(parseCommand(alias, undefined, false).kind, 'development');
  }
  assert.equal((await text('Сделать ставку')).keyboard.kind, 'main');
});

test('mixed multiline casino commands validate each line, amounts and exact coefficient bounds', () => {
  const parsed = parseCommand('краш 1.7 100к\nдрим 20 1кк\nкраш 1 1000\nкраш 5000.01 1000\nдрим 3 1000\nкраш 1.1 999', undefined, true);
  assert.ok(parsed.kind === 'casino_bets');
  assert.deepEqual(parsed.lines[0], { mode: 'crash', target: 170, amount: 10_000_000 });
  assert.deepEqual(parsed.lines[1], { mode: 'dream', target: 20, amount: 100_000_000 });
  assert.deepEqual(parsed.lines[2], { error: casinoTexts.crashRange });
  assert.deepEqual(parsed.lines[3], { error: casinoTexts.crashRange });
  assert.deepEqual(parsed.lines[4], { error: casinoTexts.dreamUsage });
  assert.match(JSON.stringify(parsed.lines[5]), /Минимальная ставка/);
  for (const value of ['1.01', '5000', '1,70']) assert.equal(parseCommand(`краш ${value} 1000`, undefined, true).kind, 'casino_bets');
  assert.equal(parseCommand('краш 1.7 1000', undefined, false).kind, 'development');
  assert.equal(parseCommand('дрим 1 1000', undefined, false).kind, 'development');
});

test('crash 97% formula has precise boundaries; independent Dream bonuses can affect every sector', () => {
  assert.equal(selectOutcome('crash', () => 484_999_999, 'test').result, 200);
  assert.equal(selectOutcome('crash', () => 485_000_000, 'test').result, 199);
  assert.equal(selectOutcome('crash', () => 999_999_999, 'test').result, 100);
  assert.equal(selectOutcome('crash', () => 0, 'test').result, 500_000);
  const tickets = [0, 23, 38, 45, 49, 51];
  for (const [index, sector] of casinoConfig.sectors.entries()) {
    const ticket = tickets[index];
    assert.ok(ticket !== undefined);
    for (const [roll, bonus] of [[0, 7], [1, 2], [10, 2], [11, 1], [999, 1]]) {
      assert.ok(roll !== undefined && bonus !== undefined);
      assert.deepEqual(selectOutcome('dream', purpose => purpose.endsWith(':sector') ? ticket : roll, 'test'), { result: sector, bonus });
    }
  }
  assert.equal(betPayout('crash', 100_000, 101, 1), 101_000);
  assert.equal(betPayout('dream', 100_000, 2, 7), 2_100_000);
  assert.equal(betPayout('crash', game.maxAmount, 500_000, 1), null);
  assert.equal(coefficient(191), '1.91');
  assert.equal(coefficient(100), '1');
});

test('cryptographic random bounds and per-transaction randomness caching preserve exact decisions', () => {
  for (const bound of [1, 7, 52, 1000, 2 ** 48, game.maxAmount]) {
    for (let index = 0; index < 20; index += 1) {
      const value = casinoRandom('test', bound);
      assert.ok(Number.isSafeInteger(value) && value >= 0 && value < bound);
    }
  }
  assert.throws(() => casinoRandom('test', 0));
  let calls = 0;
  const random = cachedCasinoRandom(() => calls++);
  assert.equal(random('round', 100), 0);
  assert.equal(random('round', 100), 0);
  assert.equal(calls, 1);
  assert.throws(() => cachedCasinoRandom(() => 100)('invalid', 100));
});

test('ten bets per player and game, mixed lines, additive clocks, durable replay and isolated chats', async () => {
  const f = await fixture();
  const first = await f.chat(Array.from({ length: 9 }, () => 'краш 1.1 1000').join('\n'), 1, 2_000_000_001, { eventId: 'many-bets' });
  assert.equal(first.text.split('\n').filter(line => line.startsWith('✅')).length, 9);
  assert.equal(f.round().closesAt.getTime() - f.db.time.getTime(), 14_000);
  const more = await f.chat('краш 1.2 1000\nкраш 1.2 1000\nдрим 20 1000');
  assert.equal(more.text.split('\n').filter(line => line.startsWith('✅')).length, 2);
  assert.match(more.text, /Не более 10 ставок/);
  assert.equal(f.round().closesAt.getTime() - f.db.time.getTime(), 14_500);
  assert.equal(f.db.player().kc, 100_000_000 - 11 * 100_000);
  f.restart();
  const replay = await f.chat('краш 1.1 1000', 1, 2_000_000_001, { eventId: 'many-bets' });
  assert.equal(replay.randomId, first.randomId);
  assert.equal(f.db.player().kc, 98_900_000);
  assert.match((await f.chat('краш 1.1 1000', 1, 2_000_000_002)).text, /✅/);
  assert.equal(f.round('crash', 2_000_000_002).closesAt.getTime() - f.db.time.getTime(), 10_000);
  await f.chat('краш 1.1 1000', 2);
  assert.equal(f.round().closesAt.getTime() - f.db.time.getTime(), 15_000);
});

test('concurrent independent bet events cannot bypass ten-bet cap or overdraw a wallet', async () => {
  const f = await fixture();
  f.db.player().kc = 2_000_000;
  const replies = await Promise.all(Array.from({ length: 16 }, () => f.chat('краш 1.7 1000')));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 10);
  assert.equal(f.db.player().kc, 1_000_000);
  f.db.player(2).kc = 100_000;
  const poor = await Promise.all(Array.from({ length: 5 }, () => f.chat('дрим 40 1000', 2)));
  assert.equal(poor.filter(reply => reply.text.startsWith('✅')).length, 1);
  assert.equal(f.db.player(2).kc, 0);
});

test('closing notification gates five-second result timer; bets stay closed through delivery of results', async () => {
  const f = await fixture();
  await f.chat('краш 1.7 1000');
  f.advance(10_000);
  assert.equal((await f.chat('краш 1.7 1000')).text, '');
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'closed');
  assert.match(f.db.state.notifications[0]?.text ?? '', /Приём ставок.*Краш/);
  f.advance(10_000);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'closed');
  f.acknowledge();
  f.advance(250);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'waiting');
  f.advance(4999);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'waiting');
  f.advance(1);
  await settleCasino(f.db);
  assert.equal(f.round().stage, 'announcing');
  assert.equal((await f.chat('краш 1.7 1000')).text, '');
  await f.drain();
  assert.equal(f.round().stage, 'finished');
  assert.match((await f.chat('краш 1.7 1000')).text, /^✅/);
});

test('crash winners get stake times target once, dealer gets only losing stakes, director gets all accepted stakes', async () => {
  const f = await fixture((purpose, maximum) => purpose.endsWith(':crash') ? 484_999_999 : maximum - 1);
  await f.send({ kind: 'director_view' });
  f.root().holderId = 3;
  f.db.state.dealer.holderId = 4;
  const initial = f.db.player().kc;
  await f.chat('краш 1.7 1000\nкраш 3 2000');
  assert.equal(f.root().earnedKC, 3000);
  f.advance(10_500);
  await f.drain();
  assert.equal(f.db.player().kc, initial - 300_000 + 170_000);
  assert.equal(f.db.state.dealer.earnedKC, 2000);
  const result = f.db.state.notifications.find(notice => notice._id.startsWith('result:'));
  assert.ok(result);
  assert.match(result.text, /x2/);
  assert.match(result.text, /Приз: 1.700 KC/);
  assert.match(result.text, /Проиграно: 2.000 KC/);
  const before = structuredClone(f.db.state);
  await settleCasino(f.db);
  assert.deepEqual(f.db.state, before);
  assert.equal((await f.chat('лог краш')).text, 'Последние 20 выпавших коэффициентов\n\nx2');
});

test('Dream multiplier seven applies to any winning sector and income does not charge an unsuccessful line', async () => {
  const f = await fixture(purpose => purpose.endsWith(':sector') ? 23 : 0);
  await f.chat('дрим 2 1000\nдрим 40 1000\nдрим 50 1000');
  f.advance(10_500);
  await f.drain();
  assert.equal(f.db.player().kc, 100_000_000 - 200_000 + 2_100_000);
  const result = f.db.state.notifications.find(notice => notice._id.startsWith('result:'));
  assert.ok(result);
  assert.match(result.text, /сектор #2 - множитель 7 - \[x21\]/);
  assert.match(result.text, /Приз: 21.000 KC/);
  assert.match(result.text, /Проиграно: 1.000 KC/);
  assert.match((await f.chat('лог дрим')).text, /множитель х7 - сектор №2 - \[x21\]/);
});

test('payouts survive a full wallet without blocking results, other games or losing their exact amount', async () => {
  const f = await fixture(() => 484_999_999);
  await f.chat('краш 1.7 1000');
  f.db.player().kc = game.maxAmount;
  f.advance(10_000);
  await f.drain();
  const pending = [...f.db.state.casino.values()].find(record => record.kind === 'credit');
  assert.ok(pending?.kind === 'credit');
  assert.equal(pending.stage, 'pending');
  assert.equal(pending.amount, 170_000);
  assert.equal(f.round().stage, 'finished');
  assert.equal(f.db.player().kc, game.maxAmount);
  assert.equal(f.db.state.notifications.filter(notice => notice._id.startsWith('waiting:')).length, 1);
  f.db.player().kc = 0;
  f.advance(60_000);
  await f.drain();
  assert.equal(f.db.player().kc, 170_000);
  await f.drain();
  assert.equal(f.db.player().kc, 170_000);
});

test('bet mutations, fees, round outcome and processed replies roll back together', async () => {
  const f = await fixture();
  await f.send({ kind: 'director_view' });
  f.root().holderId = 3;
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.chat('краш 1.7 1000\nдрим 1 1000'));
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  assert.match((await f.chat('краш 1.7 1000')).text, /^✅/);
});

test('director wizard has payload-only controls, owner-bound tokens, additive stakes and minimum increments', async () => {
  const f = await fixture();
  assert.match((await f.send({ kind: 'city_director' })).text, /Сейчас директор: Государство/);
  await f.send({ kind: 'director_bid' });
  assert.equal((await f.text('999')).text, casinoTexts.directorMinimum);
  const quote = await f.text('1000');
  assert.ok(quote.keyboard.kind === 'director_confirm');
  const token = quote.keyboard.token;
  assert.equal((await f.send({ kind: 'director_confirm', token }, 2)).text, casinoTexts.stale);
  const confirmed = await Promise.all(Array.from({ length: 8 }, () => f.send({ kind: 'director_confirm', token })));
  assert.equal(confirmed.filter(reply => reply.text.startsWith('✅ Вы успешно поставили')).length, 1);
  await f.bid('2000');
  await f.bid('1000', 2);
  const view = await f.send({ kind: 'director_view' });
  assert.match(view.text, /Всего поставлено: 4.000 KC/);
  assert.match(view.text, /Ваша ставка: 3.000 KC \(75,00%\)/);
  assert.equal(f.db.player().kc, 99_700_000);
  for (const keyboard of [{ kind: 'director' }, { kind: 'director_back' }, { kind: 'director_confirm', token }] as const) {
    const value: unknown = JSON.parse(buildKeyboard(keyboard).toString());
    assert.ok(isRecord(value) && Array.isArray(value.buttons));
    for (const row of value.buttons) {
      assert.ok(Array.isArray(row));
      for (const button of row) {
        assert.ok(isRecord(button) && isRecord(button.action) && typeof button.action.payload === 'string');
        const payload: unknown = JSON.parse(button.action.payload);
        assert.ok(isRecord(payload) && typeof payload.command === 'string');
      }
    }
    if (keyboard.kind === 'director_confirm') {
      const buttons = value.buttons[0];
      assert.ok(Array.isArray(buttons));
      assert.ok(isRecord(buttons[0]) && buttons[0].color === 'positive');
      assert.ok(isRecord(buttons[1]) && buttons[1].color === 'negative');
    }
  }
});

test('midnight MSK elections choose weighted winner, refund half to losers, pay old director and fan out once', async () => {
  const f = await fixture(() => 0);
  assert.equal(nextElection(new Date('2026-10-25T20:59:59Z')).toISOString(), '2026-10-25T21:00:00.000Z');
  assert.equal(nextElection(new Date('2026-10-25T21:00:00Z')).toISOString(), '2026-10-26T21:00:00.000Z');
  await f.bid('1000', 1);
  await f.bid('3000', 2);
  f.root().holderId = 3;
  f.root().earnedKC = 12_345;
  await f.db.transaction(async store => {
    for (const peerId of [2_000_000_001, 2_000_000_002]) await store.casinoInsert({ _id: `chat:${peerId}`, version: 0, kind: 'chat', peerId, active: true });
  });
  f.db.time = new Date(f.root().dueAt);
  await f.drain();
  assert.equal(f.root().holderId, 1);
  assert.equal(f.root().total, 0);
  assert.equal(f.db.player(1).kc, 99_900_000);
  assert.equal(f.db.player(2).kc, 99_850_000);
  assert.equal(f.db.player(3).kc, 100_012_300);
  assert.equal(f.db.state.notifications.filter(notice => notice.text.includes('Всего ставок было')).length, 2);
  assert.equal(f.db.state.notifications.filter(notice => notice.text === casinoTexts.winner).length, 1);
  const refund = f.db.state.notifications.find(notice => notice.text.includes('вы проиграли'));
  assert.equal(refund?.peerId, 2);
  assert.match(refund?.text ?? '', /Возвращено: 1.500 KC/);
  assert.match((await f.chat('директор')).text, /^👑 Директор: \[id1\|Игрок 1\]/);
  const before = structuredClone(f.db.state);
  await Promise.all(Array.from({ length: 8 }, () => settleCasino(f.db, () => 0)));
  assert.deepEqual(f.db.state, before);
  f.db.time = new Date(f.root().dueAt);
  await f.drain();
  assert.equal(f.root().holderId, null);
  assert.match((await f.chat('директор')).text, /Государство/);
});

test('stale election confirmation cannot enter a new day or survive navigating away', async () => {
  const f = await fixture();
  await f.send({ kind: 'director_bid' });
  const quote = await f.text('1000');
  assert.ok(quote.keyboard.kind === 'director_confirm');
  const token = quote.keyboard.token;
  f.db.time = new Date(f.root().dueAt);
  assert.equal((await f.send({ kind: 'director_confirm', token })).text, casinoTexts.electionPending);
  await f.drain();
  assert.equal((await f.send({ kind: 'director_confirm', token })).text, casinoTexts.stale);
  assert.equal(f.db.player().kc, 100_000_000);
  await f.send({ kind: 'director_bid' });
  const next = await f.text('1000');
  assert.ok(next.keyboard.kind === 'director_confirm');
  await f.send({ kind: 'menu' });
  assert.equal((await f.send({ kind: 'director_confirm', token: next.keyboard.token })).text, casinoTexts.stale);
});

test('full winnings are paged without losing bets, receipts are bounded and logs keep newest twenty at bottom', async () => {
  const f = await fixture(() => 484_999_999, 6);
  for (let id = 1; id <= 6; id += 1) {
    f.db.player(id).name = '😀'.repeat(20);
    await f.chat(Array.from({ length: 10 }, (_, index) => `краш 1.${String(index + 1).padStart(2, '0')} 1000`).join('\n'), id);
  }
  f.advance(39_500);
  await f.drain();
  const pages = f.db.state.notifications.filter(notice => notice._id.startsWith('result:'));
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.text.length <= game.maxMessageLength && !page.text.startsWith('\n')));
  assert.equal(pages.map(page => page.text).join('').split('— Приз:').length - 1, 60);
  const long = await f.chat(Array.from({ length: 150 }, () => 'краш').join('\n'));
  assert.equal(long.text, '');
  await f.drain();
  const receipts = f.db.state.notifications.filter(notice => notice._id.startsWith('delivery:'));
  assert.ok(receipts.length > 1);
  assert.equal(receipts.map(page => page.text).join('\n').split('\n').length, 150);
  const history = Array.from({ length: 25 }, (_, index) => ({ result: 100 + index, bonus: 1 })).slice(-20);
  const text = historyText('crash', history);
  assert.ok(text.endsWith('x1.24'));
  assert.equal(text.split('\n').length, 22);
});

test('election closing and creation of old director credit are completely rolled back on transaction failure', async () => {
  const f = await fixture(() => 0);
  await f.bid('1000');
  f.root().holderId = 3;
  f.root().earnedKC = 12_345;
  f.db.time = new Date(f.root().dueAt);
  const before = structuredClone(f.db.state);
  await assert.rejects(settleCasino({
    hasPlayer: id => f.db.hasPlayer(id),
    transaction: action => f.db.transaction(async store => {
      await action(store);
      throw new Error('Crash after election decision but before commit');
    })
  }, () => 0));
  assert.deepEqual(f.db.state, before);
  await f.drain();
  assert.equal(f.root().holderId, 1);
  assert.equal(f.db.player(3).kc, 100_012_300);
});

test('oversized maximum payouts are rejected before spending KC or opening rounds', async () => {
  const f = await fixture();
  f.db.player().kc = game.maxAmount;
  const reply = await f.chat('краш 5000 900000000000\nдрим 40 900000000000');
  assert.equal(reply.text, `${betMaximum('crash')}\n${betMaximum('dream')}`);
  assert.equal(f.db.player().kc, game.maxAmount);
  assert.equal([...f.db.state.casino.values()].filter(record => record.kind === 'round').length, 0);
});


test('paying a casino credit and notifying the recipient are atomic and retry without duplication', async () => {
  const f = await fixture();
  await f.db.transaction(store => addCasinoCredit(store, 'atomic-test', 1, 12_345, 'wallet', 'Возврат'));
  const before = structuredClone(f.db.state);
  await assert.rejects(f.db.transaction(async store => {
    assert.equal(await payCasinoCredit(store, f.db.time), true);
    throw new Error('Crash after credit and notification but before commit');
  }));
  assert.deepEqual(f.db.state, before);
  await f.db.transaction(store => payCasinoCredit(store, f.db.time));
  assert.equal(f.db.player().kc, 100_012_300);
  assert.equal(f.db.state.notifications.filter(notice => notice.text === 'Возврат').length, 1);
  assert.equal(await f.db.transaction(store => payCasinoCredit(store, f.db.time)), false);
});

test('completed rounds evict the oldest history entry and retain the new result last', async () => {
  const f = await fixture(() => 484_999_999);
  await f.chat('краш 1.7 1000');
  f.round().history = Array.from({ length: 20 }, (_, index) => ({ result: 100 + index, bonus: 1 }));
  f.advance(10_000);
  await f.drain();
  assert.equal(f.round().history.length, 20);
  assert.equal(f.round().history[0]?.result, 101);
  assert.equal(f.round().history.at(-1)?.result, 200);
  const log = await f.chat('лог краш');
  assert.equal(log.text.split('\n')[2], 'x1.01');
  assert.ok(log.text.endsWith('x2'));
});


test('casino close notices and winning lines have exactly the requested compact spacing', () => {
  assert.equal(roundClosed('crash'), '🎰 Приём ставок для игры "Краш" закрыт.\n🕒 Итоги раунда через 5 секунд…');
  assert.equal(roundClosed('dream'), '🎰 Приём ставок для игры "Дрим" закрыт.\n🕒 Итоги раунда через 5 секунд…');
  const bet = { _id: 'bet:spacing', kind: 'bet', version: 0, roundId: 'spacing', vkId: 1, name: 'Игрок', amount: 100_000, target: 103, settled: true } as const;
  assert.equal(winningBet(bet, 'crash', 103_000), '✅ [id1|Игрок] — 1.000 KC на 1.03\n— Приз: 1.030 KC');
  assert.equal(winningBet({ ...bet, target: 2 }, 'dream', 300_000), '✅ [id1|Игрок] — 1.000 KC на 2\n— Приз: 3.000 KC');
});

test('relative casino stakes parse case-insensitively and half rounds to a whole KC', () => {
  for (const alias of ['пол', 'ПОЛ']) {
    assert.equal(parseCasinoStake(alias), 'half');
    for (const command of ['краш 1.7', 'дрим 20']) {
      const parsed = parseCommand(`${command} ${alias}`, undefined, true);
      assert.ok(parsed.kind === 'casino_bets');
      assert.equal(parsed.lines.length, 1);
      assert.ok(parsed.lines[0] !== undefined && !('error' in parsed.lines[0]));
      assert.equal(parsed.lines[0].amount, 'half');
    }
  }
  for (const alias of ['все', 'всё', 'вб', 'ВСЕ', 'ВСЁ', 'ВБ']) {
    assert.equal(parseCasinoStake(alias), 'all');
    const parsed = parseCommand(`краш 1.7 ${alias}\nдрим 20 ${alias}`, undefined, true);
    assert.ok(parsed.kind === 'casino_bets');
    assert.deepEqual(parsed.lines, [{ mode: 'crash', target: 170, amount: 'all' }, { mode: 'dream', target: 20, amount: 'all' }]);
  }
  assert.equal(resolveCasinoStake('half', 600_001), 300_000);
  assert.equal(resolveCasinoStake('all', 600_001), 600_000);
  assert.equal(resolveCasinoStake('half', game.maxAmount), roundKcRatio(BigInt(game.maxAmount), 2n));
  assert.equal(resolveCasinoStake('all', 0), 0);
  assert.equal(parseCasinoStake('половина'), null);
  assert.throws(() => resolveCasinoStake('half', -1));
});

test('mixed relative bets read each remaining wallet inside the transaction even with detached Mongo-style player reads', async () => {
  const f = await fixture();
  f.db.player().kc = 600_100;
  const service = new GameService({
    hasPlayer: id => f.db.hasPlayer(id),
    transaction: action => f.db.transaction(async store => {
      const originalPlayer = store.player.bind(store);
      store.player = async id => structuredClone(await originalPlayer(id));
      return action(store);
    })
  });
  const input = { eventId: 'relative-wallet', vkId: 1, isChat: true, peerId: 2_000_000_001, command: parseCommand('краш 1.7 пол\nдрим 20 пол\nкраш 1.7 всё\nдрим 1 вб', undefined, true) };
  const reply = await service.handle(input, async () => 'Игрок');
  assert.equal(f.db.player().kc, 0);
  const bets = [...f.db.state.casino.values()].filter(record => record.kind === 'bet');
  assert.deepEqual(bets.map(bet => bet.amount), [300_100, 150_000, 150_000]);
  assert.equal(reply.text.split('\n').filter(line => line.startsWith('✅')).length, 3);
  assert.match(reply.text, /1\.500 KC/);
  assert.match(reply.text.split('\n').at(-1) ?? '', /Минимальная ставка/);
  const repeated = await service.handle(input, async () => 'Игрок');
  assert.equal(repeated.randomId, reply.randomId);
  assert.equal(f.db.player().kc, 0);
});

test('relative amounts retain minimum and overflow checks without spending funds on rejected lines', async () => {
  const f = await fixture();
  f.db.player().kc = 199_800;
  assert.match((await f.chat('краш 1.7 пол')).text, /Минимальная ставка/);
  assert.equal(f.db.player().kc, 199_800);
  assert.match((await f.chat('дрим 20 все')).text, /1\.998 KC/);
  assert.equal(f.db.player().kc, 0);
  assert.match((await f.chat('краш 1.7 вб')).text, /Минимальная ставка/);
  f.db.player(2).kc = game.maxAmount;
  assert.equal((await f.chat('краш 5000 все', 2)).text, betMaximum('crash'));
  assert.equal(f.db.player(2).kc, game.maxAmount);
});

test('concurrent whole-wallet bets cannot spend the same balance twice and failed events roll back resolution', async () => {
  const f = await fixture();
  f.db.player().kc = 600_000;
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.chat('краш 1.7 пол\nдрим 1 все'));
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.chat('краш 1.7 все')));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
  assert.equal(f.db.player().kc, 0);
  assert.equal([...f.db.state.casino.values()].filter(record => record.kind === 'bet').length, 1);
});
