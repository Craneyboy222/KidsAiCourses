/**
 * Parallel work needs separate test databases. Set TEST_DB_NAME (for example
 * `TEST_DB_NAME=platform_test_coach pnpm vitest run …`) to point this run at another
 * database on the same server. The name must contain "test".
 */
export function applyTestDbName(): void {
  const name = process.env.TEST_DB_NAME;
  const url = process.env.DATABASE_URL;
  if (!name || !url) return;
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/i.test(name)) throw new Error(`TEST_DB_NAME "${name}" must contain "test" and only letters, digits and underscores.`);
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  process.env.DATABASE_URL = parsed.toString();
  delete process.env.DATABASE_URL_UNPOOLED;
}
