import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseCommand, parseReferrer } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { initialFarm, nextUpgradeCost, randomMiningIncrease, settleFarm } from '../src/services/mining.js';
import { rankingScore } from '../src/services/rankings.js';
import { formatMining, labels, miningWithdrawalText, rankEmoji, texts } from '../src/services/texts.js';
import type { Command, GameInput, InventoryItem, MiningFarm, RankingMetric } from '../src/types/game.js';
import { MemoryDatabase } from './memory.js';

async function fixture() {
  const database = new MemoryDatabase();
  let shortened = 0;
  const service = new GameService(database, async vkId => {
    shortened += 1;
    return `https://vk.cc/link${vkId}`;
  });
  let sequence = 0;
  const send = (command: Command, vkId = 1, options: Partial<Omit<GameInput, 'command' | 'vkId'>> = {}) => service.handle({
    eventId: `systems-${sequence++}`, command, vkId, ...options
  }, async () => `Игрок ${vkId}`);
  await send({ kind: 'profile' });
  const farm = (): MiningFarm => {
    const value = database.player().mining;
    assert.ok(value);
    return value;
  };
  return { database, service, send, farm, shortened: () => shortened };
}

test('farm starts disabled with exact initial rate and a six-hour session', async () => {
  const { send, farm, database } = await fixture();
  assert.equal((await send({ kind: 'mining' })).text,
    '📼 Ваша майнинг-ферма:\n💡 Статус: Выключена\n\n⛏️ Добыча: 0,100₿/час\n💠 Баланс: 0,000₿');
  assert.equal((await send({ kind: 'mining_start' })).text, texts.miningStarted);
  const started = farm().activeUntil.getTime();
  assert.equal(started - database.time.getTime(), game.mining.durationMs);
  assert.equal((await send({ kind: 'mining_start' })).text, texts.miningAlreadyStarted);
  assert.equal(farm().activeUntil.getTime(), started);
  assert.match((await send({ kind: 'mining' })).text, /Включена\n\n.*\n.*\n⏳ Осталось 6 ч. 0 мин. 0 сек\./);
});

test('mining accrual stops exactly at six hours and is unaffected by restart or views', async () => {
  const { send, farm, database, service } = await fixture();
  await send({ kind: 'mining_start' });
  const snapshot = structuredClone(farm());
  database.time = new Date(database.time.getTime() + game.mining.durationMs);
  const input = { eventId: 'expired-farm', vkId: 1, command: { kind: 'mining' } } as const;
  const reply = await service.handle(input, async () => 'Игрок');
  assert.match(reply.text, /Выключена/);
  assert.match(reply.text, /Баланс: 0,600₿/);
  assert.deepEqual(farm(), snapshot);
  database.time = new Date(database.time.getTime() + 10 * game.mining.durationMs);
  assert.equal((await new GameService(database).handle({ ...input, eventId: 'restart-view' }, async () => 'Игрок')).text, reply.text);
  await send({ kind: 'mining_start' });
  assert.equal(farm().balance, 60_000_000);
});

test('withdrawal threshold, repeated clicks and parallel calls never duplicate mining income', async () => {
  const { send, farm, database } = await fixture();
  await send({ kind: 'mining_start' });
  database.time = new Date(database.time.getTime() + game.mining.durationMs);
  assert.equal((await send({ kind: 'mining_withdraw' })).text, texts.miningEmpty);
  await send({ kind: 'mining_start' });
  database.time = new Date(database.time.getTime() + game.mining.durationMs);
  const replies = await Promise.all(Array.from({ length: 12 }, () => send({ kind: 'mining_withdraw' })));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
  assert.equal(database.player().bitcoin, 120_000_000);
  assert.equal(farm().balance, 0);
  assert.equal((await send({ kind: 'mining_withdraw' })).text, texts.miningEmpty);
});

test('upgrades spend profile bitcoins once per offer and preserve accrued income at the old rate', async () => {
  const { send, farm, database } = await fixture();
  database.player().bitcoin = 1_000_000;
  await send({ kind: 'mining_start' });
  database.time = new Date(database.time.getTime() + game.mining.hourMs);
  const expires = farm().activeUntil.getTime();
  const offer = await send({ kind: 'mining_upgrade' });
  assert.equal(offer.text, '💡 Улучшение фермы стоит 0,002₿.');
  assert.deepEqual(offer.keyboard, { kind: 'mining_upgrade', level: 0 });
  const replies = await Promise.all(Array.from({ length: 10 }, () => send({ kind: 'mining_confirm', level: 0 })));
  assert.equal(replies.filter(reply => reply.text.startsWith('✅')).length, 1);
  assert.equal(database.player().bitcoin, 800_000);
  assert.equal(farm().balance, game.mining.initialRate);
  assert.equal(farm().activeUntil.getTime(), expires);
  assert.equal(farm().level, 1);
  assert.equal(farm().upgradeCost, 500_000);
  assert.ok(farm().rate >= 11_500_000 && farm().rate <= 18_000_000);
  const rate = farm().rate;
  database.time = new Date(database.time.getTime() + game.mining.hourMs);
  assert.equal(settleFarm(farm(), database.time).balance, game.mining.initialRate + rate);
});

