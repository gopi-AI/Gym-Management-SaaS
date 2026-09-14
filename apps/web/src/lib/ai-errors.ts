import { ApiError } from './api';

/**
 * Shared status→copy mapping for the AI analysis pages.
 *
 * The backend never leaks provider internals, so only the status codes it
 * documents for these endpoints are translated. Lives in `lib` (not in a
 * route file) because Next.js route modules may only export the page itself.
 */
export interface AiErrorCopy {
  /** Message shown for a 403 (RBAC) rejection. */
  permissionDenied?: string;
}

export function describeAiError(error: Error, copy: AiErrorCopy = {}): string {
  if (!(error instanceof ApiError)) {
    return 'The analysis could not be completed. Please try again.';
  }
  switch (error.status) {
    case 400:
      return 'The request was rejected. Check the selected period and branch.';
    case 403:
      return (
        copy.permissionDenied ??
        'You do not have permission to run this analysis for this organization.'
      );
    case 404:
      return 'The selected organization or branch could not be found.';
    case 429:
      // The API uses 429 for BOTH the per-user request rate limit and an
      // organization's exhausted AI token/cost budget. The budget messages name
      // the exhausted business limit (and never leak Redis/internal detail), so
      // they get actionable copy instead of "retry in a moment", which would
      // never succeed until the window resets.
      return /budget/i.test(error.message)
        ? 'This organization has reached its AI usage budget for now. Ask an administrator to review the AI limits, or try again once the budget resets.'
        : 'Too many analysis requests right now. Please wait a moment and try again.';
    case 503:
      return 'AI features are currently unavailable for this organization.';
    case 504:
      return 'The AI provider took too long to respond. Please try again.';
    default:
      return error.message;
  }
}
