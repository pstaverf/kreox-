import { MongoServerError, type Db } from 'mongodb';
import type { MessagePhoto, MessagePhotoCache } from '../types/message-photos.js';

export class MongoMessagePhotos implements MessagePhotoCache {
  private readonly photos;
  constructor(db: Db) { this.photos = db.collection<MessagePhoto>('message_photos'); }
  async messagePhoto(key: string): Promise<string | null> {
    return (await this.photos.findOne({ _id: key }))?.attachment ?? null;
  }
  async saveMessagePhoto(key: string, attachment: string): Promise<void> {
    const result = await this.photos.updateOne({ _id: key }, { $set: { attachment } }, { upsert: true }).catch(async (error: unknown) => {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      return this.photos.updateOne({ _id: key }, { $set: { attachment } });
    });
    if (!result.acknowledged || result.matchedCount + result.upsertedCount !== 1) throw new Error('Photo cache write failed');
  }
}