test('upgrade and withdrawal roll back all mutations when recording the event fails', async () => {
  const { send, farm, database } = await fixture();
  database.player().bitcoin = 1_000_000;
  const before = structuredClone(database.player());
  database.failRemember = true;
  await assert.rejects(send({ kind: 'mining_confirm', level: 0 }));
  assert.deepEqual(database.player(), before);
  database.failRemember = false;
  farm().balance = 100_000_001;
  const beforeWithdrawal = structuredClone(database.player());
  database.failRemember = true;
  await assert.rejects(send({ kind: 'mining_withdraw' }));
  assert.deepEqual(database.player(), beforeWithdrawal);
});

test('insufficient resources, stale confirmations, malformed levels and overflow cannot modify a farm', async () => {
  const { send, farm, database } = await fixture();
  assert.equal((await send({ kind: 'mining_confirm', level: 0 })).text, texts.miningInsufficient);
  for (const level of [-1, 0.5, NaN, Infinity, 2]) {
    assert.equal((await send({ kind: 'mining_confirm', level })).text, texts.miningStaleOffer);
  }
  farm().balance = game.mining.minWithdrawal;
  database.player().bitcoin = game.maxAmount;
  assert.equal((await send({ kind: 'mining_withdraw' })).text, texts.miningLimit);
  assert.equal(farm().balance, game.mining.minWithdrawal);
  assert.equal(database.player().bitcoin, game.maxAmount);
});

test('integer accrual carries fractional satoshis without multiplying income on repeated settlement', () => {
  let farm = { ...initialFarm(), rate: 1, updatedAt: new Date(0), activeUntil: new Date(game.mining.hourMs) };
  for (let second = 1; second <= 3600; second += 1) {
    farm = settleFarm(farm, new Date(second * 1000));
  }
  assert.equal(farm.balance, 1);
  assert.equal(farm.remainder, 0);
  const capped = settleFarm({ ...farm, rate: game.maxAmount, balance: game.maxAmount - 1,
    updatedAt: new Date(0), activeUntil: new Date(game.mining.hourMs) }, new Date(game.mining.hourMs));
  assert.equal(capped.balance, game.maxAmount);
  assert.equal(capped.remainder, 0);
});

test('upgrade costs follow the complete requested table and then grow with exact upward rounding', () => {
  const prices = [0.002, 0.005, 0.008, 0.014, 0.023, 0.033, 0.041, 0.049, 0.059, 0.078, 0.098, 0.109, 0.127, 0.142, 0.17, 0.203];
  assert.deepEqual(game.mining.prices.map(value => value / game.bitcoinScale), prices);
  assert.equal(nextUpgradeCost(15, 20_300_000), 24_400_000);
  assert.equal(nextUpgradeCost(16, 24_400_000), 29_300_000);
  assert.equal(nextUpgradeCost(17, 29_300_000), 35_200_000);
  assert.equal(nextUpgradeCost(1000, game.maxAmount), null);
  for (let index = 0; index < 1000; index += 1) {
    const increase = randomMiningIncrease();
    assert.ok(Number.isSafeInteger(increase));
    assert.ok(increase >= game.mining.minIncrease && increase <= game.mining.maxIncrease);
    assert.equal(increase % game.mining.precision, 0);
  }
  assert.equal(formatMining(1), '0,000');
  assert.equal(formatMining(55_704_00000), '55,704');
});

