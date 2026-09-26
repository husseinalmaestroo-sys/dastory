#!/usr/bin/env node
// Operator CLI — the ONLY way to grant or revoke platform (cross-tenant)
// admin. No HTTP route can set User.isPlatformAdmin, so signing up with any
// email, however "admin-like", can never produce a platform admin.
//
//   node scripts/platform-admin.mjs list
//   node scripts/platform-admin.mjs grant  owner@example.com
//   node scripts/platform-admin.mjs revoke owner@example.com
//
// Docker: docker compose run --rm app node scripts/platform-admin.mjs grant owner@example.com
//
// Granting is necessary but not sufficient: the account must also be an
// OFFICE_MANAGER listed in PLATFORM_ADMIN_EMAILS, with a verified email and
// 2FA enabled, before /admin and /api/admin/* accept it (isPlatformAdmin in
// src/lib/auth-server.ts). This script reports whatever is still missing.
import { PrismaClient } from '@prisma/client'

const [command, rawEmail] = process.argv.slice(2)
const usage = 'usage: platform-admin.mjs list | grant <email> | revoke <email>'

const allowList = new Set(
  (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
)

const prisma = new PrismaClient()

async function audit(action, user) {
  await prisma.auditLog.create({
    data: {
      officeId: user.officeId,
      actorEmail: 'cli:platform-admin',
      action,
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    },
  })
}

function missingRequirements(user) {
  const missing = []
  if (user.role !== 'OFFICE_MANAGER') missing.push('role must be OFFICE_MANAGER')
  if (!allowList.has(user.email.toLowerCase())) missing.push('email not listed in PLATFORM_ADMIN_EMAILS')
  if (!user.emailVerified) missing.push('email not verified')
  if (!user.twoFactorEnabled) missing.push('2FA not enabled')
  if (!user.active) missing.push('account deactivated')
  return missing
}

async function main() {
  if (command === 'list') {
    const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true } })
    if (admins.length === 0) console.log('No provisioned platform admins.')
    for (const u of admins) {
      const missing = missingRequirements(u)
      console.log(`${u.email}\t${missing.length ? 'NOT EFFECTIVE: ' + missing.join('; ') : 'effective'}`)
    }
    return 0
  }

  if ((command !== 'grant' && command !== 'revoke') || !rawEmail) {
    console.error(usage)
    return 2
  }

  const email = rawEmail.trim().toLowerCase()
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`No user with email ${email}. Create the account first (sign up), then grant.`)
    return 1
  }

  if (command === 'revoke') {
    // Revoking also bumps sessionVersion so an open admin session ends now.
    await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: false, sessionVersion: { increment: 1 } } })
    await audit('platform_admin.revoked', user)
    console.log(`Revoked platform admin from ${email}.`)
    return 0
  }

  if (user.role !== 'OFFICE_MANAGER') {
    console.error(`${email} is ${user.role}; only an OFFICE_MANAGER account can be a platform admin.`)
    return 1
  }
  if (!allowList.has(email)) {
    console.error(`${email} is not listed in PLATFORM_ADMIN_EMAILS — add it there first (and restart the app).`)
    return 1
  }

  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: true } })
  await audit('platform_admin.granted', user)
  const missing = missingRequirements({ ...user, isPlatformAdmin: true })
  console.log(`Granted platform admin to ${email}.`)
  if (missing.length) {
    console.log(`NOT YET EFFECTIVE — still required: ${missing.join('; ')}.`)
    console.log('Verify the email (link sent at signup / Settings → resend) and enable 2FA in Settings.')
  }
  return 0
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
