import type { CasinoRandom } from '../types/casino.js';
import type { GameInput, Player, Reply } from '../types/game.js';
import type { PrivateCasinoCommand } from '../types/private-casino.js';
import type { GameStore } from '../types/storage.js';
import { casinoLobbyText, privateCasinoTexts } from './private-casino-texts.js';
import { coinAction, openCoin } from './coin.js';
import { jackpotAction } from './jackpot.js';

export async function privateCasinoAction(store: GameStore, player: Player, command: PrivateCasinoCommand, input: GameInput, random: CasinoRandom): Promise<Reply> {
  if (input.isChat) return { text: privateCasinoTexts.private, keyboard: { kind: 'none' } };
  switch (command.kind) {
    case 'casino': {
      const dealer = await store.dealer();
      const holder = dealer.holderId === null ? null : await store.player(dealer.holderId);
      return { text: casinoLobbyText(player, holder, dealer.earnedKC), keyboard: { kind: 'casino' } };
    }
    case 'casino_chats': return { text: privateCasinoTexts.chats, keyboard: { kind: 'casino_chats' } };
    case 'jackpot': return jackpotAction(store, player, false, input, random);
    case 'jackpot_join': return jackpotAction(store, player, true, input, random);
    case 'coin': return openCoin(store, player, input);
    case 'coin_flip': case 'coin_cashout': return coinAction(store, player, command, random);
  }
}
