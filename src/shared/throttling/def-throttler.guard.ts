import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * DEF-07 Q4: the 429 keeps the library's default body and gains a plain
 * `Retry-After` header, in seconds.
 *
 * `ThrottlerGuard` already sets `Retry-After-<name>` for a named throttler
 * (`Retry-After-login-pair`, …), which is not the header clients — or Stripe —
 * look for, so the unsuffixed one is set here from the same value before the
 * exception is thrown.
 */
@Injectable()
export class DefThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const seconds = Math.max(
      1,
      throttlerLimitDetail.timeToBlockExpire || throttlerLimitDetail.timeToExpire || 1,
    );
    this.setResponseHeader(res, 'Retry-After', seconds);
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
