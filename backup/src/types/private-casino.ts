export type CoinSide = 'diamond' | 'emerald';
export type PrivateCasinoCommand =
  | { kind: 'casino' | 'casino_chats' | 'jackpot' | 'jackpot_join' | 'coin' }
  | { kind: 'coin_flip'; side: CoinSide; token: string; step: number }
  | { kind: 'coin_cashout'; token: string; step: number };
export type PrivateCasinoKeyboard =
  | { kind: 'casino' | 'casino_chats' | 'jackpot' }
  | { kind: 'coin'; token: string; step: number };
export interface CoinState {
  _id: string; kind: 'coin'; version: number; vkId: number; sessionId: string;
  stage: 'ready' | 'staked' | 'playing' | 'finished'; amount: number; history: CoinSide[];
}
export interface JackpotState {
  _id: string; kind: 'jackpot'; version: number; roundId: string; dueAt: Date; amount: number; participants: number;
}
export interface JackpotEntry {
  _id: string; kind: 'jackpot_entry'; version: number; roundId: string; vkId: number;
}
export interface JackpotDraw {
  _id: string; kind: 'jackpot_draw'; version: number; roundId: string; winnerId: number; announcement: string;
  stage: 'broadcast' | 'finished'; afterEntry: string; dueAt: Date;
}
