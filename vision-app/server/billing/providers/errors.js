// @ts-check
/** Thrown by adapters' verifyAndParseWebhook(); the webhook route answers 400 with `code`. */
export class WebhookVerificationError extends Error {
  /** @param {string} message @param {'INVALID_SIGNATURE'|'INVALID_PAYLOAD'|'AMOUNT_MISMATCH'} [code] */
  constructor(message, code = 'INVALID_SIGNATURE') {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
  }
}

/** A provider API call failed or returned something we cannot interpret. */
export class ProviderError extends Error {
  /** @param {string} message @param {{status?: number, code?: string}} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = info.status;
    this.code = info.code;
  }
}
