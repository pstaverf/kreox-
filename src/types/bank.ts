import type { BalanceCurrency } from './admin-balance.js';
import type { PlayerTarget } from './items.js';
import type { Player } from './game.js';

export type DepositDays = 3 | 10;
export type BankCommand =
  | { kind: 'city' | 'casino' | 'bank' | 'bank_savings' | 'bank_deposit_money' | 'bank_withdraw_money' | 'bank_transfer_menu' | 'bank_deposits' | 'bank_deposit_create' | 'bank_pension' | 'bank_transfer_invalid' }
  | { kind: 'bank_currency'; currency: BalanceCurrency }
  | { kind: 'bank_transfer'; currency: BalanceCurrency; target: PlayerTarget | null; amount: number }
  | { kind: 'bank_deposit_amount'; amount: number }
  | { kind: 'bank_deposit_term'; days: DepositDays; token: string }
  | { kind: 'bank_deposit' | 'bank_deposit_early'; depositId: number }
  | { kind: 'bank_deposit_confirm'; token: string };
export type BankDraft =
  | { step: 'savings_amount'; direction: 'in' | 'out' }
  | { step: 'transfer_target'; currency: BalanceCurrency }
  | { step: 'transfer_amount'; currency: BalanceCurrency; targetId: number }
  | { step: 'deposit_amount' }
  | { step: 'deposit_days'; amount: number; token: string }
  | { step: 'deposit_early'; depositId: number; token: string };
export type BankKeyboard =
  | { kind: 'city' | 'bank' | 'bank_savings' | 'bank_transfer_menu' }
  | { kind: 'bank_back'; destination: 'bank' | 'bank_savings' | 'bank_transfer_menu' | 'bank_deposits' }
  | { kind: 'bank_deposits'; depositIds: number[] }
  | { kind: 'bank_deposit_amount'; amounts: number[] }
  | { kind: 'bank_deposit_term'; token: string }
  | { kind: 'bank_deposit_early'; depositId: number }
  | { kind: 'bank_deposit_confirm'; token: string };
export interface Deposit {
  _id: string;
  vkId: number;
  depositId: number;
  amount: number;
  days: DepositDays;
  createdAt: Date;
  expiresAt: Date;
  nextAttemptAt: Date;
  state: 'active' | 'completed' | 'early';
}
export interface BankStore {
  setBankDraft(vkId: number, draft: BankDraft | null): Promise<void>;
  saveSavings(player: Player, balance: number, since: Date, walletDelta: number): Promise<boolean>;
  transferMoney(sender: Player, receiver: Player, currency: BalanceCurrency, gross: number, net: number): Promise<boolean>;
  claimPension(player: Player, amount: number, now: Date): Promise<boolean>;
  deposits(vkId: number): Promise<Deposit[]>;
  deposit(vkId: number, depositId: number): Promise<Deposit | null>;
  nextDueDeposit(now: Date): Promise<Deposit | null>;
  createDeposit(player: Player, amount: number, days: DepositDays, now: Date): Promise<Deposit | 'funds' | 'limit'>;
  closeDeposit(player: Player, deposit: Deposit, payout: number, now: Date, early: boolean): Promise<boolean>;
  deferDeposit(deposit: Deposit, now: Date): Promise<void>;
}
