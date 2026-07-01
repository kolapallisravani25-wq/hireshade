import { app } from '@/_server/app';
import postgresDataSource from '../../_server/data-sources/postgres_tk07';
import { randomUUID } from 'crypto';
import type { GrantCreditRow, AssignCreditInput, AssignCreditResult, LedgerType } from '../../types/creditTypes';

const db = postgresDataSource.getClient();

const controller = app.defineTableController(
  {
    customDataFetcher: async ({ page, pageSize, search }: {
      page: number;
      pageSize: number;
      search?: string;
    }) => {
      const offset = (page - 1) * pageSize;

      const baseQuery = db('User as u')
        .leftJoin('UserCreditBalance as ucb', 'u.id', 'ucb.userId')
        .select(
          'u.id as userId',
          'u.name',
          'u.email',
          'u.createdAt',
          db.raw(`COALESCE(ucb."purchasedCredits", 0) as "purchasedCredits"`),
          db.raw(`COALESCE(ucb."earnedCredits", 0) as "earnedCredits"`),
          db.raw(`COALESCE(ucb."heldCredits", 0) as "heldCredits"`),
          db.raw(`COALESCE(ucb."totalAvailable", 0) as "totalAvailable"`),
          'ucb.lastUpdated',
        );

      const countQuery = db('User as u')
        .leftJoin('UserCreditBalance as ucb', 'u.id', 'ucb.userId');

      if (search) {
        const pattern = `%${search}%`;
        baseQuery.where(function () {
          this.whereILike('u.name', pattern).orWhereILike('u.email', pattern);
        });
        countQuery.where(function () {
          this.whereILike('u.name', pattern).orWhereILike('u.email', pattern);
        });
      }

      try {
        const [rows, countResult] = await Promise.all([
          baseQuery.orderBy('u.createdAt', 'desc').limit(pageSize).offset(offset),
          countQuery.count('u.id as count').first(),
        ]);

        return {
          records: rows as GrantCreditRow[],
          total: parseInt(String(countResult?.count ?? '0'), 10),
        };
      } catch (error) {
        console.error('Error fetching user credits:', error);
        throw new Error('Error while loading data');
      }
    },
  },
  {
    assignCredit: async (input: AssignCreditInput): Promise<AssignCreditResult> => {
      const { userId, amount } = input;

      if (!amount || amount <= 0 || !Number.isFinite(amount)) {
        throw new Error('Credit amount must be a positive number.');
      }

      const user = await db('User').where('id', userId).first();
      if (!user) throw new Error('User not found.');

      return await db.transaction(async (trx) => {
        let balance = await trx('UserCreditBalance')
          .where('userId', userId)
          .forUpdate()
          .first();

        let balanceBefore: number;
        let newEarnedCredits: number;
        let newTotalAvailable: number;

        if (balance) {
          balanceBefore = parseFloat(balance.totalAvailable);
          newEarnedCredits = parseFloat(balance.earnedCredits) + amount;
          newTotalAvailable = parseFloat(balance.totalAvailable) + amount;

          await trx('UserCreditBalance')
            .where('userId', userId)
            .update({
              earnedCredits: newEarnedCredits,
              totalAvailable: newTotalAvailable,
              lastUpdated: new Date(),
            });
        } else {
          balanceBefore = 0;
          newEarnedCredits = amount;
          newTotalAvailable = amount;

          await trx('UserCreditBalance').insert({
            userId,
            purchasedCredits: 0,
            earnedCredits: newEarnedCredits,
            heldCredits: 0,
            totalAvailable: newTotalAvailable,
            lastUpdated: new Date(),
          });
        }

        const ledgerEntryId = randomUUID();
        const ledgerType: LedgerType = 'EARN';

        await trx('CreditLedger').insert({
          id: ledgerEntryId,
          userId,
          sessionId: null,
          type: ledgerType,
          amount,
          balanceBefore,
          balanceAfter: newTotalAvailable,
          reason: 'Manual credit grant by Admin',
          createdAt: new Date(),
        });

        return {
          success: true,
          newEarnedCredits: newEarnedCredits.toFixed(2),
          newTotalAvailable: newTotalAvailable.toFixed(2),
          ledgerEntryId,
        };
      });
    },
  },
);

export default controller;
export type Procedures = typeof controller.procedures;