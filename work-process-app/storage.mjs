// Adapt business queries to asynchronous D1, keeping reads consistent per request.
export function database(binding) {
  const db = binding.withSession ? binding.withSession('first-primary') : binding;
  return { prepare(sql) {
    const statement = args => args.length ? db.prepare(sql).bind(...args) : db.prepare(sql);
    return {
      get: (...args) => statement(args).first(),
      all: async (...args) => (await statement(args).all()).results,
      run: async (...args) => {
        const r = await statement(args).run();
        return { changes: r.meta.changes, lastInsertRowid: r.meta.last_row_id };
      },
    };
  } };
}
