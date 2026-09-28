// @ts-check
/** Thrown by adapters' verifyAndParseWebhook(); the webhook route answers 400 with `code`. */
export class WebhookVerificationError extends Error {
  /** @param {string} message @param {'INVALID_SIGNATURE'|'INVALID_PAYLOAD'} [code] */
  constructor(message, code = 'INVALID_SIGNATURE') {
    super(message);
    this.name = 'WebhookVerificationError';
    this.code = code;
  }
}
