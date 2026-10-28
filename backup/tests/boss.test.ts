import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { bossConfig } from '../src/config/boss.js';
import { game } from '../src/config/game.js';
import { GameService } from '../src/services/game.js';
import { broadcastBoss } from '../src/services/boss-broadcast.js';
import { bossBoard, bossCaseKind, bossPower, upgradeCost } from '../src/services/boss-rules.js';
import { bossTexts } from '../src/services/boss-texts.js';
import { caseRewards } from '../src/services/item-rules.js';
import { caseDrops } from '../src/services/case-drops.js';
import { itemDetails, itemName } from '../src/services/item-texts.js';
import type { BossPlayer, BossRun } from '../src/types/boss.js';
import type { CasinoRandom } from '../src/types/casino.js';
import type { Command, PreparedReply } from '../src/types/game.js';
import { MemoryDatabase } from './memory.js';

async function fixture(random: CasinoRandom = (purpose, maximum) => purpose.endsWith(':drop') ? 9 : maximum - 1) {
  const db = new MemoryDatabase();
  const service = new GameService(db, undefined, undefined, undefined, undefined, undefined, random);
  let next = 0;
  for (const vkId of [1, 2, 3]) {
    await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
    db.player(vkId).kc = 100_000_000_000;
  }
  const send = (command: Command, vkId = 1, eventId = `boss:${next++}`) => service.handle({ eventId, vkId, peerId: vkId, hasPayload: true, command }, async () => 'Игрок');
  const summon = (health = '1000', name = 'Ахиллес', vkId = 888801846, eventId = `create:${next++}`) => send(parseCommand(`!cboss ${health} «${name}» 💙`, undefined), vkId, eventId);
  const fighter = (vkId = 1): BossPlayer => {
    const value = db.state.casino.get(`boss-player:${vkId}`);
    assert.ok(value?.kind === 'boss_player');
    return value;
  };
  const run = (): BossRun => {
    const current = db.state.casino.get('boss-current');
    assert.ok(current?.kind === 'boss_current');
    const value = db.state.casino.get(current.runId);
    assert.ok(value?.kind === 'boss_run');
    return value;
  };
  const attack = (reply: PreparedReply, vkId = 1, eventId = `hit:${next++}`, miss = false) => {
    assert.ok(reply.keyboard.kind === 'boss_fight');
    const index = reply.keyboard.emojis.findIndex(value => miss ? value !== '⚔️' : value === '⚔️');
    return send({ kind: 'boss_attack', token: reply.keyboard.token, slot: index }, vkId, eventId);
  };
  return { db, send, summon, fighter, run, attack };
}

test('boss parsing supports quoted names, optional photos, adjacent emoji/URL and bounded HP; labels alone do nothing', () => {
  const photo = 'https://cdn.kleymorf.xyz/boss.jpg';
  assert.deepEqual(parseCommand(`!cboss 10кк «Ахиллес» 💙${photo}`, undefined), { kind: 'boss_create', health: 10_000_000, name: 'Ахиллес', color: '💙', photo });
  assert.equal(parseCommand('!cboss 100 Ахиллес 💙', undefined).kind, 'boss_create');
  for (const value of ['!cboss 0 X 💙', '!cboss -1 X 💙', '!cboss 10000000000000000 X 💙', '!cboss 1 «[id1|X]» 💙', '!cboss 1 X 💙 http://localhost/a', '!cboss 1 X 💙 https://127.0.0.1/a', '!cboss 1 X blue']) assert.equal(parseCommand(value, undefined).kind, 'boss_invalid');
  for (const value of ['🎩 Босс', '⚔️', '🆙 Прокачать', '🗡️ Урон', '💪🏻 Качалка', '🆘 Помощь']) assert.equal(parseCommand(value, undefined).kind, 'development');
  assert.equal(parseCommand(undefined, { command: 'boss_attack', token: 'a'.repeat(32), slot: 16 }).kind, 'development');
});

