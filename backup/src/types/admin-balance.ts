export type BalanceOperation = 'set' | 'add' | 'take';

export type BalanceCurrency = 'kc' | 'euro' | 'bitcoin';

export type AdminBalanceCommand =
  | { kind: 'admin_balance'; operation: BalanceOperation; targetId: number | null; amount: number; currency?: BalanceCurrency }
  | { kind: 'admin_balance_invalid'; currency?: BalanceCurrency };
