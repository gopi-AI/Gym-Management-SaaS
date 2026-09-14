/**
 * Shared analysis-window contract for the CURRENT AI use cases.
 *
 * Retention analysis and plan-performance analysis are separate business
 * contracts, but both scope their dataset with the SAME bounded set of windows
 * and both embed the identical `{label, days, from, to}` descriptor in the
 * prompt payload. Each service previously carried its own private copy of that
 * map and resolver; a divergence between the two copies (or with the request
 * DTOs' `@IsIn(...)` lists) would silently change the numbers the API reports
 * for the same request.
 *
 * This module is deliberately pure and business-agnostic: it knows about
 * calendar arithmetic only — never about members, plans, retention rates or
 * provider calls.
 */

/** Windows accepted by every AI analysis endpoint. Bounded by design. */
export const AI_ANALYSIS_PERIODS = ['30d', '90d', '1y'] as const;

/** One supported analysis window label. */
export type AiAnalysisPeriod = (typeof AI_ANALYSIS_PERIODS)[number];

/** Window applied when the request omits `period`. */
export const AI_ANALYSIS_DEFAULT_PERIOD: AiAnalysisPeriod = '90d';

const MS_PER_DAY = 86_400_000;

const PERIOD_DAYS: Record<AiAnalysisPeriod, number> = { '30d': 30, '90d': 90, '1y': 365 };

/**
 * Period descriptor embedded in the prompt payload and used for date scoping.
 *
 * `from`/`to` are server-computed ISO timestamps; the model never supplies or
 * influences them.
 */
export interface AiAnalysisWindow<P extends string = AiAnalysisPeriod> {
  label: P;
  from: string;
  to: string;
  days: number;
}

/**
 * Resolves a window label into the concrete `[from, to]` range the analysis
 * runs over. `now` is injectable so the arithmetic is deterministically
 * testable.
 */
export function resolveAnalysisWindow<P extends AiAnalysisPeriod>(
  label: P,
  now: Date = new Date(),
): AiAnalysisWindow<P> {
  const days = PERIOD_DAYS[label];
  const from = new Date(now.getTime() - days * MS_PER_DAY);
  return { label, days, from: from.toISOString(), to: now.toISOString() };
}
