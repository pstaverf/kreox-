import type { Command } from '../types/game.js';
import type { PrivateCasinoCommand } from '../types/private-casino.js';

export function isPrivateCasinoCommand(command: Command): command is PrivateCasinoCommand {
  return command.kind === 'casino' || command.kind === 'casino_chats' || command.kind === 'jackpot'
    || command.kind === 'jackpot_join' || command.kind === 'coin' || command.kind === 'coin_flip' || command.kind === 'coin_cashout';
}
