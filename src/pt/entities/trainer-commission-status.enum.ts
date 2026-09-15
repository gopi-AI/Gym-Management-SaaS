/**
 * `TrainerCommission.status` lifecycle (Phase 2, §1 / §12 Q2 addendum).
 *
 * Phase 2 sets `earned` exactly once, at enrollment creation, and **never
 * transitions it**: there is no clawback API, no cancellation handler and no
 * worker in this module. `pending` / `clawed_back` are pre-deployed so the
 * Phase 3 finance flow ("earned → clawed_back" on cancellation/refund) needs no
 * schema migration.
 */
export enum TrainerCommissionStatus {
  PENDING = 'pending',
  EARNED = 'earned',
  CLAWED_BACK = 'clawed_back',
}

export const TRAINER_COMMISSION_STATUS_VALUES = [
  TrainerCommissionStatus.PENDING,
  TrainerCommissionStatus.EARNED,
  TrainerCommissionStatus.CLAWED_BACK,
] as const;
