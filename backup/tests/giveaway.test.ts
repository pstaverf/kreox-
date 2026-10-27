import assert from 'node:assert/strict';
import { test } from 'node:test';
import { game } from '../src/config/game.js';
import { parseCommand } from '../src/handlers/commands.js';
import { buildKeyboard } from '../src/handlers/keyboards.js';
import { GameService } from '../src/services/game.js';
import { giveawayKey } from '../src/services/giveaway-rules.js';
import { giveawayTexts } from '../src/services/giveaway-texts.js';
import type { Command } from '../src/types/game.js';
import type { GiveawayState } from '../src/types/giveaway.js';
import { isRecord } from '../src/utils/validation.js';
import { MemoryDatabase } from './memory.js';

const admin = 888801846;
const peer = 2_000_000_001;
async function fixture() {
  const db = new MemoryDatabase();
  const service = new GameService(db);
  for (const vkId of [admin, 1, 2, 3, 4]) await service.handle({ eventId: `register:${vkId}`, vkId, command: { kind: 'profile' } }, async () => `Игрок ${vkId}`);
  let sequence = 0;
  const send = (command: Command, vkId = admin, peerId = peer, eventId = `force:${sequence++}`) => service.handle({ eventId, vkId, peerId, isChat: peerId > 2_000_000_000, command }, async () => 'Новичок');
  const text = (value: string, vkId = admin, peerId = peer, eventId?: string) => send(parseCommand(value, undefined, true), vkId, peerId, eventId);
  const state = (peerId = peer): GiveawayState => {
    const value = db.state.casino.get(giveawayKey(peerId));
    assert.ok(value?.kind === 'giveaway');
    return value;
  };
  const click = (vkId = 1, token = state().token, peerId = peer, cancel = false, eventId?: string) => send({ kind: cancel ? 'giveaway_cancel' : 'giveaway_claim', peerId, token }, vkId, peerId, eventId);
  return { db, service, send, text, state, click };
}

test('force parser handles the requested multiword case and each scaled currency without interpreting command payloads as creation', () => {
  assert.deepEqual(parseCommand('/force Раздача кейс реферальный 10 10', undefined, true), { kind: 'force_giveaway', count: 10, reward: { kind: 'item', itemKind: 'referral_case', quantity: 10 } });
  assert.deepEqual(parseCommand('/force Раздача монеты 10 10кк', undefined, true), { kind: 'force_giveaway', count: 10, reward: { kind: 'currency', currency: 'kc', amount: 1_000_000_000 } });
  assert.deepEqual(parseCommand('/force Раздача евро 10 100', undefined, true), { kind: 'force_giveaway', count: 10, reward: { kind: 'currency', currency: 'euro', amount: 10_000 } });
  assert.deepEqual(parseCommand('/FORCE РАЗДАЧА БИТКОИН 10 100К', undefined, true), { kind: 'force_giveaway', count: 10, reward: { kind: 'currency', currency: 'bitcoin', amount: 10_000_000_000_000 } });
  assert.equal(parseCommand('/forceful Раздача монеты 10 10', undefined, true).kind, 'development');
  for (const text of ['/force', '/force другое', '/force Раздача монеты 0 10', '/force Раздача евро -1 100', '/force Раздача монеты 1.5 10', '/force Раздача монеты 9007199254740992 10', '/force Раздача монеты 1 0', '/force Раздача монеты 1 -10', '/force Раздача монеты 1 всё', '/force Раздача монеты 1 9007199254740992', '/force Раздача кейс реферальный 1 1001', '/force Раздача неизвестный 1 1', '/force Раздача евро 1 10\nкраш 2 1000']) assert.equal(parseCommand(text, undefined, true).kind, 'force_invalid');
  for (const text of ['Получить', 'Отмена', 'Раздача']) assert.equal(parseCommand(text, undefined, true).kind, 'development');
  assert.equal(parseCommand(undefined, { command: 'force_giveaway', count: 1, reward: { kind: 'currency', currency: 'kc', amount: 100 } }, true).kind, 'development');
});

