import { app } from '../../_server/app.js';
import { getKnex } from '../../_server/db.js';
import {
  UserGrowthData,
} from '../../types';

const validateGrowthData = (data: any[]): UserGrowthData[] => {
  if (!Array.isArray(data)) return [];

  return data.map(row => ({
    date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
    users: Number(row.users) || 0,
    new_users: Number(row.new_users) || 0,
    unique_emails: Number(row.unique_emails) || 0,
    verified_users: Number(row.verified_users) || 0,
  }));
};

const controller = app.defineCustomController({
  getGrowthData: async (input: any): Promise<UserGrowthData[]> => {
    const startDate = input?.startDate;
    const endDate = input?.endDate;
    const db = getKnex();

    try {
      const statsQuery = await db.raw(`
        WITH daily_stats AS (
          SELECT
            DATE("createdAt") as date,
            COUNT(*) as daily_users,
            COUNT(DISTINCT email) as daily_emails,
            COUNT(DISTINCT "clerkId") as daily_verified
          FROM "User"
          WHERE 1=1
          ${startDate ? 'AND DATE("createdAt") >= ?::date' : ''}
          ${endDate ? 'AND DATE("createdAt") <= ?::date' : ''}
          GROUP BY DATE("createdAt")
        ),
        cumulative AS (
          SELECT
            date,
            SUM(daily_users) OVER (ORDER BY date ASC) as users,
            SUM(daily_emails) OVER (ORDER BY date ASC) as unique_emails,
            SUM(daily_verified) OVER (ORDER BY date ASC) as verified_users,
            daily_users as new_users
          FROM daily_stats
        )
        SELECT *
        FROM cumulative
        ORDER BY date ASC
      `, [
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ]);

      return validateGrowthData(statsQuery.rows || []);
    } catch (error) {
      console.error('Error in getGrowthData:', error);
      return [];
    }
  },

  subscribeToUserChanges: async (): Promise<{ listener: string }> => {
    return { listener: 'user_subscription' };
  },

  unsubscribeFromUserChanges: async (): Promise<void> => {
  },
});

export default controller;
export type Procedures = typeof controller.procedures;
