import assert from 'node:assert/strict';
import { test } from 'node:test';
import { casinoConfig } from '../src/config/casino.js';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { GameService } from '../src/services/game.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { roundKey } from '../src/services/casino-rules.js';
import { betMaximum } from '../src/services/casino-texts.js';
import { settleWinningGroup } from '../src/services/casino-winnings.js';
import { maxWholeKc } from '../src/services/kc-money.js';
import type { CasinoBet, CasinoMode, CasinoRound } from '../src/types/casino.js';
import { MemoryDatabase } from './memory.js';

const modes: { mode: CasinoMode; command: string; other: string; multiplier: number }[] = [
  { mode: 'roulette', command: 'рулетка красное', other: 'рулетка 9', multiplier: 2 },
  { mode: 'dream', command: 'дрим 5', other: 'дрим 2', multiplier: 6 },
  { mode: 'double', command: 'дабл 5', other: 'дабл 2', multiplier: 5 },
  { mode: 'crash', command: 'краш 1.5', other: 'краш 1.7', multiplier: 1.5 }
];
async function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, (purpose, maximum) => {
    if (purpose.endsWith(':roulette')) return 9;
    if (purpose.endsWith(':sector')) return 38;
    if (purpose.endsWith(':double')) return 125;
    if (purpose.endsWith(':crash')) return 484_999_999;
    return maximum - 1;
  });
  let index = 0;
  for (const vkId of [1, 2]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 1_000_000_000;
  }
  const send = (text: string, vkId = 1, peerId = 2_000_000_001, eventId = `policy:${index++}`) => service.handle({ eventId, vkId, peerId, isChat: true, text, command: parseCommand(text, undefined, true) }, async () => 'Игрок');
  const round = (mode: CasinoMode, peerId = 2_000_000_001): CasinoRound => {
    const value = db.state.casino.get(roundKey(peerId, mode));
    assert.ok(value?.kind === 'round');
    return value;
  };
  const drain = async () => {
    const open = [...db.state.casino.values()].filter((value): value is CasinoRound => value.kind === 'round' && value.stage === 'open');
    if (open.length > 0) db.time = new Date(Math.max(db.time.getTime(), ...open.map(value => value.closesAt.getTime())));
    for (let step = 0; step < 200; step += 1) {
      for (const notice of db.state.notifications) notice.state = 'sent';
      await settleCasino(db);
      db.time = new Date(db.time.getTime() + casinoConfig.workerMs);
      if ([...db.state.casino.values()].every(value => value.kind !== 'round' || value.stage === 'finished')) return;
    }
    throw new Error('Casino policy rounds did not finish');
  };
  const result = () => db.state.notifications.filter(value => value._id.startsWith('result:')).map(value => value.text).join('\n');
  const bets = (): CasinoBet[] => [...db.state.casino.values()].filter((value): value is CasinoBet => value.kind === 'bet');
  return { db, send, round, drain, result, bets };
}

test('each casino mode caps the player total at one million across sectors, without charging or extending on rejection', async () => {
  for (const value of modes) {
    const f = await fixture();
    assert.match((await f.send(`${value.command} 600к`)).text, /^✅/u);
    const before = structuredClone(f.round(value.mode));
    const balance = f.db.player().kc;
    assert.equal((await f.send(`${value.other} 450к`)).text, betMaximum(value.mode));
    assert.deepEqual(f.round(value.mode), before);
    assert.equal(f.db.player().kc, balance);
    assert.match((await f.send(`${value.other} 400к`)).text, /^✅/u);
    assert.equal((await f.send(`${value.command} 1000`)).text, betMaximum(value.mode));
    assert.equal(f.round(value.mode).total, 100_000_000);
    assert.equal(f.bets().length, 2);
  }
});

test('round budgets are separate for each player, chat and mode and reset only when the next round opens', async () => {
  const f = await fixture();
  for (const value of modes) assert.match((await f.send(`${value.command} 1кк`)).text, /^✅/u);
  assert.match((await f.send('дабл 5 1кк', 2)).text, /^✅/u);
  assert.match((await f.send('дабл 5 1кк', 1, 2_000_000_002)).text, /^✅/u);
  assert.equal((await f.send('дабл 5 1000')).text, betMaximum('double'));
  const old = f.round('double').roundId;
  await f.drain();
  assert.match((await f.send('дабл 5 1кк')).text, /^✅/u);
  assert.notEqual(f.round('double').roundId, old);
});

test('multiline, relative and replayed stakes all observe the same cumulative round budget', async () => {
  const f = await fixture();
  const reply = await f.send('дабл 5 600к\nдабл 2 600к', 1, 2_000_000_001, 'multiline');
  assert.equal(reply.text, `✅ [id1|Игрок 1] — 600.000 KC на x5 (дабл)\n${betMaximum('double')}`);
  assert.equal(f.db.player().kc, 940_000_000);
  assert.equal((await f.send('дабл 5 600к\nдабл 2 600к', 1, 2_000_000_001, 'multiline')).randomId, reply.randomId);
  f.db.player().kc = 80_000_000;
  assert.match((await f.send('дабл 2 пол')).text, /^✅/u);
  assert.equal(f.round('double').total, 100_000_000);
  assert.equal((await f.send('дабл 2 всё')).text, betMaximum('double'));
  assert.equal(f.db.player().kc, 40_000_000);
});