test('launch mints on demand without admin funds, uses exact messages and leaves green/red inline buttons in the chat', async () => {
  for (const [command, expected] of [
    ['монеты 10 10кк', '🌟 Вы запустили раздачу на 10.000.000 KC на 10 игроков!'],
    ['евро 10 100', '🌟 Вы запустили раздачу на 100💶 на 10 игроков!'],
    ['биткоин 10 100к', '🌟 Вы запустили раздачу на 100.000₿ на 10 игроков!'],
    ['кейс реферальный 10 10', 'Вы запустили раздачу на предмет 👬 Кейс «Реферальный» х10 на 10 игроков!']
  ]) {
    const f = await fixture();
    const started = await f.text(`/force Раздача ${command}`);
    assert.equal(started.text, `${expected}\n\nНажмите на кнопку, чтобы забрать награду.`);
    assert.equal(f.db.player(admin).kc, 0);
    assert.equal(f.db.player(admin).euro, 0);
    assert.equal(f.db.player(admin).bitcoin, 0);
    assert.equal(f.db.state.items.length, 0);
    assert.equal(started.keyboard.kind, 'giveaway');
    const raw: unknown = JSON.parse(buildKeyboard(started.keyboard).toString());
    assert.ok(isRecord(raw) && raw.inline === true && Array.isArray(raw.buttons));
    for (const row of raw.buttons) {
      assert.ok(Array.isArray(row));
      for (const rawButton of row) {
        const button: unknown = rawButton;
        assert.ok(isRecord(button) && isRecord(button.action) && typeof button.action.payload === 'string');
        assert.ok(Buffer.byteLength(button.action.payload) <= 255);
        const parsed = parseCommand(undefined, button.action.payload, true);
        assert.ok(parsed.kind === 'giveaway_claim' || parsed.kind === 'giveaway_cancel');
      }
    }
    assert.match(JSON.stringify(raw), /positive/);
    assert.match(JSON.stringify(raw), /negative/);
  }
});

test('each player receives the entire per-player reward only once; final activation has the completion footer', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 2 10кк');
  assert.equal((await f.click(1)).text, '✅ [id1|Игрок 1], вы приняли участие в раздаче! Ваши награды:\n💰 10.000.000 KC\n\nОсталось 1 возможностей получить награды!');
  assert.equal(f.db.player(1).kc, 1_000_000_000);
  assert.equal((await f.click(1)).text, giveawayTexts.already);
  assert.equal(f.state().remaining, 1);
  assert.equal((await f.click(2)).text, '✅ [id2|Игрок 2], вы приняли участие в раздаче! Ваши награды:\n💰 10.000.000 KC\n\nРаздача завершена!');
  assert.equal(f.state().remaining, 0);
  for (const vkId of [1, 2, 3]) assert.equal((await f.click(vkId)).text, giveawayTexts.ended);
  assert.equal(f.db.player(3).kc, 0);
  assert.equal(f.db.player(admin).kc, 0);
});

test('euro, bitcoin and item rewards use existing balances/inventory, not KC or a new currency', async () => {
  const f = await fixture();
  await f.text('/force Раздача евро 2 100');
  assert.match((await f.click()).text, /💶 100 евро/u);
  assert.equal(f.db.player().euro, 10_000);
  await f.text('/force Раздача биткоин 2 100к');
  assert.match((await f.click()).text, /₿ 100\.000 биткоинов/u);
  assert.equal(f.db.player().bitcoin, 10_000_000_000_000);
  await f.text('/force Раздача кейс реферальный 2 10');
  assert.match((await f.click()).text, /👬 Кейс «Реферальный» х10/u);
  assert.equal(f.db.state.items.filter(value => value.vkId === 1 && value.kind === 'referral_case').length, 10);
  await f.text('/force Раздача кейс ждун 2 2');
  await f.click();
  await f.text('/force Раздача крупьер 2 1');
  await f.click();
  const inventory = await f.db.transaction(store => store.inventoryAll(1));
  assert.deepEqual(inventory.map(value => [value.kind, value.quantity]), [['referral_case', 10], ['zhdun_case', 2], ['croupier', 1]]);
  assert.equal(f.db.player().kc, 0);
});

test('starting a new giveaway invalidates only the previous giveaway in the same chat', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 3 100');
  const old = f.state().token;
  await f.click(1);
  await f.text('/force Раздача евро 3 100');
  const current = f.state().token;
  assert.notEqual(old, current);
  for (const vkId of [1, 2]) assert.equal((await f.click(vkId, old)).text, giveawayTexts.old);
  assert.equal((await f.click(admin, old, peer, true)).text, giveawayTexts.old);
  await f.click(1, current);
  await f.text('/force Раздача монеты 2 500', admin, peer + 1);
  assert.equal(f.state().token, current);
  await f.click(2, current);
  await f.click(1, f.state(peer + 1).token, peer + 1);
  assert.equal(f.db.player().kc, 60_000);
  assert.equal(f.db.player().euro, 10_000);
  assert.equal(f.state().remaining, 1);
  assert.equal(f.state(peer + 1).remaining, 1);
});

