import { MongoServerError, type Db } from 'mongodb';
import { mailingConfig } from '../config/mailing.js';
import { historicalPrivateRecipient } from '../services/mailing-rules.js';
import type { ProcessedMessage } from '../types/game.js';
import type { MailingRecipient } from '../types/mailing.js';

interface MailingMigration { _id: string; after: string; done: boolean }

export async function migrateMailingRecipients(db: Db): Promise<void> {
  const recipients = db.collection<MailingRecipient>('mailing_recipients');
  const checkpoints = db.collection<MailingMigration>('mailing_migrations');
  for (;;) {
    const checkpoint = await checkpoints.findOne({ _id: 'private_history' });
    if (checkpoint?.done === true) return;
    const page = await db.collection<ProcessedMessage>('processed_messages').find({ _id: { $gt: checkpoint?.after ?? '' } }, { projection: { _id: 1, vkId: 1 } })
      .sort({ _id: 1 }).limit(mailingConfig.migrationPageSize).toArray();
    const ids = new Set(page.flatMap(message => {
      const vkId = historicalPrivateRecipient(message);
      return vkId === null ? [] : [vkId];
    }));
    await Promise.all([...ids].map(async vkId => {
      const result = await recipients.updateOne({ _id: vkId }, { $setOnInsert: { joinedAt: new Date(0) } }, { upsert: true }).catch(async (error: unknown) => {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
        return recipients.updateOne({ _id: vkId }, { $setOnInsert: { joinedAt: new Date(0) } });
      });
      if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error('Mailing recipient migration failed');
    }));
    const last = page.at(-1);
    const update = last === undefined ? { $set: { done: true }, $setOnInsert: { after: checkpoint?.after ?? '' } }
      : { $max: { after: last._id }, $setOnInsert: { done: false } };
    const result = await checkpoints.updateOne({ _id: 'private_history' }, update, { upsert: true }).catch(async (error: unknown) => {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      return checkpoints.updateOne({ _id: 'private_history' }, update);
    });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error('Mailing migration checkpoint failed');
  }
}