test('referral registration awards one case and 15000 KC, with one durable notification and a normal welcome', async () => {
  const { send, database } = await fixture();
  const options = { referrerId: 1, eventId: 'referred-2' };
  const replies = await Promise.all(Array.from({ length: 10 }, () => send({ kind: 'profile' }, 2, options)));
  assert.ok(replies.every(reply => reply.text === texts.welcome));
  assert.equal(database.player().kc, 1_500_000);
  assert.equal(database.player().referrals, 1);
  assert.equal(database.player(2).kc, 0);
  assert.deepEqual(database.state.items, [{ _id: '1:1', vkId: 1, itemId: 1, kind: 'referral_case' }]);
  assert.equal(database.state.notifications.length, 1);
  assert.equal(database.state.notifications[0]?.peerId, 1);
  assert.match(database.state.notifications[0]?.text ?? '', /15\.000 KC/);
  assert.match(database.state.notifications[0]?.text ?? '', /Кейс «Реферальный» \(1 шт\.\)/);
  await send({ kind: 'profile' }, 2, { referrerId: 1 });
  assert.equal(database.player().referrals, 1);
});

test('self-referrals, nonexistent inviters and referral changes on existing accounts earn nothing', async () => {
  const { send, database } = await fixture();
  await send({ kind: 'profile' }, 2, { referrerId: 2 });
  await send({ kind: 'profile' }, 3, { referrerId: 999 });
  await send({ kind: 'profile' }, 1, { referrerId: 2 });
  assert.equal(database.state.notifications.length, 0);
  assert.equal(database.state.items.length, 0);
  assert.equal(database.player(1).referrals, 0);
  assert.equal(database.player(2).referrals, 0);
});

test('referral reward, registration, account ID, inventory ID and notification all roll back together', async () => {
  const { send, database } = await fixture();
  const before = structuredClone(database.state);
  database.failRemember = true;
  await assert.rejects(send({ kind: 'profile' }, 2, { referrerId: 1, eventId: 'ref-failure' }));
  assert.deepEqual(database.state, before);
  database.failRemember = false;
  await send({ kind: 'profile' }, 2, { referrerId: 1, eventId: 'ref-failure' });
  assert.equal(database.player(2).accountId, 1);
  assert.equal(database.player().nextItemId, 2);
  assert.equal(database.state.notifications.length, 1);
});

test('referral upper bounds never leave a registration with a partial reward', async () => {
  const { send, database } = await fixture();
  database.player().kc = game.maxAmount;
  await assert.rejects(send({ kind: 'profile' }, 2, { referrerId: 1 }));
  assert.equal(database.state.players.has(2), false);
  assert.equal(database.state.notifications.length, 0);
  assert.equal(database.state.items.length, 0);
});

test('short referral link is cached and existing users never request a new link', async () => {
  const { send, database, shortened } = await fixture();
  const first = await send({ kind: 'referrals' });
  assert.equal(first.text, '👬 Приглашайте друзей и получайте награды!\n\n🔗 Ссылка для приглашения: https://vk.cc/link1\nВы уже пригласили игроков: 0');
  assert.equal(database.player().referralUrl, 'https://vk.cc/link1');
  assert.equal(shortened(), 1);
  assert.equal((await send({ kind: 'referrals' })).text, first.text);
  assert.equal(shortened(), 1);
});

