import type { DiceChat, DiceCredit } from './dice.js';
import type { CoinState, JackpotState, JackpotEntry, JackpotDraw } from './private-casino.js';
export type CasinoMode = 'crash' | 'dream' | 'roulette';
export type CasinoStake = number | 'half' | 'all';
export type CasinoLine = { mode: CasinoMode; amount: CasinoStake; target: number } | { error: string };
export type CasinoCommand =
  | { kind: 'casino_bets'; lines: CasinoLine[] }
  | { kind: 'casino_log'; mode: CasinoMode }
  | { kind: 'city_director' }
  | { kind: 'director_view' }
  | { kind: 'director_bid' }
  | { kind: 'director_confirm'; token: string };
export type DirectorDraft = { step: 'amount' } | { step: 'confirm'; amount: number; token: string; electionId: string };
export type CasinoKeyboard = { kind: 'director' | 'director_back' } | { kind: 'director_confirm'; token: string };
interface RecordBase { _id: string; version: number }
export interface CasinoRound extends RecordBase {
  kind: 'round'; peerId: number; mode: CasinoMode; roundId: string;
  stage: 'open' | 'closed' | 'waiting' | 'settling' | 'announcing' | 'finished';
  dueAt: Date; closesAt: Date; result: number; bonus: number;
  total: number; liability: number; losses: number; winners: number;
  buffer: string; pages: number; nextPage: number; dealerId: number | null;
  history: { result: number; bonus: number }[];
}
export interface CasinoBet extends RecordBase {
  kind: 'bet'; roundId: string; vkId: number; name: string; amount: number; target: number; settled: boolean;
}
export interface DirectorState extends RecordBase {
  kind: 'director'; holderId: number | null; earnedKC: number; electionId: string;
  dueAt: Date; total: number; participants: number;
}
export interface DirectorBid extends RecordBase {
  kind: 'bid'; electionId: string; vkId: number; amount: number; settled: boolean;
}
export interface DirectorElection extends RecordBase {
  kind: 'election'; electionId: string; winnerId: number | null; winnerStake: number;
  total: number; participants: number; announcement: string;
  stage: 'refunds' | 'broadcast' | 'finished'; afterChat: string; dueAt: Date;
}
export interface CasinoCredit extends RecordBase {
  kind: 'credit'; vkId: number; amount: number; destination: 'wallet' | 'dealer';
  notice: string; stage: 'pending' | 'paid'; dueAt: Date;
}
export interface CasinoChat extends RecordBase { kind: 'chat'; peerId: number; active: boolean }
export interface CasinoPage extends RecordBase { kind: 'page'; roundId: string; index: number; text: string }
export interface CasinoDelivery extends RecordBase { kind: 'delivery'; peerId: number; texts: string[]; index: number; stage: 'pending' | 'finished'; dueAt: Date }
export type CasinoRecord = DiceChat | DiceCredit | CoinState | JackpotState | JackpotEntry | JackpotDraw | CasinoDelivery | CasinoRound | CasinoBet | DirectorState | DirectorBid | DirectorElection | CasinoCredit | CasinoChat | CasinoPage;
export type CasinoQuery =
  | { kind: 'dice_chat' | 'dice_credit'; dueAt: Date }
  | { kind: 'jackpot_entries'; roundId: string; after: string }
  | { kind: 'jackpot_draw'; dueAt: Date }
  | { kind: 'roulette_photo'; after: string }
  | { kind: 'round' | 'election' | 'credit' | 'delivery'; dueAt: Date }
  | { kind: 'bet'; roundId: string; vkId?: number; settled?: boolean }
  | { kind: 'bid'; electionId: string; settled?: boolean }
  | { kind: 'chat'; after: string };
export interface CasinoStore {
  setDirectorDraft(vkId: number, draft: DirectorDraft | null): Promise<void>;
  casinoGet(id: string): Promise<CasinoRecord | null>;
  casinoList(query: CasinoQuery, limit: number): Promise<CasinoRecord[]>;
  casinoInsert(record: CasinoRecord): Promise<void>;
  casinoSave(record: CasinoRecord, notAfter?: Date): Promise<void>;
  casinoNotificationDone(id: string): Promise<boolean>;
  casinoDealerIncome(vkId: number, amount: number): Promise<boolean>;
}
export type CasinoRandom = (purpose: string, maximum: number) => number;
