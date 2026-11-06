import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { taskConfig } from '../src/config/tasks.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { settleCasino } from '../src/services/casino-worker.js';
import { maxWholeKc } from '../src/services/kc-money.js';
import { moscowTaskDay, newDailyTasks, progressDailyTask } from '../src/services/tasks.js';
import type { CasinoBet, CasinoMode, CasinoRound } from '../src/types/casino.js';
import type { Command, GameInput } from '../src/types/game.js';
import type { DailyTask, DailyTaskKind } from '../src/types/tasks.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const db = new MemoryDatabase();
  db.time = new Date('2026-11-05T21:00:00.000Z'); // 00:00 Moscow
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, () => 0);
  let sequence = 0;
  const send = (command: Command, vkId = 1, extra: Partial<GameInput> = {}) => service.handle({ eventId: `task-${sequence++}`, vkId, command, ...extra }, async () => `Игрок ${vkId}`);
  const text = (value: string, vkId = 1, extra: Partial<GameInput> = {}) => send({ kind: 'development' }, vkId, { text: value, ...extra });
  for (const id of [1, 2]) await send({ kind: 'profile' }, id);
  return { db, service, send, text };
}

async function seed(db: MemoryDatabase, vkId: number, tasks: DailyTask[], time = db.time) {
  const daily = { ...newDailyTasks(vkId, moscowTaskDay(time), () => 0), tasks };
  await db.transaction(store => store.createDailyTasks(daily));
  return daily;
}
function progress(db: MemoryDatabase, vkId: number, kind: DailyTaskKind, time = db.time): number | undefined {
  return db.state.dailyTasks.get(`${vkId}:${moscowTaskDay(time)}`)?.tasks.find(task => task.kind === kind)?.progress;
}

test('five distinct random tasks are persisted, use varied goals and reset at midnight Moscow time', async () => {
  const first = newDailyTasks(1, '2026-11-06', () => 0);
  const last = newDailyTasks(1, '2026-11-06', maximum => maximum - 1);
  assert.equal(first.tasks.length, 5);
  assert.equal(new Set(first.tasks.map(task => task.kind)).size, 5);
  assert.notDeepEqual(first.tasks, last.tasks);
  assert.ok(first.tasks.filter(task => task.kind.endsWith('_win')).every(task => [10, 12, 15, 20].includes(task.goal)));
  assert.equal(moscowTaskDay(new Date('2026-11-05T20:59:59.999Z')), '2026-11-05');
  assert.equal(moscowTaskDay(new Date('2026-11-05T21:00:00.000Z')), '2026-11-06');
  assert.deepEqual(parseCommand('📍 Задания', { command: 'tasks' }), { kind: 'tasks' });

  const { db, send } = await fixture();
  const screen = await send({ kind: 'tasks' });
  assert.match(screen.text, /^📍 Ваши задания на сегодня:\n\n/u);
  assert.match(screen.text, /💰 Награда за выполнение:\n\n💰 100\.000 KC\n\n💠 100₿$/u);
  assert.equal(screen.keyboard.kind, 'tasks');
  assert.match(buildKeyboard(screen.keyboard).toString(), /↩️ Назад/u);
  const persisted = structuredClone(db.state.dailyTasks.get('1:2026-11-06'));
  assert.equal(persisted?.tasks.length, 5);
  assert.equal(db.player().assignedTasks, 5);
  assert.match((await send({ kind: 'profile' })).text, /💫 Уровень: 1\n👍 Репутация: 0\n🏆 Задания: 0\/5 \[0\.00%\]/u);
  for (let count = 0; count < 5; count += 1) await send({ kind: 'tasks' });
  assert.deepEqual(db.state.dailyTasks.get('1:2026-11-06'), persisted);
  assert.equal(db.player().assignedTasks, 5);
  db.time = new Date('2026-11-06T21:00:00.000Z');
  await send({ kind: 'tasks' });
  assert.equal(db.state.dailyTasks.size, 2);
  assert.equal(db.player().assignedTasks, 10);
  assert.match((await send({ kind: 'profile' })).text, /🏆 Задания: 0\/10 \[0\.00%\]/u);
});

