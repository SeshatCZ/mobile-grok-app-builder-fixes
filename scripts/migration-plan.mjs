// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, `readdir`) and `src/lib/db.ts` (PGLite preview, `import.meta.glob`).
 *
 * Applied files are keyed by BASENAME, so the same file applies once no matter
 * which directory it is globbed from. That is what makes the auth schema safe to
 * copy from `migrations/auth/` into `migrations/` when an app turns sign-in on:
 * a database that already has `0001_auth.sql` will not re-run it.
 *
 * Neither applier descends into subdirectories, so `migrations/auth/*.sql` is
 * out of scope for both until it is copied up.
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * @param {string} path
 * @returns {number}
 */
function pathDepth(path) {
  return path.split("/").filter(Boolean).length;
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * Two paths with the same basename are one migration: applying both would
 * insert the same `_migrations` key twice and abort the pass. The shallower
 * path wins — that is the copy promoted into the globbed directory.
 * Order is code-point order, not `localeCompare`, so a different OS locale
 * cannot apply the same set in a different sequence.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  const sorted = [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      const byDepth = pathDepth(a.path) - pathDepth(b.path);
      if (byDepth !== 0) return byDepth;
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    });
  const seen = new Set();
  const pending = [];
  for (const item of sorted) {
    if (done.has(item.name) || seen.has(item.name)) continue;
    seen.add(item.name);
    pending.push(item);
  }
  return pending;
}
