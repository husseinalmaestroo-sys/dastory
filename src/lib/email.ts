import nodemailer from 'nodemailer'
import { APP_ORIGIN } from '@/lib/env'

/**
 * The absolute origin for links embedded in outgoing email (password reset,
 * email verification). Always the configured APP_URL — never the request's
 * Host header, which the client controls: building reset links from it let
 * a forged Host turn a genuine reset email into a link to an attacker's
 * server (and with it, the reset token).
 */
/** Escapes text for interpolation into an email's HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function appOrigin(): string {
  return APP_ORIGIN
}

/**
 * When SMTP isn't configured, a bearer link (reset / verification) can't be
 * delivered. It is NOT logged: server logs are shipped, retained and read by
 * people who must not be able to take over accounts. The one exception is an
 * explicit opt-in for local development only.
 */
export function reportUndeliveredLink(kind: 'password-reset' | 'email-verification', userId: string, link: string) {
  if (process.env.NODE_ENV === 'development' && process.env.DEV_LOG_EMAIL_LINKS === 'true') {
    console.warn(`[${kind}] SMTP not configured — DEV ONLY link for user ${userId}: ${link}`)
    return
  }
  console.warn(`[${kind}] SMTP not configured — email NOT sent (user ${userId}). Configure SMTP_HOST/SMTP_USER/SMTP_PASS.`)
}

// Centralizes what was previously duplicated inline in both
// forgot-password/route.ts and email/send/route.ts — one transport
// implementation, not two that could quietly drift (different port-parsing,
// different `secure` logic, etc).
export function isSmtpConfigured(): boolean {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS)
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT ?? '587'),
    secure: SMTP_PORT === '465',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
}

export interface SendMailInput {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Sends real mail via the configured SMTP relay. Throws if SMTP isn't
 * configured — callers decide how to handle that (email/send/route.ts
 * returns 503 to the user; auth flows like signup/forgot-password log and
 * continue, since a missing mail relay shouldn't block account creation or
 * leak whether an account exists).
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  if (!isSmtpConfigured()) throw new Error('SMTP is not configured')
  const { SMTP_FROM, SMTP_USER } = process.env
  await getTransporter().sendMail({
    from: SMTP_FROM ?? SMTP_USER,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  })
}