test('real bonus, deposit, director bid, item gift and KC transfer complete tasks and award exactly once, even after a rollback', async () => {
  const { db, send, text } = await fixture();
  db.player().kc = 10_000_000;
  await seed(db, 1, [
    { kind: 'bonus', progress: 0, goal: 4 },
    { kind: 'deposit', progress: 0, goal: 1 },
    { kind: 'director_bid', progress: 0, goal: 1 },
    { kind: 'item_gift', progress: 0, goal: 1 },
    { kind: 'gift_kc', progress: 0, goal: 1_000 * game.kcScale }
  ]);
  await send({ kind: 'bonus' });
  await send({ kind: 'bonus' }); // cooldown must not count
  assert.equal(progress(db, 1, 'bonus'), 1);

  await send({ kind: 'bank_deposit_create' });
  const term = await text('1000');
  assert.equal(term.keyboard.kind, 'bank_deposit_term');
  if (term.keyboard.kind !== 'bank_deposit_term') throw new Error('Missing deposit term');
  await send({ kind: 'bank_deposit_term', days: 3, token: term.keyboard.token });
  assert.equal(progress(db, 1, 'deposit'), 1);
  await send({ kind: 'bank_deposit_term', days: 3, token: term.keyboard.token });
  assert.equal(progress(db, 1, 'deposit'), 1);

  await send({ kind: 'director_bid' });
  const bid = await text('1000');
  assert.equal(bid.keyboard.kind, 'director_confirm');
  if (bid.keyboard.kind !== 'director_confirm') throw new Error('Missing director confirmation');
  await send({ kind: 'director_confirm', token: bid.keyboard.token });
  assert.equal(progress(db, 1, 'director_bid'), 1);

  await db.transaction(async store => { assert.equal(await store.grantItems(1, 'referral_case', 1), true); });
  await send({ kind: 'item_gift', itemKind: 'referral_case' });
  await text('@id2');
  const confirmation = await text('1');
  assert.equal(confirmation.keyboard.kind, 'item_confirmation');
  if (confirmation.keyboard.kind !== 'item_confirmation') throw new Error('Missing gift confirmation');
  await send({ kind: 'item_confirm', token: confirmation.keyboard.token });
  assert.equal(progress(db, 1, 'item_gift'), 1);

  // A 5% fee is deducted; the recipient really receives exactly 1,000 KC.
  await send({ kind: 'bank_transfer', currency: 'kc', target: { kind: 'vk', id: 2 }, amount: 1_053 * game.kcScale }, 1, { isChat: true });
  assert.equal(progress(db, 1, 'gift_kc'), 1_000 * game.kcScale);
  assert.equal(db.player().completedTasks, 4);
  assert.equal(db.player().taskSetsCompleted, undefined);

  for (let index = 0; index < 2; index += 1) {
    db.time = new Date(db.time.getTime() + game.bonusIntervalMs);
    await send({ kind: 'bonus' });
  }
  assert.equal(progress(db, 1, 'bonus'), 3);
  db.time = new Date(db.time.getTime() + game.bonusIntervalMs);
  const before = structuredClone(db.player());
  db.failRemember = true;
  await assert.rejects(send({ kind: 'bonus' }, 1, { eventId: 'final-bonus' }));
  assert.deepEqual(db.player(), before);
  assert.equal(progress(db, 1, 'bonus'), 3);
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.rewarded, false);
  db.failRemember = false;
  await send({ kind: 'bonus' }, 1, { eventId: 'final-bonus' });
  const fourthBonus = game.rewards[3];
  assert.ok(fourthBonus);
  assert.equal(db.player().kc, before.kc + fourthBonus.kc + taskConfig.rewardKC);
  assert.equal(db.player().bitcoin, before.bitcoin + fourthBonus.bitcoin + taskConfig.rewardBitcoin);
  assert.equal(db.player().completedTasks, 5);
  assert.equal(db.player().assignedTasks, 5);
  assert.equal(db.player().taskSetsCompleted, 1);
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.rewarded, true);
  const results = await Promise.all(Array.from({ length: 12 }, () => send({ kind: 'tasks' })));
  assert.ok(results.every(result => result.text === '✅ Вы успешно выполнили все задания!\n\n💰 Награды:\n\n💰 100.000 KC\n\n💠 100₿\n\n💫 +1 уровень'));
  assert.match((await send({ kind: 'profile' })).text, /💫 Уровень: 2\n👍 Репутация: 0\n🏆 Задания: 5\/5 \[100\.00%\]/u);
  assert.equal(db.player().taskSetsCompleted, 1);
  assert.equal(db.player().bitcoin, before.bitcoin + fourthBonus.bitcoin + taskConfig.rewardBitcoin);
});

