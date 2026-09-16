/**
 * Response DTO for `GET /v1/members/:memberId/360/header`.
 *
 * Aggregates data from Members, Memberships, Attendance, Measurements, PT,
 * Workouts, and Diet modules — a pure read-side composition with no new entities.
 *
 * §7: The header combines member profile, membership status, attendance/access
 * status, quick actions, and latest measurement values in a single response.
 */
export interface Member360HeaderResponse {
  member: {
    id: string;
    localId: number;
    firstName: string;
    lastName: string;
    photo?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  membership: {
    status: string | null;
    planId: string | null;
    endDate: string | null;
    daysRemaining: number | null;
  } | null;
  accessStatus: {
    today: 'granted' | 'denied' | 'not_checked_in';
    lastCheckIn: string | null;
  };
  currentMeasurements: {
    weight: string | null;
    bodyFat: string | null;
    height: string | null;
  };
  quickActions: string[];
  /** Count of active PT enrollments (used by quick-action rule for "Book PT"). */
  activePtEnrollmentCount: number;
  /** Whether there's at least one active PT enrollment with remaining sessions. */
  hasRemainingPtSessions: boolean;
}

export interface QuickActionEvaluationInput {
  checkedInToday: boolean;
  hasActiveMembership: boolean;
  membershipEndDate: string | null;
  hasActivePtEnrollment: boolean;
  hasRemainingPtSessions: boolean;
}

/**
 * Compute quick action codes from member state.
 *
 * §12 Q26 (with the Q23-style doc correction — the committed Q26 text originally
 * omitted the "or no enrollment" clause for "Book PT"; it has been restored here and
 * in docs/phase2-scoping-plan.md). Five rules:
 *   - "check_in"    — not checked in today AND active membership
 *   - "renew"       — membership expires in ≤30 days
 *   - "book_pt"     — active PT enrollment with sessions_remaining > 0, OR no
 *                      enrollment at all (to prompt a new member to start one)
 *   - "log_workout" — always shown
 *   - "log_meal"    — always shown
 */
export function computeQuickActions(input: QuickActionEvaluationInput): string[] {
  const actions: string[] = [];

  if (!input.checkedInToday && input.hasActiveMembership) {
    actions.push('check_in');
  }

  if (input.membershipEndDate) {
    const daysUntilExpiry = computeDaysUntilExpiry(input.membershipEndDate);
    if (daysUntilExpiry <= 30) {
      actions.push('renew');
    }
  }

  // "Book PT": active enrollment with remaining sessions, OR no enrollment at all.
  // The corrected Q26 boundary — an ACTIVE enrollment with sessions_remaining === 0
  // does NOT show it.
  if (
    (input.hasActivePtEnrollment && input.hasRemainingPtSessions) ||
    !input.hasActivePtEnrollment
  ) {
    actions.push('book_pt');
  }

  // Always shown per Q26.
  actions.push('log_workout');
  actions.push('log_meal');

  return actions;
}

function computeDaysUntilExpiry(endDate: string): number {
  const now = new Date();
  const end = new Date(endDate + 'T23:59:59.999Z');
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}