test('only administrators can create/cancel, with minted remainder discarded and collected rewards untouched', async () => {
  const f = await fixture();
  await assert.rejects(f.text('/force Раздача монеты 3 100', 1), /Administrator access/);
  await f.text('/force Раздача монеты 3 100');
  await assert.rejects(f.click(1, f.state().token, peer, true), /Administrator access/);
  await f.click(1);
  const cancelled = await f.click(admin, f.state().token, peer, true);
  assert.equal(cancelled.text, '⭐️ Раздача отменена!\n\n1 игроков успело получить 100 KC.');
  assert.equal(f.db.player().kc, 10_000);
  assert.equal(f.db.player(admin).kc, 0);
  assert.equal(f.state().remaining, 2);
  assert.equal(f.state().stage, 'cancelled');
  assert.equal((await f.click(2)).text, giveawayTexts.ended);
  assert.equal((await f.click(admin, f.state().token, peer, true)).text, giveawayTexts.ended);
  await f.text('/force Раздача кейс реферальный 3 10');
  await f.click(2);
  assert.equal((await f.click(admin, f.state().token, peer, true)).text, '⭐️ Раздача отменена!\n\n1 игроков успело получить 👬 Кейс «Реферальный» х10.');
});

test('direct services and payloads cannot claim from another chat, in DMs or on behalf of another player', async () => {
  const f = await fixture();
  assert.equal((await f.text('/force Раздача монеты 3 100', admin, admin)).text, '');
  assert.equal(f.db.state.casino.size, 0);
  await f.text('/force Раздача монеты 3 100');
  const token = f.state().token;
  assert.equal((await f.send({ kind: 'giveaway_claim', peerId: peer, token }, 1, peer + 1)).text, giveawayTexts.old);
  assert.equal((await f.send({ kind: 'giveaway_claim', peerId: peer, token }, 1, 1)).text, '');
  const forged = parseCommand(undefined, { command: 'giveaway_claim', peerId: peer, token, vkId: 2, amount: game.maxAmount, reward: { kind: 'currency', currency: 'bitcoin', amount: game.maxAmount } });
  await f.send(forged, 1);
  assert.equal(f.db.player(1).kc, 10_000);
  assert.equal(f.db.player(1).bitcoin, 0);
  assert.equal(f.db.player(2).kc, 0);
  for (const payload of [{ command: 'giveaway_claim', peerId: 1, token }, { command: 'giveaway_claim', peerId: peer, token: 'invalid' }, { command: 'giveaway_cancel', peerId: peer, token: token + 'x' }]) assert.equal(parseCommand(undefined, payload).kind, 'development');
});

test('full wallets and inventory limits do not consume a claim or activation and can be retried', async () => {
  const f = await fixture();
  await f.text('/force Раздача евро 1 100');
  f.db.player().euro = game.maxAmount;
  assert.equal((await f.click()).text, giveawayTexts.limit);
  assert.equal(f.state().remaining, 1);
  assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'giveaway_claim').length, 0);
  f.db.player().euro = 0;
  await f.click();
  assert.equal(f.db.player().euro, 10_000);
  await f.text('/force Раздача кейс ждун 1 2');
  f.db.player().nextItemId = game.maxAmount;
  assert.equal((await f.click()).text, giveawayTexts.limit);
  assert.equal(f.state().remaining, 1);
  assert.equal(f.db.state.items.length, 0);
  f.db.player().nextItemId = 1;
  await f.click();
  assert.equal(f.db.state.items.length, 2);
});

test('registration and the first valid claim commit together without requiring a second click', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 2 100');
  const claimed = await f.click(777);
  assert.match(claimed.text, /✅ \[id777\|Новичок\]/u);
  assert.equal(f.db.player(777).kc, 10_000);
  assert.equal(f.state().remaining, 1);
  await f.text('/force Раздача евро 1 100');
  await f.click(1);
  assert.equal((await f.click(778)).text, giveawayTexts.ended);
  assert.equal(f.db.state.players.has(778), false);
});

