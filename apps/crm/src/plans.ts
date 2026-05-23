export const subscriptionPlans = [
  {
    code: 'basic',
    productCode: 'basic-sandbox',
    title: 'Basic Sandbox Plan',
    description: 'Plan bazowy.',
    isActive: true,
    entitlements: {
      sandboxCount: 1,
      openRouterTokensUsageUsd: 50, // $50 worth of OpenRouter tokens included",
    },
    prices: [
      {
        code: 'basic-monthly-pln-v1',
        providerKey: 'stripe',
        currencyCode: 'PLN',
        interval: 'month',
        intervalCount: 1,
        unitAmountMinor: 9900, // 99.00 PLN
        trialDays: 0,
        isDefault: true,
        isActive: true,
        stripe: {
          productLookupKey: 'basic-sandbox',
          priceLookupKey: 'basic-sandbox-monthly-pln-v1',
          taxBehavior: 'exclusive',
        },
      },
    ],
  },
]

export default subscriptionPlans