test('only admins summon a single global boss, duplicate events replay and the second admin works', async () => {
  const f = await fixture();
  await assert.rejects(f.summon('1000', 'Ахиллес', 1), /Administrator/);
  const first = await f.summon('10кк', 'Ахиллес', 312631501, 'single-summon');
  assert.equal(first.text, '🎩 Босс «Ахиллес» со здоровьем 10.000.000 успешно призван!');
  assert.equal((await f.summon('10кк', 'Ахиллес', 312631501, 'single-summon')).randomId, first.randomId);
  assert.equal((await f.summon()).text, bossTexts.alive);
  assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'boss_run').length, 1);
  assert.equal(f.db.state.players.has(312631501), false);
});

test('boss subscription toggles exactly once per event and broadcasts are durable, paged, unique and exclude later subscribers', async () => {
  const f = await fixture();
  assert.equal((await f.send({ kind: 'boss' })).text, '🎩 [id1|Игрок 1], босс ещё не призван.\n🔔 Следи за уведомлениями!');
  const input: Command = { kind: 'boss_subscribe' };
  const first = await f.send(input, 1, 'subscribe-once');
  assert.equal(first.text, bossTexts.subscribed);
  assert.equal((await f.send(input, 1, 'subscribe-once')).randomId, first.randomId);
  await f.send(input, 2);
  assert.equal((await f.send(input, 2)).text, bossTexts.unsubscribed);
  await f.summon();
  f.db.time = new Date(f.db.time.getTime() + 1);
  await f.send(input, 3);
  assert.equal(await broadcastBoss(f.db), 1);
  assert.equal(await broadcastBoss(f.db), 0);
  const notices = f.db.state.notifications.filter(value => value._id.startsWith('boss-summon:'));
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.peerId, 1);
  assert.equal(notices[0]?.text, '🎩 Босс «Ахиллес» был призван.\n⚔️ Скорее начинай атаковать его чтобы выбить награду!');
  assert.equal(notices[0]?.keyboard?.kind, 'boss_notice');
});

test('boss menu, gym and damage quote preserve exact blank lines and photo metadata', async () => {
  const f = await fixture();
  await f.send({ kind: 'boss_create', health: 1000, name: 'Ахиллес', color: '💙', photo: 'https://cdn.kleymorf.xyz/boss.jpg' }, 888801846);
  const menu = await f.send({ kind: 'boss' });
  assert.equal(menu.text, '💙 Босс: Ахиллес\n\n❤ Здоровье: 1.000/1.000\n⚔ Урон: 1');
  assert.equal(menu.photoUrl, 'https://cdn.kleymorf.xyz/boss.jpg');
  assert.equal((await f.send({ kind: 'boss_gym' })).text, '📋 Ваши параметры:\n\n🗡 Урон: 1 ед.\n\n🛡 Что вы хотите прокачать?');
  const quote = await f.send({ kind: 'boss_damage' });
  assert.equal(quote.text, '🗡 Вы хотите повысить урон на 3 ед.?\n💰 Это обойдется вам в 5.000 KC (прокачки х10, х100 и х1000 выйдут дороже из-за роста).\n💸 Баланс: 1.000.000.000 KC');
  assert.equal(quote.text.includes('\n\n'), false);
});

test('linear upgrade prices charge every step in bulk, add three damage each, and stale/duplicate clicks never charge twice', async () => {
  const f = await fixture();
  assert.equal(upgradeCost(0, 10), 9_500_000);
  assert.equal(upgradeCost(10, 1), 1_500_000);
  assert.equal(bossPower(23), 70);
  for (const quantity of [1, 10, 100, 1000]) {
    const quote = await f.send({ kind: 'boss_damage' });
    assert.ok(quote.keyboard.kind === 'boss_upgrade');
    const level = f.fighter().level;
    const before = f.db.player().kc;
    const command: Command = { kind: 'boss_upgrade', token: quote.keyboard.token, quantity };
    const reply = await f.send(command, 1, `buy-${quantity}`);
    assert.equal(f.fighter().level, level + quantity);
    assert.equal(f.db.player().kc, before - Number(upgradeCost(level, quantity)));
    assert.equal((await f.send(command, 1, `buy-${quantity}`)).randomId, reply.randomId);
    const after = f.db.player().kc;
    await f.send(command);
    assert.equal(f.db.player().kc, after);
    assert.equal(f.fighter().level, level + quantity);
  }
});