test('racing bets cannot cross the cap and an aborted receipt consumes neither round budget nor funds', async () => {
  for (const value of modes) {
    const f = await fixture();
    const before = structuredClone(f.db.state);
    f.db.failRemember = true;
    await assert.rejects(f.send(`${value.command} 700к`));
    assert.deepEqual(f.db.state, before);
    f.db.failRemember = false;
    const replies = await Promise.all([f.send(`${value.command} 700к`), f.send(`${value.other} 700к`)]);
    assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
    assert.equal(replies.filter(reply => reply.text === betMaximum(value.mode)).length, 1);
    assert.equal(f.db.player().kc, 930_000_000);
    assert.equal(f.bets().length, 1);
  }
});

test('four identical winning stakes become one result in every mode and never show zero losses', async () => {
  for (const value of modes) {
    const f = await fixture();
    await f.send(Array.from({ length: 4 }, () => `${value.command} 1000`).join('\n'));
    const before = f.db.player().kc;
    await f.drain();
    const text = f.result();
    assert.equal((text.match(/✅/gu) ?? []).length, 1);
    assert.match(text, /— 4\.000 KC на/u);
    assert.equal(text.includes('💰 Проиграно:'), false);
    assert.equal(f.db.player().kc, before + 400_000 * value.multiplier);
    assert.equal(f.round(value.mode).winners, 4);
    assert.equal(f.bets().filter(bet => bet.settled).length, 4);
    assert.equal([...f.db.state.casino.values()].filter(record => record.kind === 'credit' && record.vkId === 1).length, 4);
  }
});

test('different winners or targets remain separate, with no blank line between result blocks', async () => {
  const f = await fixture();
  await f.send('рулетка красное 1000\nрулетка КРАСНОЕ 1000\nрулетка 9 1000');
  await f.send('рулетка красное 1000', 2);
  await f.drain();
  const text = f.result();
  assert.equal((text.match(/✅/gu) ?? []).length, 3);
  assert.match(text, /— 2\.000 KC на красное\n— Приз: 4\.000 KC/u);
  assert.doesNotMatch(text, /— Приз:[^\n]*\n\n✅/u);
  assert.equal((text.match(/\n\n/gu) ?? []).length, 2);
  assert.equal(text.includes('Проиграно:'), false);
});

test('group prizes are the sum of separately rounded payouts, not a recalculated payout on the combined stake', async () => {
  const f = await fixture();
  await f.send('краш 1.5 1001\nкраш 1.5 1001\nкраш 1.5 1001\nкраш 1.5 1001');
  const before = f.db.player().kc;
  await f.drain();
  assert.match(f.result(), /— 4\.004 KC на 1\.5\n— Приз: 6\.008 KC/u);
  assert.equal(f.db.player().kc, before + 600_800);
});

test('group credits and settled flags roll back together and a later retry emits the group only once', async () => {
  const f = await fixture();
  await f.send('дабл 5 1000\nдабл 5 1000\nдабл 5 1000');
  const seed = f.bets()[0];
  assert.ok(seed);
  const before = structuredClone(f.db.state);
  await assert.rejects(f.db.transaction(async store => {
    await settleWinningGroup(store, f.round('double'), seed);
    throw new Error('Rollback grouped winners');
  }), /Rollback grouped winners/u);
  assert.deepEqual(f.db.state, before);
  await f.drain();
  assert.equal((f.result().match(/— Приз:/gu) ?? []).length, 1);
  const balance = f.db.player().kc;
  await f.drain();
  assert.equal(f.db.player().kc, balance);
});

test('new budget checks do not invalidate older accepted stakes above the cap', async () => {
  const f = await fixture();
  await f.send('рулетка красное 1000\nрулетка красное 1000');
  for (const bet of f.bets()) bet.amount = 100_000_000;
  const round = f.round('roulette');
  round.total = 200_000_000;
  round.liability = 400_000_000;
  f.db.player().kc = 800_000_000;
  assert.equal((await f.send('рулетка красное 1000')).text, betMaximum('roulette'));
  await f.drain();
  assert.match(f.result(), /— 2\.000\.000 KC на красное\n— Приз: 4\.000\.000 KC/u);
  assert.equal(f.db.player().kc, 1_200_000_000);
});

test('grouped winners retain individual durable payouts when a full wallet temporarily blocks payment', async () => {
  const f = await fixture();
  await f.send('дабл 5 1000\nдабл 5 1000');
  f.db.player().kc = maxWholeKc;
  await f.drain();
  assert.match(f.result(), /— 2\.000 KC на 5\n— Приз: 10\.000 KC/u);
  assert.equal(f.db.player().kc, maxWholeKc);
  const pending = [...f.db.state.casino.values()].filter(value => value.kind === 'credit' && value.stage === 'pending');
  assert.equal(pending.length, 2);
  f.db.player().kc = 0;
  f.db.time = new Date(f.db.time.getTime() + casinoConfig.retryMs);
  await settleCasino(f.db);
  assert.equal(f.db.player().kc, 10_000 * game.kcScale);
});
