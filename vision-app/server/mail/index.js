// @ts-check
import { createConsoleMailer } from './console.js';
import { createHttpMailer } from './http.js';

/**
 * Mailer interface. Tests inject their own implementation (e.g. one that captures messages).
 * @typedef {object} Mailer
 * @property {string} id
 * @property {(msg: import('./templates.js').MailMessage) => Promise<void>} send
 */

/**
 * @param {import('../config.js').Config} config
 * @param {{info: Function, warn: Function, error: Function}} logger
 * @returns {Mailer}
 */
export function createMailer(config, logger) {
  if (config.mailProvider === 'http') {
    return createHttpMailer({ url: /** @type {string} */ (config.mailHttpUrl), token: config.mailHttpToken, from: config.mailFrom, logger });
  }
  return createConsoleMailer({ logger, isProduction: config.isProduction });
}
