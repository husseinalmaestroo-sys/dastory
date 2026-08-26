// Parses DATABASE_URL (the same value the app itself uses) into discrete
// mysql connection parts. Used by the backup/restore shell scripts via a
// `node ... lib-db-url.mjs` call rather than hand-rolled sed/awk parsing,
// which is fragile against special characters in passwords.
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const u = new URL(url)
const parts = [
  u.hostname,
  u.port || '3306',
  decodeURIComponent(u.username),
  decodeURIComponent(u.password),
  u.pathname.replace(/^\//, ''),
]
console.log(parts.join('\n'))
