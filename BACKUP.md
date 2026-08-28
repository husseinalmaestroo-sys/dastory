# Backup & Disaster Recovery

Scripts live in [`scripts/`](scripts/): `backup-db.sh`, `backup-files.sh`, `restore-db.sh`. Re-verified end-to-end in this session (not just re-asserted from an earlier claim): ran `backup-db.sh` against the real local `dostoori` database, restored the resulting encrypted file into a fresh scratch database with `restore-db.sh`, and confirmed row counts *and* row-level content (spot-checked the `User` table) matched the source exactly across every table. Found and fixed one real gap in the process — see below. What these scripts do **not** cover automatically is the parts that need your actual hosting account — those are called out explicitly below as manual steps.

**Fixed in this session:** `restore-db.sh` previously assumed the target database already existed and failed with `Unknown database` when restoring into a genuinely fresh scratch DB — exactly the documented first-step workflow below. It now runs `CREATE DATABASE IF NOT EXISTS` for the target before restoring, so following the "Restoration procedure" section below works as written, with no undocumented manual prerequisite.

## What gets backed up

| What | Script | Contains |
|---|---|---|
| MySQL database | `scripts/backup-db.sh` | Everything in `DATABASE_URL` — offices, users (password hashes, encrypted 2FA secrets), clients, cases, invoices, audit logs, etc. |
| Uploaded documents | `scripts/backup-files.sh` | `storage/case-documents/` — the actual case document files referenced by the `Document` table |

Both must be backed up together and restored together — a `Document` row with no matching file (or a file with no matching row) is useless.

## Encryption

Every backup file is encrypted with AES-256-CBC (via `openssl enc -pbkdf2`) before it touches disk — the pipeline never writes an unencrypted dump. The key is `BACKUP_ENCRYPTION_PASSPHRASE`, a secret **separate from the app's own secrets** (`JWT_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY`). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

**Store this passphrase somewhere other than the host being backed up** — a password manager or secrets vault. If the host is lost entirely, the passphrase is the only thing that makes the off-host copies of your backups useful; losing it means the backups are permanently unreadable.

## Retention

Both scripts delete their own local encrypted backups older than `BACKUP_RETENTION_DAYS` (default 14) after each run. This only prunes the **local** copy — see below for off-host copies.

## Off-host storage — manual setup required

Backups sitting only on the same host they protect don't survive that host failing, which defeats the purpose. Both scripts will copy the encrypted backup to a remote via [`rclone`](https://rclone.org/) if `BACKUP_RCLONE_REMOTE` is set and `rclone` is installed — **this part requires manual, one-time setup on the actual production host, which this repo cannot do for you**:

1. On the production host: `curl https://rclone.org/install.sh | sudo bash` (or your distro's package).
2. `rclone config` — set up a remote for whatever off-host storage you have (Backblaze B2, S3-compatible, another provider's storage, even a different VPS over SFTP). Hostinger itself doesn't include off-host object storage, so this has to be a separate account/service you control.
3. Set `BACKUP_RCLONE_REMOTE=<remote-name>:<bucket-or-path>` in the environment the cron job runs with.
4. Confirm it works: `rclone copy scripts/../backups/db/<some-file> <remote>:<path>` and check it landed.

Without this step, `backup-db.sh` / `backup-files.sh` still run and still produce encrypted local backups (with a `NOTE:` printed to say so) — they just aren't protected against the host itself being lost.

## Automating it — manual setup required

Add to the production host's crontab (`crontab -e`), with the required env vars available to cron (either exported in the crontab itself, or sourced from a file cron reads — cron does not inherit your shell's environment):

```cron
0 3  * * * cd /path/to/app && DATABASE_URL="..." BACKUP_ENCRYPTION_PASSPHRASE="..." BACKUP_RCLONE_REMOTE="..." ./scripts/backup-db.sh    >> backups/db/backup.log 2>&1
30 3 * * * cd /path/to/app && BACKUP_ENCRYPTION_PASSPHRASE="..." BACKUP_RCLONE_REMOTE="..." ./scripts/backup-files.sh >> backups/files/backup.log 2>&1
```

Adjust the schedule to your actual write volume — daily is a reasonable starting point for a system this size.

## Restoration procedure

```bash
# 1. Never restore directly into production for a first attempt. Restore
#    into a scratch database and verify first:
export DATABASE_URL="mysql://USER:PASS@HOST:3306/dostoori"   # connection info; db name is overridden below
export BACKUP_ENCRYPTION_PASSPHRASE="..."
./scripts/restore-db.sh backups/db/dostoori-db-20260101T030000Z.sql.gz.enc dostoori_restore_check

# 2. The script prints row counts per table when it finishes — compare
#    those against what you expect (e.g. against the source environment,
#    or a recent `SELECT COUNT(*) ...` you took before the incident).

# 3. Only once satisfied, restore into the real database name (or point
#    DATABASE_URL at the real target and omit the second argument).

# 4. Restore the matching files backup into storage/ (or wherever
#    STORAGE_DIR points in production):
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in backups/files/dostoori-files-20260101T033000Z.tar.gz.enc | tar -xz -C /path/to/app
```

**Use a database backup and a files backup taken close together in time.** A document uploaded after the DB backup but before the files backup (or vice versa) will be inconsistent between the two — acceptable for disaster recovery, but worth knowing going in.

## Restoration verification

The restore script's row-count output is a baseline sanity check, not a full integrity guarantee. For a real disaster-recovery drill (recommended at least once before you need it for real):

1. Restore both backups into a scratch environment (scratch DB name + a separate `STORAGE_DIR`).
2. Point a local `.env` at the scratch database and `npm run dev` against it.
3. Log in as a known user, open a case that has a document attached, and confirm the document downloads and its content matches what you expect.
4. Confirm a user with 2FA enabled can still complete login — this exercises that the encrypted `twoFactorSecret` values restored correctly (they're encrypted with `TWO_FACTOR_ENCRYPTION_KEY`, not by the backup passphrase, so restoring into an environment with a *different* `TWO_FACTOR_ENCRYPTION_KEY` than the source will make existing users' 2FA unusable — keep this key backed up and restorable too, e.g. in the same secrets vault as `BACKUP_ENCRYPTION_PASSPHRASE`).

## What this does not cover

- **Point-in-time recovery.** These are periodic full dumps, not continuous binlog-based replication — you can restore to the last backup, not to an arbitrary second. If that matters for your recovery objectives, look at MySQL binlog-based PITR in addition to this.
- **Automated restore testing.** Nothing currently runs the restoration-verification steps above on a schedule; treat that as a periodic manual exercise (e.g. quarterly).
- **Provisioning the off-host remote itself.** As above, that's a manual, one-time step on infrastructure this repo doesn't have access to.
