import {
  AI_ANALYSIS_DEFAULT_PERIOD,
  AI_ANALYSIS_PERIODS,
  resolveAnalysisWindow,
} from './ai-analysis-window';
import { RETENTION_PERIODS } from '../dto/retention-request.dto';
import { PLAN_PERFORMANCE_PERIODS } from '../dto/plan-performance-request.dto';

/**
 * The shared analysis-window contract used by both AI use cases.
 *
 * Pure arithmetic: no provider, no database, no HTTP.
 */
const NOW = new Date('2026-09-13T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

describe('ai-analysis-window', () => {
  it('keeps the window labels of both request DTOs in lockstep with the shared list', () => {
    expect(RETENTION_PERIODS).toBe(AI_ANALYSIS_PERIODS);
    expect(PLAN_PERFORMANCE_PERIODS).toBe(AI_ANALYSIS_PERIODS);
    expect(AI_ANALYSIS_PERIODS).toEqual(['30d', '90d', '1y']);
  });

  it('defaults to a supported window', () => {
    expect(AI_ANALYSIS_PERIODS as readonly string[]).toContain(AI_ANALYSIS_DEFAULT_PERIOD);
  });

  it('resolves each label into a server-computed [from, to] window of the right length', () => {
    const expectedDays: Record<string, number> = { '30d': 30, '90d': 90, '1y': 365 };

    for (const label of AI_ANALYSIS_PERIODS) {
      const window = resolveAnalysisWindow(label, NOW);

      expect(window.label).toBe(label);
      expect(window.days).toBe(expectedDays[label]);
      expect(window.to).toBe(NOW.toISOString());
      expect(window.from).toBe(new Date(NOW.getTime() - expectedDays[label] * MS_PER_DAY).toISOString());
      expect(Date.parse(window.from)).toBeLessThan(Date.parse(window.to));
    }
  });

  it('produces a deterministic, ISO-8601 window for a given clock', () => {
    expect(resolveAnalysisWindow('90d', NOW)).toEqual(resolveAnalysisWindow('90d', new Date(NOW)));
  });

  it('widens monotonically: 30d is the narrowest window and 1y the widest', () => {
    const thirty = resolveAnalysisWindow('30d', NOW);
    const ninety = resolveAnalysisWindow('90d', NOW);
    const year = resolveAnalysisWindow('1y', NOW);

    expect(Date.parse(thirty.from)).toBeGreaterThan(Date.parse(ninety.from));
    expect(Date.parse(ninety.from)).toBeGreaterThan(Date.parse(year.from));
  });
});