test('item sale counts only when the buyer completes it, for the seller, not when an offer is created', async () => {
  const { db, send, text } = await fixture();
  await seed(db, 1, [
    { kind: 'item_sale', progress: 0, goal: 1 }, { kind: 'bonus', progress: 0, goal: 4 },
    { kind: 'deposit', progress: 0, goal: 1 }, { kind: 'director_bid', progress: 0, goal: 1 },
    { kind: 'item_gift', progress: 0, goal: 1 }
  ]);
  await db.transaction(async store => { assert.equal(await store.grantItems(1, 'referral_case', 1), true); });
  await send({ kind: 'item_sell', itemKind: 'referral_case' });
  await text('@id2');
  await text('1');
  const confirmation = await text('1000');
  assert.equal(confirmation.keyboard.kind, 'item_confirmation');
  if (confirmation.keyboard.kind !== 'item_confirmation') throw new Error('Missing sale confirmation');
  await send({ kind: 'item_confirm', token: confirmation.keyboard.token });
  const offer = [...db.state.offers.values()][0];
  assert.ok(offer);
  assert.equal(progress(db, 1, 'item_sale'), 0);
  await send({ kind: 'item_buy', offerId: offer._id }, 2); // no funds
  assert.equal(progress(db, 1, 'item_sale'), 0);
  db.player(2).kc = 1000 * game.kcScale;
  await send({ kind: 'item_buy', offerId: offer._id }, 2);
  assert.equal(progress(db, 1, 'item_sale'), 1);
  assert.equal(db.player(1).completedTasks, 1);
  assert.equal(db.state.dailyTasks.has('2:2026-11-06'), false);
  await send({ kind: 'item_buy', offerId: offer._id }, 2);
  assert.equal(db.player(1).completedTasks, 1);
});

function addRound(db: MemoryDatabase, mode: CasinoMode, suffix: string, result: number, targets: number[], closesAt = db.time): void {
  const peerId = 2_000_000_001 + Number(suffix);
  const roundId = `game:test-${mode}-${suffix}`;
  const round: CasinoRound = { _id: `round:${peerId}:${mode}`, kind: 'round', version: 0, peerId, mode, roundId,
    stage: 'settling', dueAt: db.time, closesAt, result, bonus: 1, total: targets.length * 100_000, liability: 10_000_000,
    losses: 0, winners: 0, buffer: '', pages: 0, nextPage: 0, dealerId: null, history: [] };
  db.state.casino.set(round._id, round);
  for (const [index, target] of targets.entries()) {
    const bet: CasinoBet = { _id: `bet:${roundId}:${index}`, kind: 'bet', version: 0, roundId, vkId: 1, name: 'Игрок 1', amount: 100_000, target, settled: false };
    db.state.casino.set(bet._id, bet);
  }
}

test('all four casino wins count once per winning round, not per bet or losing round', async () => {
  const { db } = await fixture();
  await seed(db, 1, [
    { kind: 'roulette_win', progress: 0, goal: 2 }, { kind: 'crash_win', progress: 0, goal: 1 },
    { kind: 'dream_win', progress: 0, goal: 1 }, { kind: 'double_win', progress: 0, goal: 1 },
    { kind: 'bonus', progress: 0, goal: 4 }
  ]);
  addRound(db, 'roulette', '1', 1, [1, 48, 2]); // 1 and red win in one round; 2 loses
  await settleCasino(db, () => 0);
  assert.equal(progress(db, 1, 'roulette_win'), 1);
  addRound(db, 'roulette', '2', 1, [2]);
  await settleCasino(db, () => 0);
  assert.equal(progress(db, 1, 'roulette_win'), 1);
  addRound(db, 'roulette', '3', 1, [1]);
  await settleCasino(db, () => 0);
  assert.equal(progress(db, 1, 'roulette_win'), 2);
  addRound(db, 'crash', '4', 200, [150]);
  addRound(db, 'dream', '5', 2, [2]);
  addRound(db, 'double', '6', 2, [2]);
  await settleCasino(db, () => 0);
  for (const kind of ['crash_win', 'dream_win', 'double_win'] as const) assert.equal(progress(db, 1, kind), 1);
  assert.equal(db.player().completedTasks, 4);
  assert.equal(db.player().taskSetsCompleted, undefined);
});

test('a delayed winning settlement is credited to the day the round closed, not the next Moscow day', async () => {
  const { db } = await fixture();
  const beforeMidnight = new Date('2026-11-05T20:59:59.000Z');
  const quests: DailyTask[] = [{ kind: 'roulette_win', progress: 0, goal: 10 }, { kind: 'crash_win', progress: 0, goal: 10 },
    { kind: 'dream_win', progress: 0, goal: 10 }, { kind: 'double_win', progress: 0, goal: 10 }, { kind: 'bonus', progress: 0, goal: 4 }];
  await seed(db, 1, structuredClone(quests), beforeMidnight);
  await seed(db, 1, structuredClone(quests), db.time);
  addRound(db, 'roulette', '7', 1, [1], beforeMidnight);
  await settleCasino(db, () => 0);
  assert.equal(progress(db, 1, 'roulette_win', beforeMidnight), 1);
  assert.equal(progress(db, 1, 'roulette_win', db.time), 0);
});