test('ranking returns 20 entries and the caller’s actual place, with deterministic ties', async () => {
  const { send, database } = await fixture();
  for (let id = 2; id <= 25; id += 1) {
    await send({ kind: 'profile' }, id);
    database.player(id).kc = id * game.kcScale;
  }
  const reply = await send({ kind: 'ranking', metric: 'kc' });
  assert.match(reply.text, /^💰 Топ игроков по балансу:/);
  assert.match(reply.text, /1️⃣ \[id25\|Игрок 25\] — 25 KC/);
  assert.match(reply.text, /2️⃣0️⃣ \[id6\|Игрок 6\] — 6 KC/);
  assert.match(reply.text, /➡2️⃣5️⃣ \[id1\|Игрок 1\] — 0 KC$/);
  database.player(2).kc = 0;
  const tied = await send({ kind: 'ranking', metric: 'kc' });
  assert.match(tied.text, /➡2️⃣4️⃣ \[id1/);
  for (const metric of ['bitcoin', 'mining', 'euro', 'referrals', 'reputation', 'stolenKC'] satisfies RankingMetric[]) {
    const ranking = await send({ kind: 'ranking', metric });
    assert.equal(ranking.keyboard.kind, 'ranking');
    assert.match(ranking.text, /➡1️⃣ \[id1/);
  }
  assert.equal(rankEmoji(20), '2️⃣0️⃣');
  assert.equal(rankingScore(database.player(), 'mining'), game.mining.initialRate);
});

test('chat aliases have no keyboard and show every inventory stack with full totals', async () => {
  const { send, database } = await fixture();
  database.state.items = Array.from({ length: 12 }, (_, index): InventoryItem => ({
    _id: `1:${index + 1}`, vkId: 1, itemId: index + 1, kind: index % 2 === 0 ? 'zhdun_case' : 'referral_case'
  }));
  const profile = await send({ kind: 'profile' }, 1, { isChat: true });
  assert.deepEqual(profile.keyboard, { kind: 'none' });
  assert.equal(profile.text.includes('\n\n'), false);
  const inventory = await send({ kind: 'inventory', page: 0 }, 1, { isChat: true });
  assert.deepEqual(inventory.keyboard, { kind: 'none' });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (6 шт.)\n🆔 2 — 👬 Кейс «Реферальный» (6 шт.)');
  const personal = await send({ kind: 'inventory', page: 0 });
  assert.equal(personal.keyboard.kind, 'inventory');
  assert.equal(personal.text, inventory.text);
  assert.deepEqual(personal.keyboard, { kind: 'inventory', page: 0, itemIds: [1, 2], hasNext: false });
});

test('large stacks fit in one chat message without truncation or loss of units', async () => {
  const { send, database } = await fixture();
  database.state.items = Array.from({ length: 300 }, (_, index) => ({
    _id: `1:${index + 1}`, vkId: 1, itemId: index + 1, kind: 'zhdun_case'
  }));
  const inventory = await send({ kind: 'inventory', page: 0 }, 1, { isChat: true });
  assert.equal(inventory.text, '🎒 Ваш инвентарь:\n\n🆔 1 — 💼 Кейс «Ждун» (300 шт.)');
  assert.deepEqual(inventory.keyboard, { kind: 'none' });
  assert.equal(database.state.items.length, 300);
});

test('navigation and payload validation distinguish mining from mining rankings and block text-only confirmation', () => {
  assert.deepEqual(parseCommand(labels.mining, undefined), { kind: 'development' });
  assert.deepEqual(parseCommand(labels.mining, { command: 'ranking', metric: 'mining' }), { kind: 'ranking', metric: 'mining' });
  assert.deepEqual(parseCommand(labels.back, { command: 'menu' }), { kind: 'menu' });
  assert.deepEqual(parseCommand(labels.upgradeBack, { command: 'mining' }), { kind: 'mining' });
  assert.deepEqual(parseCommand(labels.confirm, { command: 'mining_confirm', level: 0 }), { kind: 'mining_confirm', level: 0 });
  assert.deepEqual(parseCommand(labels.confirm, undefined), { kind: 'development' });
  for (const level of [-1, 0.5, Infinity, NaN, game.maxAmount, '0']) {
    assert.deepEqual(parseCommand(labels.confirm, { command: 'mining_confirm', level }), { kind: 'development' });
  }
  assert.deepEqual(parseCommand('я', undefined, true), { kind: 'profile' });
  assert.deepEqual(parseCommand('я', undefined), { kind: 'development' });
  for (const text of ['и', 'инв', 'инвентарь', ' ИНВ ']) {
    assert.deepEqual(parseCommand(text, undefined, true), { kind: 'inventory', page: 0 });
  }
  assert.equal(parseReferrer('kreox_12', 1), 12);
  for (const value of ['kreox_1', 'kreox_-2', 'kreox_1.5', 'kreox_9007199254740992', {}, undefined]) {
    assert.equal(parseReferrer(value, 1), undefined);
  }
  assert.match(buildKeyboard({ kind: 'profile' }).toString(), /👤 Реф/);
});

test('forged upgrade price, reward and another user ID never override server-side economics or ownership', async () => {
  const { send, database } = await fixture();
  await send({ kind: 'profile' }, 2);
  database.player(1).bitcoin = 1_000_000;
  database.player(2).bitcoin = 2_000_000;
  const command = parseCommand(labels.confirm, {
    command: 'mining_confirm', level: 0, price: -1, increase: Infinity, vkId: 2
  });
  await send(command, 1);
  assert.equal(database.player(1).bitcoin, 800_000);
  assert.equal(database.player(2).bitcoin, 2_000_000);
  assert.equal(database.player(2).mining?.level, 0);
  assert.equal(database.player(1).mining?.level, 1);
});

test('an old delivered start event cannot restart an expired farm, including after process restart', async () => {
  const { service, send, database, farm } = await fixture();
  await send({ kind: 'mining_start' }, 1, { eventId: 'single-start' });
  const until = farm().activeUntil.getTime();
  database.time = new Date(until + game.mining.durationMs);
  const replay = new GameService(database);
  await replay.handle({ eventId: 'single-start', vkId: 1, command: { kind: 'mining_start' } }, async () => 'Игрок');
  assert.equal(farm().activeUntil.getTime(), until);
  assert.match((await service.handle({ eventId: 'after-replay', vkId: 1, command: { kind: 'mining' } }, async () => 'Игрок')).text,
    /Статус: Выключена/);
});

test('bonus and referral cases share one personal acquisition sequence', async () => {
  const { send, database } = await fixture();
  database.player().bonusDay = 6;
  database.player().lastBonusAt = new Date(database.time.getTime() - game.bonusIntervalMs);
  await send({ kind: 'bonus' });
  await send({ kind: 'profile' }, 2, { referrerId: 1 });
  assert.deepEqual(database.state.items.map(item => [item.itemId, item.kind]), [[1, 'zhdun_case'], [2, 'referral_case']]);
  assert.equal(database.player().nextItemId, 3);
});


test('BTC displays truncate to three comma decimals at boundaries without floating-point rounding', () => {
  for (const [amount, expected] of [
    [0, '0,000'], [1, '0,000'], [99_999, '0,000'], [100_000, '0,001'],
    [99_999_999, '0,999'], [100_000_000, '1,000'], [111_617_014, '1,116'],
    [123_999_999, '1,239'], [371_117_014, '3,711'], [Number.MAX_SAFE_INTEGER, '90071992,547']
  ] as const) {
    assert.equal(formatMining(amount), expected);
    assert.equal(miningWithdrawalText(amount), `✅ Вы сняли ${expected}₿.`);
  }
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatMining(amount));
    assert.throws(() => miningWithdrawalText(amount));
  }
});

