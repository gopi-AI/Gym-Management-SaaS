import {
  AGEING_BUCKETS,
  AGEING_BUCKET_ORDER,
  FINANCE_LEDGER_VIEWS,
  OUTSTANDING_STATUS_ORDER,
  REPORT_PERIODS,
  SETTLED_INVOICE_STATUSES,
  SQL_DAYS_OVERDUE,
  SQL_OUTSTANDING_STATUSES,
  SQL_SUCCEEDED_PAYMENT,
  ageingBucket,
  ageingBucketIndex,
  outstandingStatusIndex,
  sqlAgeingBucketCase,
  sqlIdentifier,
  sqlStringList,
  sqlStringLiteral,
} from './ledger.constants';
import {
  INVOICE_STATUS,
  OUTSTANDING_INVOICE_STATUSES,
  PAYMENT_STATUS,
} from './finance.constants';

/**
 * P3-01 ledger read model — constant lockstep.
 *
 * The views are generated SQL, so the risk this file exists to close is silent
 * divergence: if `OUTSTANDING_INVOICE_STATUSES` ever gains `paid`, or the
 * invoice state machine is renamed, the generated view must change with it. These
 * assertions fail loudly at that moment instead of letting a report quietly
 * disagree with the write path.
 */
describe('finance ledger constants (P3-01)', () => {
  it('derives the view status list from OUTSTANDING_INVOICE_STATUSES', () => {
    expect(SQL_OUTSTANDING_STATUSES).toBe(sqlStringList(OUTSTANDING_INVOICE_STATUSES));
    // draft + sent + partially_paid, in that order.
    expect(SQL_OUTSTANDING_STATUSES).toBe("'draft', 'sent', 'partially_paid'");
  });

  it('derives the revenue view payment status from PAYMENT_STATUS.SUCCEEDED', () => {
    expect(SQL_SUCCEEDED_PAYMENT).toBe(sqlStringLiteral(PAYMENT_STATUS.SUCCEEDED));
    expect(SQL_SUCCEEDED_PAYMENT).toBe("'succeeded'");
  });

  it('keeps paid and void out of the outstanding views', () => {
    for (const status of SETTLED_INVOICE_STATUSES) {
      expect(OUTSTANDING_INVOICE_STATUSES).not.toContain(status);
    }
    expect(SETTLED_INVOICE_STATUSES).toEqual([
      INVOICE_STATUS.PAID,
      INVOICE_STATUS.VOID,
    ]);
  });

  it('names the three views with the V_ prefix (plain views, not materialized)', () => {
    const views = Object.values(FINANCE_LEDGER_VIEWS);

    expect(views).toHaveLength(3);
    for (const view of views) {
      expect(view).toMatch(/^V_FINANCE_/);
      // An `MV_` prefix would advertise a materialized view, which P3-01 does
      // not create (and whose staleness the API would then have to explain).
      expect(view).not.toMatch(/^MV_/);
    }
    expect(new Set(views).size).toBe(3);
  });

  it('exposes the approved ageing buckets in severity order', () => {
    expect(AGEING_BUCKET_ORDER).toEqual(['current', '1-30', '31-60', '61-90', '90+']);
    // Exactly one open-ended bucket, and it is the last one.
    expect(AGEING_BUCKETS.filter((bucket) => bucket.maxDaysOverdue === null)).toHaveLength(1);
    expect(AGEING_BUCKETS[AGEING_BUCKETS.length - 1].maxDaysOverdue).toBeNull();
    // Contiguous and non-overlapping: each upper bound is followed by the next
    // lower bound minus one.
    for (let index = 1; index < AGEING_BUCKETS.length; index += 1) {
      expect(AGEING_BUCKETS[index].minDaysOverdue).toBe(
        (AGEING_BUCKETS[index - 1].maxDaysOverdue as number) + 1,
      );
    }
  });

  describe('ageingBucket', () => {
    it.each([
      [-5, 'current'],
      [0, 'current'],
      [1, '1-30'],
      [30, '1-30'],
      [31, '31-60'],
      [60, '31-60'],
      [61, '61-90'],
      [90, '61-90'],
      [91, '90+'],
      [365, '90+'],
    ])('maps %i days overdue to %s', (days, expected) => {
      expect(ageingBucket(days)).toBe(expected);
    });

    it('treats a non-finite day count as not yet due', () => {
      // A non-finite count cannot be trusted, so it falls into the benign
      // bucket rather than being reported as the most severe one.
      expect(ageingBucket(Number.NaN)).toBe('current');
      expect(ageingBucket(Number.POSITIVE_INFINITY)).toBe('current');
    });

    it('orders buckets by severity, unknown labels last', () => {
      expect(ageingBucketIndex('current')).toBeLessThan(ageingBucketIndex('1-30'));
      expect(ageingBucketIndex('61-90')).toBeLessThan(ageingBucketIndex('90+'));
      expect(ageingBucketIndex('mystery')).toBe(AGEING_BUCKET_ORDER.length);
    });
  });

  it('generates an ageing CASE covering every bucket, evaluated per invoice', () => {
    const sql = sqlAgeingBucketCase(SQL_DAYS_OVERDUE);

    // Four bounded branches + an ELSE for the open bucket.
    expect(sql.match(/WHEN/g)).toHaveLength(AGEING_BUCKETS.length - 1);
    for (const bucket of AGEING_BUCKET_ORDER) {
      expect(sql).toContain(`'${bucket}'`);
    }
    expect(sql.startsWith('CASE ')).toBe(true);
    expect(sql.endsWith(`ELSE '${AGEING_BUCKET_ORDER[AGEING_BUCKET_ORDER.length - 1]}' END`)).toBe(
      true,
    );
    expect(sql).toContain(SQL_DAYS_OVERDUE);
  });

  it('never reports a negative day count', () => {
    expect(SQL_DAYS_OVERDUE).toContain('GREATEST');
    expect(SQL_DAYS_OVERDUE).toContain('CURRENT_DATE');
  });

  it('orders the outstanding report by status in the state-machine order', () => {
    expect(OUTSTANDING_STATUS_ORDER).toEqual(OUTSTANDING_INVOICE_STATUSES);
    expect(outstandingStatusIndex('draft')).toBe(0);
    expect(outstandingStatusIndex('sent')).toBe(1);
    expect(outstandingStatusIndex('partially_paid')).toBe(2);
    expect(outstandingStatusIndex('paid')).toBe(OUTSTANDING_STATUS_ORDER.length);
  });

  it('accepts the three documented report granularities', () => {
    expect(REPORT_PERIODS).toEqual(['day', 'week', 'month']);
  });

  describe('SQL quoting helpers', () => {
    it('escapes identifiers', () => {
      expect(sqlIdentifier('V_FINANCE_MEMBER_OUTSTANDING')).toBe('"V_FINANCE_MEMBER_OUTSTANDING"');
      expect(sqlIdentifier('we"ird')).toBe('"we""ird"');
    });

    it('escapes string literals', () => {
      expect(sqlStringLiteral("o'brien")).toBe("'o''brien'");
      expect(sqlStringList(['a', 'b'])).toBe("'a', 'b'");
    });
  });
});