test('completed rewards blocked by account limits remain durable across midnight and are paid once later', async () => {
  const { db, send } = await fixture();
  db.player().kc = maxWholeKc;
  db.player().completedTasks = 4;
  await seed(db, 1, [
    { kind: 'bonus', progress: 3, goal: 4 }, { kind: 'deposit', progress: 1, goal: 1 },
    { kind: 'director_bid', progress: 1, goal: 1 }, { kind: 'item_gift', progress: 1, goal: 1 },
    { kind: 'item_sale', progress: 1, goal: 1 }
  ]);
  await db.transaction(store => progressDailyTask(store, 1, 'bonus', db.time));
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.completed, true);
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.rewarded, false);
  assert.equal(db.player().taskSetsCompleted, undefined);
  assert.match((await send({ kind: 'tasks' })).text, /Награда ожидает начисления/u);
  db.time = new Date('2026-11-06T21:00:00.000Z');
  db.player().kc = 0;
  await send({ kind: 'tasks' });
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.rewarded, true);
  assert.equal(db.player().kc, taskConfig.rewardKC);
  assert.equal(db.player().bitcoin, taskConfig.rewardBitcoin);
  assert.equal(db.player().taskSetsCompleted, 1);
  await send({ kind: 'tasks' });
  assert.equal(db.player().kc, taskConfig.rewardKC);
  assert.equal(db.player().taskSetsCompleted, 1);
});

test('extra task examples count a real case opening and both ordinary and ASIC farm starts', async () => {
  const { db, send } = await fixture();
  await seed(db, 1, [
    { kind: 'case_open', progress: 0, goal: 1 }, { kind: 'farm_start', progress: 0, goal: 1 },
    { kind: 'bonus', progress: 0, goal: 4 }, { kind: 'deposit', progress: 0, goal: 1 },
    { kind: 'director_bid', progress: 0, goal: 1 }
  ]);
  await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 }); // no item
  assert.equal(progress(db, 1, 'case_open'), 0);
  await db.transaction(async store => { assert.equal(await store.grantItems(1, 'referral_case', 1), true); });
  await send({ kind: 'item_open', itemKind: 'referral_case', quantity: 1 });
  assert.equal(progress(db, 1, 'case_open'), 1);
  await send({ kind: 'mining_start' });
  assert.equal(progress(db, 1, 'farm_start'), 1);
  await send({ kind: 'mining_start' }); // active farm cannot count twice
  assert.equal(db.player().completedTasks, 2);

  await seed(db, 2, [
    { kind: 'farm_start', progress: 0, goal: 1 }, { kind: 'bonus', progress: 0, goal: 4 },
    { kind: 'deposit', progress: 0, goal: 1 }, { kind: 'director_bid', progress: 0, goal: 1 },
    { kind: 'item_gift', progress: 0, goal: 1 }
  ]);
  await db.transaction(async store => { assert.equal(await store.grantItems(2, 'asic', 1), true); });
  await send({ kind: 'mining_asic' }, 2);
  assert.equal(progress(db, 2, 'farm_start'), 1);
});

test('tasks are assigned on successful activity even before the player opens their list', async () => {
  const { db, send } = await fixture();
  assert.equal(db.state.dailyTasks.size, 0);
  await send({ kind: 'bonus' });
  const daily = structuredClone(db.state.dailyTasks.get('1:2026-11-06'));
  assert.equal(daily?.tasks.length, 5);
  const bonus = daily.tasks.find(task => task.kind === 'bonus');
  if (bonus !== undefined) assert.equal(bonus.progress, 1);
  await send({ kind: 'tasks' });
  assert.deepEqual(db.state.dailyTasks.get('1:2026-11-06'), daily);
});

test('parallel completions and repeated winning-round deliveries cannot duplicate level, task counters or the reward', async () => {
  const { db } = await fixture();
  db.player().completedTasks = 4;
  await seed(db, 1, [
    { kind: 'roulette_win', progress: 0, goal: 1 }, { kind: 'deposit', progress: 1, goal: 1 },
    { kind: 'director_bid', progress: 1, goal: 1 }, { kind: 'item_gift', progress: 1, goal: 1 },
    { kind: 'item_sale', progress: 1, goal: 1 }
  ]);
  await Promise.all(Array.from({ length: 20 }, () => db.transaction(store => progressDailyTask(store, 1, 'roulette_win', db.time, 1, 'same-round'))));
  assert.equal(db.player().kc, taskConfig.rewardKC);
  assert.equal(db.player().bitcoin, taskConfig.rewardBitcoin);
  assert.equal(db.player().taskSetsCompleted, 1);
  assert.equal(db.player().completedTasks, 5);
  assert.equal(db.state.dailyTasks.get('1:2026-11-06')?.rewarded, true);
});
