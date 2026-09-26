/**
 * `TrainerCommission.status` lifecycle (Phase 2, §1 / §12 Q2 addendum).
 *
 * Phase 2 sets `earned` exactly once at enrollment creation. P3-11 adds the
 * PT-owned, enrollment-cancellation transition `earned → clawed_back`; the state
 * value was pre-deployed, so this transition needs no schema migration.
 */
export enum TrainerCommissionStatus {
  PENDING = 'pending',
  EARNED = 'earned',
  CLAWED_BACK = 'clawed_back',
  PAID = 'paid',
}

export const TRAINER_COMMISSION_STATUS_VALUES = [
  TrainerCommissionStatus.PENDING,
  TrainerCommissionStatus.EARNED,
  TrainerCommissionStatus.CLAWED_BACK,
  TrainerCommissionStatus.PAID,
] as const;