test('insufficient upgrade funds and transaction rollback leave level, wallet and tokens unchanged', async () => {
  const f = await fixture();
  const quote = await f.send({ kind: 'boss_damage' });
  assert.ok(quote.keyboard.kind === 'boss_upgrade');
  const command: Command = { kind: 'boss_upgrade', token: quote.keyboard.token, quantity: 1000 };
  f.db.player().kc = 100;
  assert.equal((await f.send(command)).text, bossTexts.funds);
  assert.equal(f.fighter().level, 0);
  assert.equal(f.db.player().kc, 100);
  f.db.player().kc = 100_000_000_000;
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.send(command));
  assert.deepEqual(f.db.state, before);
  assert.equal(upgradeCost(game.maxAmount, 1000), null);
});

test('boss fight has exactly 16 emojis with one sword, menu is row five, and every button has an identity-bound payload', async () => {
  const f = await fixture();
  await f.summon();
  const reply = await f.send({ kind: 'boss_fight' });
  assert.ok(reply.keyboard.kind === 'boss_fight');
  assert.equal(reply.keyboard.emojis.length, 16);
  assert.equal(reply.keyboard.emojis.filter(value => value === '⚔️').length, 1);
  const serialized = buildKeyboard(reply.keyboard).toString();
  assert.equal((serialized.match(/"label":"⚔️"/gu) ?? []).length, 1);
  const rows: unknown = JSON.parse(serialized);
  assert.ok(typeof rows === 'object' && rows !== null && 'buttons' in rows && Array.isArray(rows.buttons));
  assert.deepEqual(rows.buttons.map(row => Array.isArray(row) ? row.length : 0), [4, 4, 4, 4, 1]);
  assert.equal(serialized.includes('"type":"callback"'), false);
});

test('misses keep the identical board; a hit moves the sword, old and other-player tokens cannot attack', async () => {
  const f = await fixture();
  await f.summon();
  const board = await f.send({ kind: 'boss_fight' });
  const miss = await f.attack(board, 1, 'miss', true);
  assert.equal(miss.text, bossTexts.miss);
  assert.deepEqual(miss.keyboard, board.keyboard);
  assert.equal(f.run().health, 1000);
  await f.attack(board, 2, 'wrong-owner');
  assert.equal(f.run().health, 1000);
  const hit = await f.attack(board, 1, 'real-hit');
  assert.equal(hit.text, '🗡 Вы нанесли боссу 1 ед. урона.\n\n⚔️ Продолжайте атаковать босса: с него может что-то выпасть...');
  assert.equal(f.run().health, 999);
  assert.ok(hit.keyboard.kind === 'boss_fight' && board.keyboard.kind === 'boss_fight');
  assert.notEqual(hit.keyboard.token, board.keyboard.token);
  assert.notEqual(hit.keyboard.emojis.indexOf('⚔️'), board.keyboard.emojis.indexOf('⚔️'));
  await f.attack(board, 1, 'stale-hit');
  assert.equal(f.run().health, 999);
  assert.equal((await f.attack(board, 1, 'real-hit')).randomId, hit.randomId);
});

