export type PromoCurrency = 'kc' | 'euro' | 'bitcoin';

export type PromoDraft =
  | { step: 'currency' }
  | { step: 'name'; currency: PromoCurrency }
  | { step: 'amount'; currency: PromoCurrency; name: string }
  | { step: 'quantity'; currency: PromoCurrency; name: string; amount: number }
  | { step: 'confirm'; currency: PromoCurrency; name: string; amount: number; quantity: number; token: string }
  | { step: 'activate' };

export interface Promo {
  _id: string;
  ownerId: number;
  currency: PromoCurrency;
  amount: number;
  quantity: number;
  remaining: number;
}

export interface PromoRedemption {
  _id: string;
  promoName: string;
  vkId: number;
}

export type PromoCommand =
  | { kind: 'promo' | 'promo_create' | 'promo_activate' | 'promo_back' }
  | { kind: 'promo_currency'; currency: PromoCurrency }
  | { kind: 'promo_confirm'; token: string }
  | { kind: 'promo_list'; after: string | null };

export type PromoCreation = 'created' | 'exists' | 'funds';
export type PromoActivation = 'redeemed' | 'already' | 'empty' | 'own' | 'balance_limit';
