/**
 * Yesterday's advertising spend, from Google.
 *
 * Written against the REST endpoints directly rather than through the Google
 * Ads client library: the library is large, carries a protobuf toolchain, and
 * all this needs is one number. Two requests — a token, then a query — is a
 * thing that can be read and checked.
 *
 * Everything it needs is an environment variable on the server. No Google
 * credential reaches the browser.
 */

// both endpoints are named rather than hardcoded so the nightly job can be
// pointed at a stand-in and proven end to end without touching a real account
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API_BASE = process.env.GOOGLE_ADS_API_BASE || "https://googleads.googleapis.com";
// the API is versioned in its path and Google retires old versions, so it is
// named here: a version bump becomes a setting rather than a code change
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v21";

export interface AdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
  developerToken?: string;
}

export function adsConfig(): AdsConfig | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  // Google writes the account number with dashes; the API wants it without
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
  if (!clientId || !clientSecret || !refreshToken || !customerId) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, ""),
    // retired in September 2026 but still accepted, and still wanted by older
    // accounts — sent when there is one, omitted when there is not
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
}

async function accessToken(config: AdsConfig): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Google refused the sign-in (${response.status}): ${body?.error_description ?? body?.error ?? "unknown"}`
    );
  }
  return body.access_token as string;
}

/**
 * The date in Israel, whatever the server thinks the time is.
 *
 * A job that runs just after midnight local time is, in UTC, still yesterday —
 * so a date taken from the server's own clock would record the wrong day for
 * half the year. The business's calendar decides which day this is.
 */
export function israelDate(offsetDays = 0, now = new Date()): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** What one day's advertising cost, in agorot. */
export async function spendForDay(config: AdsConfig, day: string): Promise<number> {
  const token = await accessToken(config);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (config.developerToken) headers["developer-token"] = config.developerToken;
  if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

  const response = await fetch(
    `${API_BASE}/${API_VERSION}/customers/${config.customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `SELECT metrics.cost_micros FROM customer WHERE segments.date = '${day}'`,
      }),
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Google Ads refused the query (${response.status}): ${raw.slice(0, 400)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Google Ads returned something that is not JSON: ${raw.slice(0, 200)}`);
  }

  // searchStream answers with an array of batches, each holding results
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  let micros = 0;
  for (const batch of batches as { results?: { metrics?: { costMicros?: string | number } }[] }[]) {
    for (const row of batch.results ?? []) {
      micros += Number(row.metrics?.costMicros ?? 0);
    }
  }

  // a million micros is one shekel, and a shekel is a hundred agorot
  return Math.round(micros / 10_000);
}
