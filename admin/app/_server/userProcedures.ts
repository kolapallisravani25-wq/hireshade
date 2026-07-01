import dataSource from './data-sources/postgres_tk07';

const knex = dataSource.getClient();

export const userProcedures = {
  getUsers: async ({ search = '' }: { search?: string }) => {
    const q = knex('User').select('id', 'email', 'name').orderBy('email');
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      q.where(function () {
        this.whereILike('email', term)
          .orWhereILike('name', term)
          .orWhereRaw('"id"::text ilike ?', [term]);
      });
    }
    return { users: await q.limit(50) };
  },
};
