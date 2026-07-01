import { app } from '../../_server/app.js';
import { getKnex } from '../../_server/db.js';
import {
  ATSAnalyticsData,
} from '../../types';

const validateATSData = (data: any[]): ATSAnalyticsData[] => {
  if (!Array.isArray(data)) return [];

  return data.map(row => ({
    date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
    total_analyses: Number(row.total_analyses) || 0,
    successful_matches: Number(row.successful_matches) || 0,
    pending_reviews: Number(row.pending_reviews) || 0,
    completed_processes: Number(row.completed_processes) || 0,
  }));
};

const controller = app.defineCustomController({
  getATSAnalytics: async (input: any): Promise<ATSAnalyticsData[]> => {
    const startDate = input?.startDate;
    const endDate = input?.endDate;
    const db = getKnex();

    try {
      const atsQuery = await db.raw(`
        WITH daily_stats AS (
          SELECT
            DATE("createdAt") as date,
            COUNT(*) as daily_total,
            COUNT(CASE WHEN "score" >= 80 THEN 1 END) as daily_success,
            COUNT(CASE WHEN "score" >= 60 AND "score" < 80 THEN 1 END) as daily_pending,
            COUNT(CASE WHEN "score" < 60 THEN 1 END) as daily_completed
          FROM "ATSAnalysis"
          WHERE 1=1
          ${startDate ? 'AND DATE("createdAt") >= ?::date' : ''}
          ${endDate ? 'AND DATE("createdAt") <= ?::date' : ''}
          GROUP BY DATE("createdAt")
        ),
        cumulative AS (
          SELECT
            date,
            SUM(daily_total) OVER (ORDER BY date ASC) as total_analyses,
            SUM(daily_success) OVER (ORDER BY date ASC) as successful_matches,
            SUM(daily_pending) OVER (ORDER BY date ASC) as pending_reviews,
            SUM(daily_completed) OVER (ORDER BY date ASC) as completed_processes
          FROM daily_stats
        )
        SELECT *
        FROM cumulative
        ORDER BY date ASC
      `, [
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ]);

      return validateATSData(atsQuery.rows || []);
    } catch (error) {
      console.error('Error in getATSAnalytics:', error);
      return [];
    }
  },

  subscribeToATSChanges: async (): Promise<{ listener: string }> => {
    return { listener: 'ats_subscription' };
  },

  unsubscribeFromATSChanges: async (): Promise<void> => {
  },
});

export default controller;
export type Procedures = typeof controller.procedures;
