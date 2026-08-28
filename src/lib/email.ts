import nodemailer from 'nodemailer'
import type { NextRequest } from 'next/server'
import { isHttpsRequest } from '@/lib/api-security'

/** Builds an absolute app origin for links embedded in outgoing email (password reset, email verification, ...). */
export function requestOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (configured) return configured
  const host = req.headers.get('host')
  return host ? `${isHttpsRequest(req) ? 'https' : 'http'}://${host}` : ''
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
