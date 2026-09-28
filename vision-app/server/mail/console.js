// @ts-check
/**
 * Development mailer: prints the message (including links) to the log.
 * In production it refuses to print message bodies (they contain secrets such as reset links).
 */

/**
 * @param {{logger: {info: Function, warn: Function}, isProduction: boolean}} opts
 * @returns {import('./index.js').Mailer}
 */
export function createConsoleMailer({ logger, isProduction }) {
  return {
    id: 'console',
    async send(msg) {
      if (isProduction) {
        logger.warn(`[mail:console] "${msg.tag}" e-mail NOT delivered: set MAIL_PROVIDER=http in production`);
        return;
      }
      logger.info(`[mail:console] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n[mail:console] end`);
    },
  };
}
