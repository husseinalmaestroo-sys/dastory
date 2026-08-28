/**
 * No-op stand-in for the `server-only` package.
 *
 * That package's whole job is to throw when Next's bundler resolves it into a
 * client bundle. Outside Next — as in `npx tsx scripts/...` — it throws
 * unconditionally, which would block testing any lib module that imports it.
 * Only scripts/tsconfig.verify.json maps to this; the app build still gets the
 * real guard.
 */
export {};
