import { app } from '../../_server/app.js';
import { getKnex } from '../../_server/db.js';
import {
  SessionDataRow,
} from '../../types';

const validateSessionData = (data: any[]): SessionDataRow[] => {
  if (!Array.isArray(data)) return [];

  return data.map(row => ({
    date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
    total_sessions: Number(row.total_sessions) || 0,
    active_sessions: Number(row.active_sessions) || 0,
    completed_sessions: Number(row.completed_sessions) || 0,
    free_sessions: Number(row.free_sessions) || 0,
    paid_sessions: Number(row.paid_sessions) || 0,
    auto_generated_sessions: Number(row.auto_generated_sessions) || 0,
    manual_sessions: Number(row.manual_sessions) || 0,
    sessions_with_transcription: Number(row.sessions_with_transcription) || 0,
    simple_language_sessions: Number(row.simple_language_sessions) || 0,
    multi_language_sessions: Number(row.multi_language_sessions) || 0,
  }));
};

const controller = app.defineCustomController({
  getSessionAnalytics: async (input: any): Promise<SessionDataRow[]> => {
    const startDate = input?.startDate;
    const endDate = input?.endDate;
    const db = getKnex();

    try {
      const sessionQuery = await db.raw(`
        WITH daily_stats AS (
          SELECT
            DATE("createdAt") as date,
            COUNT(*) as daily_total,
            COUNT(CASE WHEN "free" = true THEN 1 END) as daily_free,
            COUNT(CASE WHEN "free" = false THEN 1 END) as daily_paid,
            COUNT(CASE WHEN "autoGenerateResponse" = true THEN 1 END) as daily_auto,
            COUNT(CASE WHEN "saveTranscription" = true THEN 1 END) as daily_trans,
            COUNT(CASE WHEN "simpleLanguage" = true THEN 1 END) as daily_simple,
            COUNT(CASE WHEN "updatedAt" >= NOW() - INTERVAL '24 hours' THEN 1 END) as daily_active
          FROM "Session"
          WHERE 1=1
          ${startDate ? 'AND DATE("createdAt") >= ?::date' : ''}
          ${endDate ? 'AND DATE("createdAt") <= ?::date' : ''}
          GROUP BY DATE("createdAt")
        ),
        cumulative AS (
          SELECT
            date,
            SUM(daily_total) OVER (ORDER BY date ASC) as total_sessions,
            SUM(daily_free) OVER (ORDER BY date ASC) as free_sessions,
            SUM(daily_paid) OVER (ORDER BY date ASC) as paid_sessions,
            SUM(daily_auto) OVER (ORDER BY date ASC) as auto_generated_sessions,
            (SUM(daily_total) OVER (ORDER BY date ASC) - SUM(daily_auto) OVER (ORDER BY date ASC)) as manual_sessions,
            SUM(daily_trans) OVER (ORDER BY date ASC) as sessions_with_transcription,
            SUM(daily_simple) OVER (ORDER BY date ASC) as simple_language_sessions,
            (SUM(daily_total) OVER (ORDER BY date ASC) - SUM(daily_simple) OVER (ORDER BY date ASC)) as multi_language_sessions,
            SUM(daily_active) OVER (ORDER BY date ASC) as active_sessions,
            0 as completed_sessions
          FROM daily_stats
        )
        SELECT *
        FROM cumulative
        ORDER BY date ASC
      `, [
        ...(startDate ? [startDate] : []),
        ...(endDate ? [endDate] : [])
      ]);

      return validateSessionData(sessionQuery.rows || []);
    } catch (error) {
      console.error('Error in getSessionAnalytics:', error);
      return [];
    }
  },

  subscribeToSessionChanges: async (): Promise<{ listener: string }> => {
    return { listener: 'session_subscription' };
  },

  unsubscribeFromSessionChanges: async (): Promise<void> => {
  },
});

export default controller;
export type Procedures = typeof controller.procedures;
