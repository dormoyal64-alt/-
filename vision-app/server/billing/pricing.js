// @ts-check
/**
 * Regions, provider routing and renewal semantics (docs/research/business-legal-payments.md 1.5, 3.2, 3.5).
 *
 * - Region IL (ILS, PayPlus): monthly auto-renews (our scheduler charges the saved token); quarterly and
 *   yearly are prepaid fixed terms that NEVER renew without explicit consent (POST /api/billing/renew).
 * - Region INTL (USD, Paddle as Merchant of Record): every plan auto-renews at Paddle.
 */

/** @typedef {'IL'|'INTL'} Region */
/**
 * @typedef {object} RegionPricing
 * @property {Region} region
 * @property {string} currency
 * @property {import('./plans.js').Plan[]} plans
 */

/**
 * Picks the customer's region from explicit hints (declared country / currency) or a trusted geo header.
 * Hebrew-first product: defaults to IL.
 * @param {{country?: unknown, currency?: unknown, geoCountry?: unknown}} hints
 * @param {{currency: string}} config
 * @returns {Region}
 */
export function resolveRegion(hints, config) {
  const country = typeof hints.country === 'string' && /^[A-Za-z]{2}$/.test(hints.country) ? hints.country.toUpperCase() : null;
  if (country) return country === 'IL' ? 'IL' : 'INTL';
  const currency = typeof hints.currency === 'string' && /^[A-Za-z]{3}$/.test(hints.currency) ? hints.currency.toUpperCase() : null;
  if (currency) return currency === config.currency ? 'IL' : 'INTL';
  const geo = typeof hints.geoCountry === 'string' && /^[A-Za-z]{2}$/.test(hints.geoCountry) ? hints.geoCountry.toUpperCase() : null;
  if (geo && geo !== 'XX') return geo === 'IL' ? 'IL' : 'INTL';
  return 'IL';
}

/**
 * Chooses the adapter for a region. With one configured provider it is used for everyone and its own
 * region (if any) wins; with several (PAYMENT_PROVIDER=auto) the adapter serving the region is used.
 * @param {Region} requested
 * @param {Map<string, import('./providers/index.js').PaymentProvider>} providers
 * @returns {{region: Region, provider: import('./providers/index.js').PaymentProvider}}
 */
export function routeProvider(requested, providers) {
  const list = [...providers.values()];
  if (list.length === 1) return { region: list[0].region ?? requested, provider: list[0] };
  const match = list.find((p) => p.region === requested) ?? list.find((p) => !p.region) ?? list[0];
  return { region: match.region ?? requested, provider: match };
}

/**
 * @param {Region} region
 * @param {string} planId
 * @param {import('./providers/index.js').PaymentProvider} provider
 * @returns {'auto'|'manual'}
 */
export function renewalFor(region, planId, provider) {
  if (provider.capabilities?.managesRenewals) return 'auto';
  if (region === 'IL') return planId === 'monthly' ? 'auto' : 'manual';
  return 'auto';
}

/**
 * Plans for a region with `renewal` and `provider` filled in (GET /api/plans).
 * @param {{pricing: {IL: RegionPricing, INTL: RegionPricing}}} config
 * @param {Region} region
 * @param {import('./providers/index.js').PaymentProvider} provider
 */
export function plansFor(config, region, provider) {
  const p = config.pricing[region];
  return {
    region,
    currency: p.currency,
    provider: provider.id,
    plans: p.plans.map((plan) => ({ ...plan, renewal: renewalFor(region, plan.id, provider), provider: provider.id })),
  };
}
