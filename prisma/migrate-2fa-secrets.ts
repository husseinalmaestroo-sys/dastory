// One-off migration: encrypts any 2FA (TOTP) secrets still stored as legacy
// plaintext. Safe to run multiple times — already-encrypted rows (prefixed
// `v1:`) are left untouched. The app also migrates a legacy row the next
// time it's read (see resolveAndMigrateSecret in src/lib/secret-crypto.ts),
// so running this script is optional but closes the plaintext-at-rest
// exposure window immediately instead of waiting for each user's next
// login/2FA action.
//
// Usage:
//   npx tsx prisma/migrate-2fa-secrets.ts
import { PrismaClient } from '@prisma/client'
import { encryptSecret, isLegacyPlaintext } from '../src/lib/secret-crypto'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { id: true, email: true, twoFactorSecret: true },
  })

  let migrated = 0
  let alreadyEncrypted = 0

  for (const user of users) {
    const stored = user.twoFactorSecret
    if (!stored) continue

    if (!isLegacyPlaintext(stored)) {
      alreadyEncrypted += 1
      continue
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: encryptSecret(stored) },
    })
    migrated += 1
    console.log(`  encrypted 2FA secret for ${user.email}`)
  }

  console.log(`\nDone. ${migrated} secret(s) encrypted, ${alreadyEncrypted} already encrypted, ${users.length} total 2FA rows.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