test('event replay does not replace the current giveaway and repeated clicks across service restarts cannot mint twice', async () => {
  const f = await fixture();
  const old = await f.text('/force Раздача монеты 3 100', admin, peer, 'launch-once');
  await f.click(1, f.state().token, peer, false, 'claim-once');
  const restarted = new GameService(f.db);
  await restarted.handle({ eventId: 'claim-once', vkId: 1, peerId: peer, isChat: true, command: { kind: 'giveaway_claim', peerId: peer, token: f.state().token } }, async () => 'Игрок');
  assert.equal(f.db.player().kc, 10_000);
  assert.equal((await f.click(1)).text, giveawayTexts.already);
  await f.text('/force Раздача евро 3 100');
  const current = f.state().token;
  assert.deepEqual(await f.text('/force Раздача монеты 3 100', admin, peer, 'launch-once'), old);
  assert.equal(f.state().token, current);
});

test('concurrent claims by the same player and last-slot contenders have a single winner', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 3 100');
  const replies = await Promise.all(Array.from({ length: 12 }, () => f.click(1)));
  assert.equal(replies.filter(value => value.text.startsWith('✅')).length, 1);
  assert.equal(f.db.player().kc, 10_000);
  assert.equal(f.state().remaining, 2);
  await f.text('/force Раздача кейс реферальный 1 10');
  const final = await Promise.all([f.click(1), f.click(2), f.click(3), f.click(4)]);
  assert.equal(final.filter(value => value.text.includes('Раздача завершена!')).length, 1);
  assert.equal(f.db.state.items.length, 10);
  assert.equal(f.state().remaining, 0);
});

test('cancellation and replacement races cannot award from a closed or superseded giveaway', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 3 100');
  const old = f.state().token;
  await Promise.all([f.click(admin, old, peer, true), f.click(1, old)]);
  assert.equal(f.db.player().kc, 0);
  await f.text('/force Раздача монеты 3 100');
  const previous = f.state().token;
  await Promise.all([f.text('/force Раздача евро 3 100'), f.click(1, previous)]);
  assert.equal(f.db.player().kc, 0);
  assert.equal(f.state().remaining, 3);
});

test('payment, inventory grant, receipt and remaining count all roll back on a failed commit', async () => {
  for (const command of ['монеты 1 100', 'кейс реферальный 1 10']) {
    const f = await fixture();
    await f.text(`/force Раздача ${command}`);
    f.db.failRemember = true;
    await assert.rejects(f.click(), /Simulated database failure/);
    assert.equal(f.state().remaining, 1);
    assert.equal(f.state().stage, 'active');
    assert.equal(f.db.player().kc, 0);
    assert.equal(f.db.state.items.length, 0);
    assert.equal([...f.db.state.casino.values()].filter(value => value.kind === 'giveaway_claim').length, 0);
    f.db.failRemember = false;
    await f.click();
    assert.equal(f.state().stage, 'finished');
  }
});

test('currency reward formatting and arithmetic preserve every stored atomic unit near the safe limit', async () => {
  const f = await fixture();
  await f.text('/force Раздача монеты 1 0,01');
  assert.match((await f.click()).text, /💰 0,01 KC/u);
  assert.equal(f.db.player().kc, 1);
  await f.text('/force Раздача биткоин 1 10,001');
  assert.match((await f.click()).text, /₿ 10,001 биткоинов/u);
  assert.equal(f.db.player().bitcoin, 1_000_100_000);
  await f.send({ kind: 'force_giveaway', count: game.maxAmount, reward: { kind: 'currency', currency: 'euro', amount: game.maxAmount } });
  await f.click(2);
  assert.equal(f.db.player(2).euro, game.maxAmount);
  assert.equal(f.state().remaining, game.maxAmount - 1);
});


test('every giveaway reward has only the requested blank line before the remaining/final footer', async () => {
  for (const reward of ['монеты 2 1000', 'евро 2 100', 'биткоин 2 10', 'кейс реферальный 2 1']) {
    const f = await fixture();
    await f.text(`/force Раздача ${reward}`);
    for (const vkId of [1, 2]) {
      const reply = await f.click(vkId);
      assert.equal(reply.text.includes('награды:\n\n'), false);
      assert.equal(reply.text.split('\n\n').length, 2);
      assert.ok(reply.text.includes(vkId === 1 ? '\n\nОсталось' : '\n\nРаздача завершена!'));
    }
  }
});