test('above 50 damage is uniform 1..power, the top six values are critical, and the killing hit is capped by remaining HP', async () => {
  const f = await fixture((purpose, maximum) => purpose.endsWith(':drop') ? 9 : maximum - 1);
  await f.summon('100');
  await f.send({ kind: 'boss_gym' });
  f.fighter().level = 23;
  const board = await f.send({ kind: 'boss_fight' });
  const hit = await f.attack(board);
  assert.match(hit.text, /70 ед. урона\.\.\. это КРИТИЧЕСКИЙ удар!/u);
  assert.equal(f.run().health, 30);
  const last = await f.attack(hit);
  assert.match(last.text, /30 ед. урона\./u);
  assert.match(last.text, /Босс повержен/u);
  assert.equal(f.run().health, 0);
  assert.equal((await f.send({ kind: 'boss_leaders' })).text, '🏆 Лучшие игроки по урону:\n\n1️⃣ [id1|Игрок 1] — 100 урона\n—————————————————\n➡1️⃣ [id1|Игрок 1] — 100 урона');
  const level = f.fighter().level;
  await f.summon('100', 'Новый');
  assert.equal(f.fighter().level, level);
  await f.attack(board);
  assert.equal(f.run().health, 100);
});

test('boss drops are per successful hit, atomic with HP and inventory, never on a miss or duplicate', async () => {
  const f = await fixture(() => 0);
  await f.summon();
  const board = await f.send({ kind: 'boss_fight' });
  const before = structuredClone(f.db.state);
  f.db.failRemember = true;
  await assert.rejects(f.attack(board));
  assert.deepEqual(f.db.state, before);
  f.db.failRemember = false;
  const hit = await f.attack(board, 1, 'one-drop');
  assert.equal(f.db.state.items.length, 1);
  assert.equal(f.db.state.items[0]?.kind, 'boss_case:💙:Ахиллес');
  assert.equal(hit.text, '🗡 Вы нанесли боссу 1 ед. урона.\n\n🤩 Ваша атака заставила босса выронить награду:\n💙 Босс-кейс (Ахиллес)');
  await f.attack(board, 1, 'one-drop');
  await f.attack(board, 1, 'old-board');
  await f.attack(hit, 1, 'miss-new', true);
  assert.equal(f.db.state.items.length, 1);
});

