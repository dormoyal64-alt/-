// @ts-check
/**
 * Generic HTTP mailer: POSTs `{from, to, subject, text, html, lang, tag}` as JSON to MAIL_HTTP_URL
 * with `Authorization: Bearer MAIL_HTTP_TOKEN`. Adapt a transactional e-mail service (or a tiny
 * relay) to accept this shape.
 */

/**
 * @param {{url: string, token: string|null, from: string, logger: {warn: Function}, fetchImpl?: typeof fetch, timeoutMs?: number}} opts
 * @returns {import('./index.js').Mailer}
 */
export function createHttpMailer({ url, token, from, logger, fetchImpl = fetch, timeoutMs = 10_000 }) {
  return {
    id: 'http',
    async send(msg) {
      /** @type {Record<string, string>} */
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, lang: msg.lang, tag: msg.tag }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        logger.warn(`[mail:http] delivery failed with HTTP ${res.status}`);
        throw new Error(`mail delivery failed: HTTP ${res.status}`);
      }
    },
  };
}
