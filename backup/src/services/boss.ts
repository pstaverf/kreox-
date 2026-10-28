import { game } from '../config/game.js';
import type { BossCommand, BossPlayer, BossRun } from '../types/boss.js';
import type { CasinoRandom } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { GameStore } from '../types/storage.js';
import { bossBoard, bossCaseKind, bossPower, bossToken, trustedPhotoUrl, upgradeCost, validBossColor, validBossName } from './boss-rules.js';
import { bossAbsent, bossHit, bossLeaders, bossMenu, bossSummoned, bossTexts, gymText, upgradeText } from './boss-texts.js';
import { itemName, itemTexts } from './item-texts.js';
import { assertNever } from '../utils/validation.js';

export async function currentBoss(store: GameStore): Promise<BossRun | null> {
  const current = await store.casinoGet('boss-current');
  if (current === null) return null;
  if (current.kind !== 'boss_current') throw new Error('Invalid current boss');
  const run = await store.casinoGet(current.runId);
  if (run?.kind !== 'boss_run' || !Number.isSafeInteger(run.health) || run.health < 0 || run.health > run.initialHealth) throw new Error('Invalid boss run');
  return run;
}
export async function createBoss(store: GameStore, command: Extract<BossCommand, { kind: 'boss_create' }> | { kind: 'boss_invalid' }, eventId: string): Promise<Reply> {
  if (command.kind === 'boss_invalid') return { text: bossTexts.usage, keyboard: { kind: 'none' } };
  if (!Number.isSafeInteger(command.health) || command.health <= 0 || command.health > game.maxAmount || !validBossName(command.name) || !validBossColor(command.color) || (command.photo !== null && !trustedPhotoUrl(command.photo))) throw new Error('Invalid typed boss creation');
  const old = await currentBoss(store);
  if (old !== null && old.health > 0) return { text: bossTexts.alive, keyboard: { kind: 'none' } };
  const run: BossRun = { _id: `boss:${bossToken(eventId)}`, kind: 'boss_run', version: 0, name: command.name, color: command.color, photo: command.photo, health: command.health, initialHealth: command.health, createdAt: await store.now() };
  const current = await store.casinoGet('boss-current');
  if (current !== null && current.kind !== 'boss_current') throw new Error('Invalid current boss');
  await store.casinoInsert(run);
  if (current === null) await store.casinoInsert({ _id: 'boss-current', kind: 'boss_current', version: 0, runId: run._id });
  else { current.runId = run._id; await store.casinoSave(current); }
  await store.casinoInsert({ _id: `boss-broadcast:${run._id}`, kind: 'boss_broadcast', version: 0, runId: run._id, after: 0, stage: 'pending', dueAt: new Date(0) });
  return { text: bossSummoned(run), keyboard: { kind: 'none' } };
}
async function bossPlayer(store: GameStore, vkId: number): Promise<BossPlayer> {
  const existing = await store.casinoGet(`boss-player:${vkId}`);
  if (existing !== null) {
    if (existing.kind !== 'boss_player') throw new Error('Invalid boss player');
    bossPower(existing.level);
    return existing;
  }
  const value: BossPlayer = { _id: `boss-player:${vkId}`, kind: 'boss_player', version: 0, vkId, subscribed: false, level: 0 };
  await store.casinoInsert(value);
  return value;
}
function fightReply(text: string, player: BossPlayer): Reply {
  if (player.fight === undefined) throw new Error('Missing boss attack layout');
  return { text, keyboard: { kind: 'boss_fight', token: player.fight.token, emojis: player.fight.emojis } };
}
function newFight(player: BossPlayer, run: BossRun, eventId: string, random: CasinoRandom): void {
  player.fight = { runId: run._id, token: bossToken(eventId), emojis: bossBoard(random, eventId, player.fight?.runId === run._id ? player.fight.emojis.indexOf('⚔️') : -1) };
}
async function upgrade(store: GameStore, player: Player, fighter: BossPlayer, command: BossCommand, eventId: string): Promise<Reply> {
  let success = false;
  if (command.kind === 'boss_upgrade' && command.token === fighter.upgradeToken) {
    const cost = upgradeCost(fighter.level, command.quantity);
    if (cost === null || upgradeCost(fighter.level + command.quantity, 1) === null) return { text: bossTexts.limit, keyboard: { kind: 'boss_upgrade', token: command.token } };
    if (!await store.updateBalance(player._id, 'kc', 'take', cost)) return { text: bossTexts.funds, keyboard: { kind: 'boss_upgrade', token: command.token } };
    fighter.level += command.quantity;
    success = true;
  }
  if (command.kind !== 'boss_upgrade' || success || fighter.upgradeToken === undefined) {
    fighter.upgradeToken = bossToken(eventId);
    await store.casinoSave(fighter);
  }
  const cost = upgradeCost(fighter.level, 1);
  if (cost === null) return { text: bossTexts.limit, keyboard: { kind: 'boss_gym' } };
  const updated = await store.player(player._id);
  if (updated === null) throw new Error('Missing upgraded player');
  const token = fighter.upgradeToken;
  if (token === undefined) throw new Error('Missing boss upgrade quote');
  return { text: upgradeText(bossPower(fighter.level), cost, updated.kc, success), keyboard: { kind: 'boss_upgrade', token } };
}
export async function bossAction(store: GameStore, player: Player, command: BossCommand, input: GameInput, random: CasinoRandom): Promise<Reply> {
  const fighter = await bossPlayer(store, player._id);
  if (command.kind === 'boss_subscribe') {
    fighter.subscribed = !fighter.subscribed;
    if (fighter.subscribed) fighter.subscribedAt = await store.now();
    await store.casinoSave(fighter);
    return { text: fighter.subscribed ? bossTexts.subscribed : bossTexts.unsubscribed, keyboard: { kind: 'none' } };
  }
  if (command.kind === 'boss_gym') return { text: gymText(bossPower(fighter.level)), keyboard: { kind: 'boss_gym' } };
  if (command.kind === 'boss_damage' || command.kind === 'boss_upgrade') return upgrade(store, player, fighter, command, input.eventId);
  const run = await currentBoss(store);
  if (command.kind === 'boss_leaders' && run !== null) {
    const personal = await store.casinoGet(`boss-damage:${run._id}:${player._id}`);
    if (personal !== null && personal.kind !== 'boss_damage') throw new Error('Invalid boss damage');
    return { text: bossLeaders(await store.bossRanking(run._id, player._id), player, personal?.damage ?? 0), keyboard: { kind: 'boss_menu' } };
  }
  if (run === null || run.health === 0) return { text: bossAbsent(player), keyboard: { kind: 'boss_none' } };
  switch (command.kind) {
    case 'boss': return { text: bossMenu(run, bossPower(fighter.level)), keyboard: { kind: 'boss_menu' }, ...(run.photo === null ? {} : { photoUrl: run.photo }) };
    case 'boss_fight':
      newFight(fighter, run, input.eventId, random);
      await store.casinoSave(fighter);
      return fightReply(bossTexts.fight, fighter);
    case 'boss_attack': {
      const board = fighter.fight;
      if (board === undefined || board.runId !== run._id || board.token !== command.token) {
        if (board === undefined || board.runId !== run._id) { newFight(fighter, run, input.eventId, random); await store.casinoSave(fighter); }
        return fightReply(bossTexts.fight, fighter);
      }
      if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= 16) throw new Error('Invalid boss slot');
      if (board.emojis[command.slot] !== '⚔️') return fightReply(bossTexts.miss, fighter);
      const power = bossPower(fighter.level);
      const damage = Math.min(run.health, power <= 50 ? power : random(`${input.eventId}:damage`, power) + 1);
      const drop = random(`${input.eventId}:drop`, 10) === 0;
      const itemKind = bossCaseKind(run.color, run.name);
      if (drop && !await store.grantItems(player._id, itemKind, 1)) return fightReply(itemTexts.limit, fighter);
      run.health -= damage;
      await store.casinoSave(run);
      const old = await store.casinoGet(`boss-damage:${run._id}:${player._id}`);
      if (old !== null && old.kind !== 'boss_damage') throw new Error('Invalid boss damage');
      if (old === null) await store.casinoInsert({ _id: `boss-damage:${run._id}:${player._id}`, kind: 'boss_damage', version: 0, runId: run._id, vkId: player._id, name: player.name, accountId: player.accountId, damage });
      else { old.damage += damage; old.name = player.name; await store.casinoSave(old); }
      newFight(fighter, run, input.eventId, random);
      await store.casinoSave(fighter);
      const text = bossHit(damage, power > 50 && damage >= power - 5, drop ? itemName(itemKind) : null, run.health === 0);
      return run.health === 0 ? { text, keyboard: { kind: 'boss_menu' } } : fightReply(text, fighter);
    }
    case 'boss_leaders': throw new Error('Missing boss leaderboard');
    case 'boss_create': case 'boss_invalid': throw new Error('Unexpected boss administrator action');
    default: return assertNever(command);
  }
}
