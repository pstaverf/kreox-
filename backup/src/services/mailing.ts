import { adminIds } from '../config/admin.js';
import { mailingConfig } from '../config/mailing.js';
import type { GameInput, Reply } from '../types/game.js';
import type { MailingCommand } from '../types/mailing.js';
import type { GameDatabase, GameStore } from '../types/storage.js';
import { mailingTexts } from './mailing-texts.js';

export async function mailingAction(store: GameStore, input: GameInput, command: MailingCommand): Promise<Reply> {
  if (!adminIds.has(input.vkId)) throw new Error('Administrator access is required');
  if (command.kind === 'mailing_invalid' || command.text.trim().length === 0 || command.text.length > mailingConfig.maxTextLength) {
    return { text: mailingTexts.usage, keyboard: { kind: 'none' } };
  }
  await store.createMailing({ _id: `mailing:${input.eventId}`, text: command.text, createdAt: await store.now(), afterVkId: 0, version: 0, state: 'pending' });
  return { text: mailingTexts.queued, keyboard: { kind: 'none' } };
}

export async function queueMailingBatch(database: GameDatabase): Promise<number> {
  return database.transaction(async store => {
    const campaign = await store.pendingMailing();
    if (campaign === null) return 0;
    const recipients = await store.mailingRecipients(campaign.afterVkId, campaign.createdAt);
    for (const vkId of recipients) {
      await store.enqueueMailing(`${campaign._id}:${vkId}`, vkId, campaign.text);
      campaign.afterVkId = vkId;
    }
    if (recipients.length === 0) campaign.state = 'queued';
    await store.saveMailing(campaign);
    return recipients.length;
  });
}
