export type BalanceOperation = 'set' | 'add';

export type AdminBalanceCommand =
  | { kind: 'admin_balance'; operation: BalanceOperation; targetId: number | null; amount: number }
  | { kind: 'admin_balance_invalid' };
