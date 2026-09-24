/**
 * What a turn cost, worked out as it happens.
 *
 * Metering here rather than trusting a monthly invoice is the difference
 * between a ceiling and a hope: the loop reads the month's total before every
 * call, so a runaway conversation stops itself instead of arriving as a bill.
 *
 * Rates are per million tokens, in US dollars, as published by Anthropic. They
 * move, so they are named and gathered in one place rather than scattered
 * through the code — when they change, this table is the only edit.
 */

export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_RATES: Record<string, ModelRates> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Shekels to the dollar.
 *
 * Deliberately a plain constant: the alternative is a live rate lookup on
 * every turn, which would add a network call and a failure mode to something
 * that only decides when to stop. Being a few percent out moves the ceiling by
 * a few percent, which is well inside what the ceiling is for.
 */
export const USD_TO_AGOROT = 370;

export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

/** What one turn cost, in agorot. */
export function costAgorot(model: string, u: TurnUsage): number {
  const r = MODEL_RATES[model] ?? MODEL_RATES[DEFAULT_MODEL];
  const usd =
    (u.input_tokens * r.input +
      u.output_tokens * r.output +
      u.cache_read_tokens * r.cacheRead +
      u.cache_write_tokens * r.cacheWrite) /
    1_000_000;
  return Math.round(usd * USD_TO_AGOROT);
}

/** The usage block the API returns, in the shape the meter wants. */
export function readUsage(usage: Record<string, number> | null | undefined): TurnUsage {
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage?.cache_creation_input_tokens ?? 0,
  };
}
