import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { LIMITS } from '@/lib/validation'

// Notification bodies embed user-controlled text (case titles, document
// names). `body` is TEXT; `title` is VARCHAR(191). Both are fitted here so a
// long title can never make the insert fail — it used to overflow the old
// VARCHAR(191) body and the notification silently disappeared.
const MAX_BODY = 2000

function fit(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max - 1) + '…'
}

/**
 * Best-effort in-app notification: a failure must not fail the business
 * operation that triggered it (the case/document/session write already
 * committed), but it is reported — logged and sent to Sentry — never
 * swallowed silently.
 */
export async function notifyUser(userId: string, officeId: string, title: string, body: string) {
  try {
    await prisma.notification.create({
      data: { userId, officeId, title: fit(title, LIMITS.varchar), body: fit(body, MAX_BODY) },
    })
  } catch (error) {
    console.error('[notify] failed to create notification', { userId, officeId }, error)
    Sentry.captureException(error)
  }
}
