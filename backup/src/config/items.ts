export const itemConfig = {
  maxBatch: 1000,
  offerDurationMs: 10 * 60 * 1000,
  catalog: [
    { id: 1, kind: 'zhdun_case', name: '💼 Кейс «Ждун»' },
    { id: 2, kind: 'referral_case', name: '👬 Кейс «Реферальный»' },
    { id: 3, kind: 'croupier', name: '🤴 Крупьер' },
    { id: 4, kind: 'boss_case:💙:Ахиллес', name: '💙 Босс-кейс (Ахиллес)' },
    { id: 5, kind: 'aristocrat_case', name: '🏛️ Кейс «Аристократ»' }
  ],
  drops: [
    { currency: 'kc', amount: 150_000, weight: 30 },
    { currency: 'kc', amount: 250_000, weight: 30 },
    { currency: 'kc', amount: 1_500_000, weight: 30 },
    { currency: 'euro', amount: 100, weight: 5 },
    { currency: 'euro', amount: 200, weight: 3 },
    { currency: 'euro', amount: 500, weight: 2 }
  ]
} as const;
