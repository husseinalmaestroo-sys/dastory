# Legacy pre-migration scripts — DO NOT RUN

These were hand-applied to early development databases before this project
adopted Prisma Migrate. Every change they made is already part of
`prisma/migrations/20260826130000_init` and later migrations, so running any of
them against a current database is at best a no-op and at worst destructive
(`migration_multi_tenant_ownership.sql` drops and re-creates foreign keys and
inserts a placeholder office).

- `migration_2fa_audit_logs.sql`, `migration_multi_tenant_ownership.sql` — superseded by `migrations/`.
- `migrate-2fa-secrets.ts` — one-off re-encryption of plaintext 2FA secrets; the
  app already migrates any legacy plaintext secret transparently on read
  (`resolveAndMigrateSecret` in `src/lib/secret-crypto.ts`).

The only supported way to change the schema is `prisma migrate deploy` with the
files in `prisma/migrations/`.
