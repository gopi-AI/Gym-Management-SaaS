export enum AssignmentStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
}

export const ASSIGNMENT_STATUS_VALUES: readonly AssignmentStatus[] =
  Object.values(AssignmentStatus);