test('withdrawal, profile and both BTC ranking sections hide extra decimals without losing satoshis', async () => {
  const { database, send, farm } = await fixture();
  for (const id of [2, 3, 4]) {
    await send({ kind: 'profile' }, id);
  }
  database.player().name = "'felix";
  database.player().bitcoin = 259_500_000;
  database.player().mining = { ...initialFarm(), balance: 111_617_014 };
  database.player(2).name = 'K I R';
  database.player(2).bitcoin = 398_500_000;
  database.player(3).name = 'Beswes';
  database.player(3).bitcoin = 150_000_000;
  database.player(4).name = 'Асхаб';
  const withdrawal = await send({ kind: 'mining_withdraw' }, 1, { eventId: 'precise-withdrawal' });
  assert.equal(withdrawal.text, '✅ Вы сняли 1,116₿.');
  assert.equal(database.player().bitcoin, 371_117_014);
  assert.equal(farm().balance, 0);
  assert.deepEqual(await send({ kind: 'mining_withdraw' }, 1, { eventId: 'precise-withdrawal' }), withdrawal);
  assert.equal(database.player().bitcoin, 371_117_014);
  const ranking = await send({ kind: 'ranking', metric: 'bitcoin' });
  assert.equal(ranking.text, [
    '💠 Топ игроков по биткоинам:', '',
    '1️⃣ [id2|K I R] — 3,985₿',
    "2️⃣ [id1|'felix] — 3,711₿",
    '3️⃣ [id3|Beswes] — 1,500₿',
    '4️⃣ [id4|Асхаб] — 0,000₿',
    '—————————————————',
    "➡2️⃣ [id1|'felix] — 3,711₿"
  ].join('\n'));
  const profile = await send({ kind: 'profile' });
  assert.ok(profile.text.includes('💠 Биткоин: 3,711₿'));
  assert.equal(profile.text.split('\n').length, 7);
  assert.equal(profile.text.includes('\n\n'), false);
  const menu = await send({ kind: 'menu' });
  assert.ok(menu.text.endsWith(profile.text));
  assert.equal(database.player().bitcoin, 371_117_014);
});

test('BTC ranking still compares exact satoshis when the displayed thousandths are equal', async () => {
  const { database, send } = await fixture();
  await send({ kind: 'profile' }, 2);
  database.player().bitcoin = 371_117_014;
  database.player(2).bitcoin = 371_117_015;
  const ranking = await send({ kind: 'ranking', metric: 'bitcoin' });
  assert.equal(ranking.text, [
    '💠 Топ игроков по биткоинам:', '',
    '1️⃣ [id2|Игрок 2] — 3,711₿',
    '2️⃣ [id1|Игрок 1] — 3,711₿',
    '—————————————————',
    '➡2️⃣ [id1|Игрок 1] — 3,711₿'
  ].join('\n'));
  assert.equal(database.player().bitcoin, 371_117_014);
  assert.equal(database.player(2).bitcoin, 371_117_015);
});
