import { Injectable, NotFoundException } from '@nestjs/common';
import { MembersService } from './members.service';
import { MeasurementLogsService } from './measurement-logs.service';
import { ConsentsService } from './consents.service';
import { DocumentsService } from './documents.service';
import { MembershipsService } from '../../memberships/services/memberships.service';
import { AttendanceService } from '../../attendance/services/attendance.service';
import { PtEnrollmentsService } from '../../pt/services/pt-enrollments.service';
import { WorkoutsService } from '../../workouts/services/workouts.service';
import { DietService } from '../../diet/services/diet.service';
import {
  Member360HeaderResponse,
  computeQuickActions,
} from '../dto/member-360-header.dto';
import { PTEnrollmentStatus } from '../../pt/entities/pt-enrollment-status.enum';

/**
 * Aggregation/read service for the Member 360 Dashboard.
 *
 * **No new entities.** This is a pure orchestration layer that calls the
 * *exported* service methods of every Phase 2 module. It never reaches into
 * any module's repository directly (enforced by structural test).
 *
 * §7 Option A: a service inside `src/members/` that depends on services from
 * other modules injected via their exported providers.
 */
@Injectable()
export class Member360Service {
  constructor(
    private readonly membersService: MembersService,
    private readonly measurementLogsService: MeasurementLogsService,
    private readonly consentsService: ConsentsService,
    private readonly documentsService: DocumentsService,
    private readonly membershipsService: MembershipsService,
    private readonly attendanceService: AttendanceService,
    private readonly ptEnrollmentsService: PtEnrollmentsService,
    private readonly workoutsService: WorkoutsService,
    private readonly dietService: DietService,
  ) {}

  /**
   * Aggregated 360 header — the single endpoint that combines data from
   * multiple domains into one response (P2-01).
   *
   * Throws `NotFoundException` when the member does not belong to the caller's
   * org (propagated from `MembersService.findOne()`).
   */
  async getHeader(memberId: string): Promise<Member360HeaderResponse> {
    // --- Provider profile (org-scoped — throws if member not found in caller's org) ---
    const member = await this.membersService.findOne(memberId);
    const profile = await this.membersService.getProfile(memberId);

    // --- Active membership ---
    const membershipResult = await this.membershipsService.findByMember(memberId, {
      status: 'active',
    });
    const activeMembership = membershipResult.data.length > 0 ? membershipResult.data[0] : null;
    const hasActiveMembership = activeMembership !== null;
    const membership = activeMembership
      ? {
          status: activeMembership.status,
          planId: activeMembership.plan_id ?? null,
          endDate: activeMembership.end_date ?? null,
          daysRemaining: activeMembership.end_date
            ? computeDaysUntilExpiry(activeMembership.end_date)
            : null,
        }
      : null;

    // --- Attendance / access status ---
    let accessStatus: Member360HeaderResponse['accessStatus'];
    try {
      const summary = await this.attendanceService.getMemberSummaryForHeader(memberId);
      accessStatus = {
        today: summary.todayCheckedIn ? 'granted' : 'not_checked_in',
        lastCheckIn: summary.lastCheckIn,
      };
    } catch {
      // Not every environment may have the attendance module wired, but the
      // header should still return sensible defaults.
      accessStatus = { today: 'not_checked_in', lastCheckIn: null };
    }

    // --- Current measurements (from MemberProfile cache — O(1)) ---
    const currentMeasurements = {
      weight: profile?.weight ?? null,
      bodyFat: profile?.body_fat ?? null,
      height: profile?.height ?? null,
    };

    // --- PT enrollment summary ---
    const allPtEnrollments = await this.ptEnrollmentsService.findAll({
      member_id: memberId,
    });
    const activePtEnrollments = allPtEnrollments.filter(
      (e) => e.status === PTEnrollmentStatus.ACTIVE,
    );
    const hasRemainingPtSessions = activePtEnrollments.some(
      (e) => e.sessions_remaining > 0,
    );

    // --- Quick actions (Q26) ---
    const quickActions = computeQuickActions({
      checkedInToday: accessStatus.today === 'granted',
      hasActiveMembership,
      membershipEndDate: activeMembership?.end_date ?? null,
      hasActivePtEnrollment: activePtEnrollments.length > 0,
      hasRemainingPtSessions,
    });

    return {
      member: {
        id: member.id,
        localId: member.local_id,
        firstName: member.first_name,
        lastName: member.last_name,
        photo: null, // No photo column on Member currently
        email: member.email ?? null,
        phone: member.phone ?? null,
      },
      membership,
      accessStatus,
      currentMeasurements,
      quickActions,
      activePtEnrollmentCount: activePtEnrollments.length,
      hasRemainingPtSessions,
    };
  }
}

function computeDaysUntilExpiry(endDate: string): number {
  const now = new Date();
  const end = new Date(endDate + 'T23:59:59.999Z');
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}