import { PTEnrollmentStatus } from '../entities/pt-enrollment-status.enum';
import { CancelPtEnrollmentDto } from '../dto/cancel-pt-enrollment.dto';
import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';
import { PtEnrollmentsController } from './pt-enrollments.controller';

describe('PtEnrollmentsController', () => {
  it('requires pt:delete for cancellation and delegates id/reason to the scoped service', async () => {
    const cancel = jest.fn().mockResolvedValue({ id: 'enrollment-1', status: PTEnrollmentStatus.CANCELLED });
    const controller = new PtEnrollmentsController({ cancel } as never);
    const id = '11111111-1111-4111-8111-111111111111';
    const dto: CancelPtEnrollmentDto = { reason: 'Member request' };

    await expect(controller.cancel(id, dto)).resolves.toEqual({ id: 'enrollment-1', status: PTEnrollmentStatus.CANCELLED });
    expect(cancel).toHaveBeenCalledWith(id, dto);

    const metadata = Reflect.getMetadata(PERMISSIONS_KEY, PtEnrollmentsController.prototype.cancel);
    expect(metadata).toEqual([{ resource: 'pt', action: 'delete' }]);
  });
});