import { wholeKcNotice } from './texts.js';
import { roundKc } from './kc-money.js';
import { createHash } from 'node:crypto';
import { diceConfig } from '../config/dice.js';
import { game } from '../config/game.js';
import type { CasinoRandom } from '../types/casino.js';
import type { DiceChat, DiceCommand, DiceCredit, DiceGame } from '../types/dice.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import { DuplicateWriteError, type GameDatabase, type GameStore } from '../types/storage.js';
import { isPositiveId } from '../utils/validation.js';
import { safeBankMoney } from './bank-rules.js';
import { resolveCasinoStake } from './casino-rules.js';
import { diceChatKey, diceDistribution, diceMinimum, refreshDiceDeadline, validDiceStake, validateDiceChat } from './dice-rules.js';
import { diceCard, diceExpired, diceMinimumText, diceMoney, diceRefund, diceResult, diceTexts } from './dice-texts.js';

const reply = (text = ''): Reply => ({ text, keyboard: { kind: 'none' } });
export async function diceChat(store: GameStore, peerId: number): Promise<DiceChat | null> {
  const value = await store.casinoGet(diceChatKey(peerId));
  if (value === null) return null;
  if (value.kind !== 'dice_chat') throw new Error('Invalid dice chat record');
  validateDiceChat(value);
  return value;
}
export async function diceButtonActive(store: GameStore, input: GameInput, command: DiceCommand): Promise<boolean> {
  if (!input.isChat || typeof input.peerId !== 'number' || !isPositiveId(input.peerId) || input.peerId <= 2_000_000_000) return false;
  if (command.kind !== 'dice_join' && command.kind !== 'dice_leave') return true;
  if (command.peerId !== input.peerId) return false;
  const chat = await diceChat(store, input.peerId);
  const value = chat?.games.find(entry => entry.gameId === command.gameId);
  return value !== undefined && value.expiresAt > await store.now();
}
async function payCredit(store: GameStore, credit: DiceCredit, now: Date): Promise<boolean> {
  if (credit.stage !== 'pending' || !safeBankMoney(credit.amount) || credit.amount <= 0 || !isPositiveId(credit.vkId)) throw new Error('Invalid dice credit');
  if (credit.currency === 'kc') {
    credit.notice = wholeKcNotice(credit.notice, credit.amount);
    credit.amount = roundKc(credit.amount);
  }
  const paid = credit.amount === 0 || await store.updateBalance(credit.vkId, credit.currency, 'add', credit.amount);
  if (paid) {
    credit.stage = 'paid';
    if (credit.notice.length > 0) await store.enqueueItemNotification(`notice:${credit._id}`, credit.vkId, credit.notice, { kind: 'none' });
  } else credit.dueAt = new Date(now.getTime() + diceConfig.retryMs);
  await store.casinoSave(credit);
  return paid;
}
async function creditDice(store: GameStore, key: string, vkId: number, value: DiceGame, amount: number, now: Date, notice = ''): Promise<boolean> {
  if (!safeBankMoney(amount) || amount <= 0) throw new Error('Invalid dice amount');
  const credit: DiceCredit = { _id: `dice-credit:${key}`, kind: 'dice_credit', version: 0, vkId, currency: value.currency, amount, notice, stage: 'pending', dueAt: now };
  await store.casinoInsert(credit);
  return payCredit(store, credit, now);
}
async function saveChat(store: GameStore, chat: DiceChat, deadline?: Date): Promise<void> {
  refreshDiceDeadline(chat);
  validateDiceChat(chat);
  await store.casinoSave(chat, deadline);
}
async function expireGames(store: GameStore, chat: DiceChat, now: Date): Promise<number> {
  const expired = chat.games.filter(value => value.expiresAt <= now);
  for (const value of expired) {
    const key = `${chat.peerId}:${value.gameId}`;
    for (const player of value.players) await creditDice(store, `refund:${key}:${player.entryId}`, player.vkId, value, value.amount, now, diceRefund(value));
    await store.enqueueItemNotification(`dice-expired:${key}`, chat.peerId, diceExpired(value.gameId), { kind: 'none' });
  }
  if (expired.length > 0) {
    chat.games = chat.games.filter(value => value.expiresAt > now);
    await saveChat(store, chat);
  }
  return expired.length;
}
async function finishDice(store: GameStore, chat: DiceChat, value: DiceGame, now: Date, random: CasinoRandom): Promise<void> {
  const key = `${chat.peerId}:${value.gameId}`;
  const scores = value.players.map(player => {
    const roll = random(`dice:${key}:${player.vkId}`, diceConfig.sides);
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= diceConfig.sides) throw new Error('Invalid dice roll');
    return roll + 1;
  });
  const best = Math.max(...scores);
  const winners = value.players.filter((_player, index) => scores[index] === best);
  const distribution = diceDistribution(value.amount, value.players.length, winners.length, value.currency);
  for (const winner of winners) {
    const paid = await creditDice(store, `winner:${key}:${winner.vkId}`, winner.vkId, value, distribution.each, now);
    if (!paid) await store.enqueueItemNotification(`dice-waiting:${key}:${winner.vkId}`, winner.vkId, `${diceTexts.pending}\n💰 Сумма: ${diceMoney(distribution.each, value.currency)}`, { kind: 'none' });
  }
  if (distribution.commission > 0) await creditDice(store, `commission:${key}`, diceConfig.commissionId, value, distribution.commission, now);
  await store.enqueueItemNotification(`dice-result:${key}`, chat.peerId, diceResult(value, scores, winners, distribution.each), { kind: 'none' });
  chat.games = chat.games.filter(entry => entry.gameId !== value.gameId);
  await saveChat(store, chat, value.expiresAt);
}
export async function diceAction(store: GameStore, input: GameInput, player: Player | null, command: DiceCommand, random: CasinoRandom): Promise<Reply> {
  const peerId = input.peerId;
  if (!input.isChat || typeof peerId !== 'number' || !isPositiveId(peerId) || peerId <= 2_000_000_000) return reply();
  if ((command.kind === 'dice_join' || command.kind === 'dice_leave') && command.peerId !== peerId) return reply();
  const now = await store.now();
  let chat = await diceChat(store, peerId);
  if (chat !== null) await expireGames(store, chat, now);
  if (command.kind === 'dice_invalid') return reply(command.minimum ? diceMinimumText(command.currency) : diceTexts.usage);
  if (command.kind === 'dice_list') {
    if (chat === null || chat.games.length === 0) return reply(diceTexts.empty);
    for (const value of chat.games) await store.enqueueItemNotification(`dice-list:${input.eventId}:${value.gameId}`, peerId, diceCard(value, now), { kind: 'dice_game', peerId, gameId: value.gameId });
    return reply();
  }
  if (command.kind === 'dice_create') {
    let amount = command.amount;
    if (typeof amount !== 'number') {
      const current = await store.player(input.vkId);
      if (current === null) throw new Error('Missing dice balance');
      amount = resolveCasinoStake(amount, current[command.currency], command.currency);
    }
    if (command.currency === 'kc') amount = roundKc(amount);
    if (amount < diceMinimum(command.currency)) return reply(diceMinimumText(command.currency));
    if (!validDiceStake(command.currency, amount, command.slots)) return reply(diceTexts.limit);
    if (chat === null) {
      chat = { _id: diceChatKey(peerId), kind: 'dice_chat', version: 0, peerId, lastGame: 0, games: [], dueAt: now };
      refreshDiceDeadline(chat);
      await store.casinoInsert(chat);
    }
    if (chat.games.length >= diceConfig.maxGames) return reply(diceTexts.full);
    if (chat.lastGame >= game.maxAmount) return reply(diceTexts.limit);
    if (player === null) throw new Error('Missing dice creator');
    if (!await store.updateBalance(player._id, command.currency, 'take', amount)) return reply(diceTexts.funds);
    const value: DiceGame = { gameId: ++chat.lastGame, currency: command.currency, amount, slots: command.slots,
      expiresAt: new Date(now.getTime() + diceConfig.lifetimeMs), players: [{ vkId: player._id, name: player.name, entryId: createHash('sha256').update(input.eventId).digest('hex') }] };
    chat.games.push(value);
    await saveChat(store, chat, value.expiresAt);
    return { text: diceCard(value, now), keyboard: { kind: 'dice_game', peerId, gameId: value.gameId } };
  }
  const value = chat?.games.find(entry => entry.gameId === command.gameId);
  if (chat === null || value === undefined) return reply();
  const existing = value.players.find(entry => entry.vkId === input.vkId);
  if (command.kind === 'dice_leave') {
    if (existing === undefined) return reply(diceTexts.notPlaying);
    const paid = await creditDice(store, `refund:${peerId}:${value.gameId}:${existing.entryId}`, existing.vkId, value, value.amount, now);
    value.players = value.players.filter(entry => entry.vkId !== input.vkId);
    if (value.players.length === 0) chat.games = chat.games.filter(entry => entry.gameId !== value.gameId);
    await saveChat(store, chat, value.expiresAt);
    return reply(paid ? diceTexts.left : `${diceTexts.left}\n${diceTexts.pending}`);
  }
  if (existing !== undefined) return reply(diceTexts.alreadyPlaying);
  if (player === null) throw new Error('Missing dice participant');
  if (!await store.updateBalance(input.vkId, value.currency, 'take', value.amount)) return reply(diceTexts.funds);
  value.players.push({ vkId: input.vkId, name: player.name, entryId: createHash('sha256').update(input.eventId).digest('hex') });
  if (value.players.length === value.slots) {
    await finishDice(store, chat, value, now, random);
    return reply();
  }
  await saveChat(store, chat, value.expiresAt);
  return reply(diceTexts.accepted);
}
export async function settleDice(database: GameDatabase): Promise<number> {
  let count = 0;
  for (let index = 0; index < diceConfig.batchSize; index += 1) {
    try {
      const work = await database.transaction(async store => {
        const now = await store.now();
        const chat = (await store.casinoList({ kind: 'dice_chat', dueAt: now }, 1))[0];
        if (chat !== undefined) {
          if (chat.kind !== 'dice_chat') throw new Error('Invalid expired dice chat');
          validateDiceChat(chat);
          return await expireGames(store, chat, now) > 0;
        }
        const credit = (await store.casinoList({ kind: 'dice_credit', dueAt: now }, 1))[0];
        if (credit === undefined) return false;
        if (credit.kind !== 'dice_credit') throw new Error('Invalid pending dice record');
        await payCredit(store, credit, now);
        return true;
      });
      if (!work) break;
      count += 1;
    } catch (error: unknown) {
      if (!(error instanceof DuplicateWriteError)) throw error;
    }
  }
  return count;
}
