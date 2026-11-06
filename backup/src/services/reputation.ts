import type { CasinoRandom } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { ReputationCommand } from '../types/reputation.js';
import type { GameStore } from '../types/storage.js';
import { isPositiveId } from '../utils/validation.js';
import { mention, signedInteger } from './texts.js';

const cooldownMs = 60 * 60 * 1_000;
const missing = '⚠️ Укажите игрока для взаимодействия!';

export async function reputationAction(store: GameStore, actor: Player, command: ReputationCommand, input: GameInput, random: CasinoRandom): Promise<Reply> {
  const reply = (text: string): Reply => ({ text, keyboard: { kind: 'none' } });
  if (!input.isChat) return reply('');
  if (command.kind === 'reputation_invalid') return reply(missing);
  const target = command.target?.kind === 'number' ? await store.playerByAccountId(command.target.id)
    : command.target?.kind === 'vk' ? await store.player(command.target.id)
      : input.replySenderId !== undefined && isPositiveId(input.replySenderId) ? await store.player(input.replySenderId) : null;
  if (target === null) return reply(missing);

  const now = await store.now();
  const nextAt = await store.reputationCooldown(actor._id, target._id);
  if (nextAt !== null && nextAt > now) {
    const seconds = Math.ceil((nextAt.getTime() - now.getTime()) / 1_000);
    return reply(`⚠️ Подождите ${Math.floor(seconds / 60)} мин. ${seconds % 60} сек. до следующей смены репутации.`);
  }
  const magnitude = random(`reputation:${input.eventId}`, 2) + 1;
  const delta = command.direction * magnitude;
  const reputation = await store.changeReputation(target._id, delta);
  if (reputation === null) return reply('⚠️ Достигнут предел репутации.');
  await store.saveReputationCooldown(actor._id, target._id, new Date(now.getTime() + cooldownMs));
  const increased = delta > 0;
  await store.enqueueItemNotification(`reputation:${input.eventId}`, target._id,
    `${mention(actor)} ${increased ? 'повысил' : 'понизил'} вам репутацию.`, { kind: 'none' });
  return reply(`${increased ? '👍 Вы успешно повысили' : '👎 Вы успешно понизили'} репутацию игрока ${mention(target)}.\n\n😎 Репутация: ${signedInteger(reputation)} (${increased ? '+' : '-'}${magnitude})`);
}
