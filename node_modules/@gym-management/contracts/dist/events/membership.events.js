"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_VERSIONS = exports.EVENT_TYPES = void 0;
// Event type constants
exports.EVENT_TYPES = {
    MEMBERSHIP_STARTED: 'MembershipStarted',
    MEMBERSHIP_RENEWED: 'MembershipRenewed',
    MEMBERSHIP_PAUSED: 'MembershipPaused',
    MEMBERSHIP_RESUMED: 'MembershipResumed',
    MEMBERSHIP_CANCELLED: 'MembershipCancelled',
    MEMBERSHIP_TRANSFERRED: 'MembershipTransferred',
    MEMBERSHIP_FREEZE_STARTED: 'MembershipFreezeStarted',
    MEMBERSHIP_FREEZE_ENDED: 'MembershipFreezeEnded',
};
// Event version constants
exports.EVENT_VERSIONS = {
    V1: 'v1',
};
//# sourceMappingURL=membership.events.js.map