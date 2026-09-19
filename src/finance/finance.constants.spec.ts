import {
  TAX_EXEMPT_NAME,
  TAX_RATE_UNIT,
  computeInvoiceTotals,
  computeLineTax,
  sumMoney,
  toMoney,
} from './finance.constants';

/**
 * P3-04 tax arithmetic — `docs/phase3-scoping-plan.md` §4.
 *
 * This is the highest-value file of the task. Every other P3-04 behaviour is
 * plumbing around three properties, and each of them is a property an outside
 * observer can only detect as "the numbers are wrong":
 *
 *   1. a line's parts ADD UP (`net + tax === gross`) — otherwise a printed invoice
 *      does not reconcile with itself;
 *   2. `subtotal` is NET of tax (§15 Q9) and `total_amount` is what the member
 *      owes, for BOTH exclusive and inclusive rates;
 *   3. `Invoice.tax_amount` equals the sum of the applied tax lines to the cent —
 *      the property a tax authority's report reconciles against.
 *
 * The tests are written as exact strings rather than numeric comparisons because
 * the values are 2-decimal money strings end to end; `toBeCloseTo` would hide
 * exactly the rounding error this file exists to catch.
 */
describe('finance constants — P3-04 tax arithmetic', () => {
  describe('computeLineTax', () => {
    it('keeps the line amount as net and adds tax ON TOP for an exclusive rate', () => {
      // 100.00 @ 18% exclusive -> net 100.00, tax 18.00, member owes 118.00.
      const line = computeLineTax({ lineTotal: 100, ratePercent: 18, isInclusive: false });

      expect(line).toEqual({
        netAmount: '100.00',
        taxAmount: '18.00',
        grossAmount: '118.00',
      });
    });

    it('separates the tax that is ALREADY INSIDE the amount for an inclusive rate', () => {
      // 118.00 @ 18% inclusive -> the 18% is a share of the gross, so the tax is
      // 18.00 and the net is 100.00. The member owes the 118.00 that was entered —
      // an inclusive rate must never inflate the total.
      const line = computeLineTax({ lineTotal: 118, ratePercent: 18, isInclusive: true });

      expect(line).toEqual({
        netAmount: '100.00',
        taxAmount: '18.00',
        grossAmount: '118.00',
      });
    });

    it('charges no tax on a zero-rated line', () => {
      const line = computeLineTax({ lineTotal: 50, ratePercent: 0, isInclusive: false });

      expect(line).toEqual({ netAmount: '50.00', taxAmount: '0.00', grossAmount: '50.00' });
    });

    it('records the line with zero tax when the member is exempt', () => {
      // The exemption is passed IN rather than making the caller skip the line: an
      // exempt line still needs its amounts computed so the caller can write the
      // zero-rated audit row §4 requires.
      const line = computeLineTax({
        lineTotal: 100,
        ratePercent: 18,
        isInclusive: false,
        isExempt: true,
      });

      expect(line).toEqual({ netAmount: '100.00', taxAmount: '0.00', grossAmount: '100.00' });
    });

    it('treats an exempt line as untaxed even under an inclusive rate', () => {
      // Without the exemption short-circuit, an inclusive rate would BACK OUT tax
      // (net 100.00 from a 118.00 gross) and report 18.00 of tax for a member who
      // owes none. That is the subtlest way this feature can be wrong.
      const line = computeLineTax({
        lineTotal: 118,
        ratePercent: 18,
        isInclusive: true,
        isExempt: true,
      });

      expect(line).toEqual({ netAmount: '118.00', taxAmount: '0.00', grossAmount: '118.00' });
    });

    it('treats a negative or unparseable rate as no tax rather than an error', () => {
      // Malformed rates are the caller's problem — TaxRatesService refuses to hand
      // one out. This helper is pure arithmetic and must not throw mid-invoice.
      expect(computeLineTax({ lineTotal: 10, ratePercent: -5, isInclusive: false })).toEqual({
        netAmount: '10.00',
        taxAmount: '0.00',
        grossAmount: '10.00',
      });
      expect(
        computeLineTax({ lineTotal: 10, ratePercent: 'nonsense', isInclusive: false }),
      ).toEqual({ netAmount: '10.00', taxAmount: '0.00', grossAmount: '10.00' });
    });

    it('rounds the tax ONCE and derives the net so net + tax equals gross exactly', () => {
      // 0.05 @ 18% inclusive -> tax 0.0076... rounds to 0.01, so the net is
      // 0.05 - 0.01 = 0.04. Deriving the net (instead of rounding it separately)
      // is what guarantees the parts add up.
      expect(computeLineTax({ lineTotal: 0.05, ratePercent: 18, isInclusive: true })).toEqual({
        netAmount: '0.04',
        taxAmount: '0.01',
        grossAmount: '0.05',
      });

      // The general invariant, checked over a spread of awkward inputs.
      for (const lineTotal of [0.01, 0.05, 0.1, 1, 9.99, 33.33, 1234.56]) {
        for (const ratePercent of [5, 7.5, 18, 20.5]) {
          for (const isInclusive of [true, false]) {
            const line = computeLineTax({ lineTotal, ratePercent, isInclusive });
            expect(toMoney(Number(line.netAmount) + Number(line.taxAmount))).toBe(line.grossAmount);
          }
        }
      }
    });

    it('never makes an inclusive line cost more than the amount entered', () => {
      for (const lineTotal of [0.05, 1, 99.99, 100]) {
        const line = computeLineTax({ lineTotal, ratePercent: 18, isInclusive: true });
        expect(Number(line.grossAmount)).toBeLessThanOrEqual(Number(toMoney(lineTotal)));
      }
    });
  });

  describe('computeInvoiceTotals', () => {
    it('sums net and tax separately and adds them for the total', () => {
      const totals = computeInvoiceTotals([
        computeLineTax({ lineTotal: 100, ratePercent: 18, isInclusive: false }),
        computeLineTax({ lineTotal: 7.5, ratePercent: 18, isInclusive: false }),
      ]);

      // 100.00 + 18.00 = 118.00 and 7.50 + 1.35 = 8.85 -> net 107.50, tax 19.35.
      expect(totals).toEqual({
        subtotal: '107.50',
        taxAmount: '19.35',
        totalAmount: '126.85',
      });
    });

    it('reports subtotal NET of tax and total as what the member owes, for an inclusive rate', () => {
      const totals = computeInvoiceTotals([
        computeLineTax({ lineTotal: 118, ratePercent: 18, isInclusive: true }),
      ]);

      // §15 Q9: subtotal is net of tax even when the rate is inclusive, so the
      // same three columns mean the same thing under both regimes.
      expect(totals).toEqual({
        subtotal: '100.00',
        taxAmount: '18.00',
        totalAmount: '118.00',
      });
    });

    it('sums the PER-LINE tax rather than recomputing it from the summed subtotal', () => {
      // Three 0.05 lines at 18% exclusive: per-line tax is round(0.009) = 0.01, so
      // the lines carry 0.03 of tax. The assertion pins the per-line sum and the
      // invariant that the total equals sum(net) + sum(tax) — which is what makes
      // Invoice.tax_amount reconcile with the FINANCE_TAX_LINES rows.
      const lines = Array.from({ length: 3 }, () =>
        computeLineTax({ lineTotal: 0.05, ratePercent: 18, isInclusive: false }),
      );
      const totals = computeInvoiceTotals(lines);

      expect(totals.taxAmount).toBe(sumMoney(lines.map((line) => line.taxAmount)));
      expect(totals.subtotal).toBe(sumMoney(lines.map((line) => line.netAmount)));
      expect(totals.totalAmount).toBe(sumMoney([totals.subtotal, totals.taxAmount]));
    });

    it('returns zeroes for an invoice with no lines', () => {
      expect(computeInvoiceTotals([])).toEqual({
        subtotal: '0.00',
        taxAmount: '0.00',
        totalAmount: '0.00',
      });
    });
  });

  describe('constants', () => {
    it('documents the rate unit as a percentage', () => {
      // TaxRate.rate is NUMERIC(5,2) meaning 18.00 === 18%. If this ever becomes a
      // fraction, every arithmetic test above silently changes meaning.
      expect(TAX_RATE_UNIT).toBe('percent');
    });

    it('uses one label for an exempt line so tax reports can group by it', () => {
      expect(TAX_EXEMPT_NAME).toBe('Tax exempt');
    });
  });
});