test('case distributions exactly match approved categories; dynamic boss cases keep their original names', () => {
  const kind = bossCaseKind('💙', 'Ахиллес');
  const cases = [kind, 'aristocrat_case'];
  for (const value of cases) {
    assert.ok(value === kind || value === 'aristocrat_case');
    const drops = caseDrops(value === kind ? kind : 'aristocrat_case');
    assert.equal(drops.reduce((sum, drop) => sum + drop.weight, 0), 1000);
  }
  const frequencies = new Map<string, number>();
  for (let ticket = 0; ticket < 1000; ticket += 1) {
    let index = 0;
    const values = [Math.floor(ticket / 10), ticket % 10 * 10];
    const rewards = caseRewards(1, () => values[index++] ?? 0, kind);
    const category = rewards.kc > 0 ? 'kc' : rewards.euro > 0 ? 'euro' : (rewards.bitcoin ?? 0) > 0 ? 'bitcoin' : 'item';
    frequencies.set(category, (frequencies.get(category) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(frequencies), { kc: 700, euro: 90, bitcoin: 200, item: 10 });
  assert.equal(itemName(bossCaseKind('❤️', 'Второй')), '❤️ Босс-кейс (Второй)');
  assert.match(itemDetails(kind, 1), /💰 250 KC\n💰 500 KC/u);
  assert.match(itemDetails('aristocrat_case', 1), /💠 200₿/u);
});

test('opening new cases atomically grants BTC or Aristocrat items and respects full-wallet overflow', async () => {
  const db = new MemoryDatabase();
  let value = 99;
  const service = new GameService(db, undefined, undefined, () => value);
  let next = 0;
  const send = (command: Command) => service.handle({ vkId: 1, eventId: `case:${next++}`, command, hasPayload: true }, async () => 'Игрок');
  await send({ kind: 'profile' });
  const kind = bossCaseKind('💙', 'Ахиллес');
  await db.transaction(async store => { assert.equal(await store.grantItems(1, kind, 2), true); });
  await send({ kind: 'item_open', itemKind: kind, quantity: 1 });
  assert.equal(db.state.items.filter(item => item.kind === 'aristocrat_case').length, 1);
  value = 90;
  db.player().bitcoin = game.maxAmount;
  const beforeItems = structuredClone(db.state.items);
  await send({ kind: 'item_open', itemKind: kind, quantity: 1 });
  assert.deepEqual(db.state.items, beforeItems);
  db.player().bitcoin = 0;
  const opened = await send({ kind: 'item_open', itemKind: kind, quantity: 1 });
  assert.equal(db.player().bitcoin, 15 * game.bitcoinScale);
  assert.match(opened.text, /💠 15₿/u);
});

test('help contains real VK/Telegram links and the main menu routes to bosses and help', () => {
  const help = buildKeyboard({ kind: 'help' }).toString();
  assert.ok(help.includes('https://vk.ru/kreox_owner') && help.includes('https://t.me/kleymorf'));
  const main = buildKeyboard({ kind: 'main' }).toString();
  assert.ok(main.includes('boss') && main.includes('help'));
  for (let previous = 0; previous < 16; previous += 1) assert.notEqual(bossBoard(() => 0, 'board', previous).indexOf('⚔️'), previous);
  assert.equal(bossConfig.emojis.includes('🎲'), true);
});

test('concurrent final hits cannot overkill or duplicate a drop; successful attacks have no time interval', async () => {
  const f = await fixture(() => 0);
  await f.summon('3');
  const first = await f.send({ kind: 'boss_fight' });
  const other = await f.send({ kind: 'boss_fight' }, 2);
  const time = f.db.time.getTime();
  const second = await f.attack(first);
  const third = await f.attack(second);
  assert.equal(f.db.time.getTime(), time);
  assert.equal(f.run().health, 1);
  await Promise.all([f.attack(third), f.attack(other, 2)]);
  assert.equal(f.run().health, 0);
  assert.equal(f.db.state.items.length, 3);
  const total = [...f.db.state.casino.values()].reduce((sum, value) => sum + (value.kind === 'boss_damage' ? value.damage : 0), 0);
  assert.equal(total, 3);
});

test('boss subscriber pagination is numerical, restartable and does not duplicate earlier pages', async () => {
  const f = await fixture();
  for (let id = 1; id <= 25; id += 1) {
    await f.send({ kind: 'profile' }, id);
    await f.send({ kind: 'boss_subscribe' }, id);
  }
  await f.summon();
  assert.equal(await broadcastBoss(f.db), 20);
  assert.equal(await broadcastBoss(f.db), 5);
  assert.equal(await broadcastBoss(f.db), 0);
  const notices = f.db.state.notifications.filter(value => value.bossSummon !== undefined);
  assert.equal(new Set(notices.map(value => value.peerId)).size, 25);
  assert.deepEqual(notices.map(value => value.peerId), Array.from({ length: 25 }, (_, index) => index + 1));
});

test('empty boss rankings have only the requested heading blank and long boss case payloads stay inside VK limits', async () => {
  const f = await fixture();
  await f.summon();
  const top = await f.send({ kind: 'boss_leaders' });
  assert.equal(top.text.includes('\n\n\n'), false);
  assert.equal((top.text.match(/\n\n/gu) ?? []).length, 1);
  const kind = bossCaseKind('💙', 'А'.repeat(48));
  const keyboard: unknown = JSON.parse(buildKeyboard({ kind: 'item_use', itemKind: kind }).toString());
  assert.ok(typeof keyboard === 'object' && keyboard !== null && 'buttons' in keyboard && Array.isArray(keyboard.buttons));
  for (const row of keyboard.buttons) {
    assert.ok(Array.isArray(row));
    for (const raw of row) {
      const button: unknown = raw;
      assert.ok(typeof button === 'object' && button !== null && 'action' in button);
      const action = button.action;
      assert.ok(typeof action === 'object' && action !== null && 'payload' in action && typeof action.payload === 'string');
      assert.ok(Buffer.byteLength(action.payload, 'utf8') <= 255);
    }
  }
});
