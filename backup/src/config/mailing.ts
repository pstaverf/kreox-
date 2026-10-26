import { game } from './game.js';

export const mailingConfig = { maxTextLength: game.maxMessageLength, batchSize: 20, intervalMs: 1000, migrationPageSize: 100 } as const;
