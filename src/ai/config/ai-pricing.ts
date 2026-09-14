/**
 * Server-owned AI pricing table.
 *
 * Determinism / trust rules for cost telemetry and cost-limit enforcement:
 * - the price is ALWAYS resolved here, from this table, on the server. Neither
 *   the model output nor the provider response may supply a cost;
 * - the provider response contributes token COUNTS only;
 * - a model that is not listed here yields a `null` estimated cost — unknown
 *   pricing is never guessed and never invented;
 * - production boots with a cost limit active only for a priced model (see
 *   `validateEnv` in `src/app.module.ts`), so an unpriced model cannot silently
 *   bypass a monthly budget.
 *
 * Values are USD per 1,000,000 tokens, matching the published list prices of
 * the models referenced by the AI configuration.
 */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
};

/** True when a deterministic server-side price exists for `model`. */
export function isModelPriced(model: string): boolean {
  return Boolean(MODEL_PRICING[model]);
}

/**
 * Deterministic estimated cost for one provider call, serialized to the exact
 * numeric(12,6) shape of `AI_USAGE.estimated_cost_usd`.
 *
 * Returns `null` when the model has no server-side price (unknown pricing is
 * reported as unknown rather than fabricated).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    return null;
  }
  const input = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const output = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  const cost = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;
  return cost.toFixed(6);
}
