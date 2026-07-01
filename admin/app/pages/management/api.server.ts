import { app } from '../../_server/app';
import postgresDataSource from '../../_server/data-sources/postgres_tk07';

const db = postgresDataSource.getClient();

const controller = app.defineTableController(
  {
    customDataFetcher: async ({ page, pageSize, search }) => {
      const offset = (page - 1) * pageSize;

      const baseQuery = db('User as u').select(
        'u.id',
        'u.name',
        'u.email',
        'u.createdAt',
        db.raw(`(SELECT COUNT(*) FROM "Resume" r WHERE r."userId" = u.id)::int AS resumes_count`),
        db.raw(`(SELECT COUNT(*) FROM "Session" s WHERE s."userId" = u.id)::int AS sessions_count`)
      );

      const countQuery = db('User as u');

      if (search) {
        baseQuery.where(function () {
          this.whereILike('u.name', `%${search}%`).orWhereILike('u.email', `%${search}%`);
        });
        countQuery.where(function () {
          this.whereILike('name', `%${search}%`).orWhereILike('email', `%${search}%`);
        });
      }

      try {
        const [rows, countResult] = await Promise.all([
          baseQuery.orderBy('u.createdAt', 'desc').limit(pageSize).offset(offset),
          countQuery.count('id as count').first(),
        ]);

        return {
          records: rows,
          total: parseInt(String(countResult?.count ?? '0'), 10),
        };
      } catch (error) {
        console.error('Error fetching users management data:', error);
        throw new Error('Error while loading data');
      }
    },
  },
  {
    getUserResumes: async (input: { userId: string }) => {
      return await db('Resume')
        .select('id', 'filename', 'uploadedAt', 'size', 'ats')
        .where('userId', input.userId)
        .orderBy('uploadedAt', 'desc');
    },

    getUserSessions: async (input: { userId: string }) => {
      return await db('Session')
        .select('id', 'startedAt', 'endedAt', 'durationSeconds', 'status', 'mode', 'companyName', 'aiUsage')
        .where('userId', input.userId)
        .orderBy('startedAt', 'desc');
    },

    getResumeDetails: async (input: { resumeId: string }) => {
      return await db('Resume').where('id', input.resumeId).first() ?? null;
    },

    getSessionDetails: async (input: { sessionId: string }) => {
      return await db('Session').where('id', input.sessionId).first() ?? null;
    },
  }
);

export default controller;
export type Procedures = typeof controller.procedures;
