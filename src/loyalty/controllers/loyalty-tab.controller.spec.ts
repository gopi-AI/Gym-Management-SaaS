import { LoyaltyTabController } from './loyalty-tab.controller';
import { PERMISSIONS_KEY } from '../../shared/auth/permissions.guard';

describe('LoyaltyTabController', () => {
  it('delegates to findAccountByMemberId and findAllTransactionsByMemberId, returning { account, transactions }', async () => {
    const account = { id: 'acct-1', member_id: 'member-1', balance: 100 };
    const transactions = [
      { id: 'txn-1', account_id: 'acct-1', points: 50, transaction_type: 'earn' },
    ];
    const service = {
      findAccountByMemberId: jest.fn().mockResolvedValue(account),
      findAllTransactionsByMemberId: jest.fn().mockResolvedValue(transactions),
    };
    const controller = new LoyaltyTabController(service as never);
    const memberId = '11111111-1111-4111-8111-111111111111';

    const result = await controller.getLoyalty(memberId);

    expect(result).toEqual({ account, transactions });
    expect(service.findAccountByMemberId).toHaveBeenCalledWith(memberId);
    expect(service.findAllTransactionsByMemberId).toHaveBeenCalledWith(memberId);

    const metadata = Reflect.getMetadata(
      PERMISSIONS_KEY,
      LoyaltyTabController.prototype.getLoyalty,
    );
    expect(metadata).toEqual([{ resource: 'loyalty', action: 'read' }]);
  });
});