import { describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { withErrorHandling } from './api-handler'

describe('withErrorHandling', () => {
  it('passes through a successful response unchanged', async () => {
    const handler = withErrorHandling(async () => NextResponse.json({ ok: true }, { status: 201 }))
    const res = await handler()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('turns an uncaught generic error into a 500 with a JSON body', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = withErrorHandling(async () => {
      throw new Error('boom: something unexpected broke deep in a query')
    })
    const res = await handler()
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual({ error: 'خطأ في الخادم' })
    consoleSpy.mockRestore()
  })

  it('never leaks the original error message to the client', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secretish = 'DATABASE_URL=mysql://root:supersecret@host/db'
    const handler = withErrorHandling(async () => {
      throw new Error(secretish)
    })
    const res = await handler()
    const text = await res.text()
    expect(text).not.toContain('supersecret')
    expect(text).not.toContain(secretish)
    consoleSpy.mockRestore()
  })

  it('logs the real error server-side even though the client never sees it', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = new Error('the real cause')
    const handler = withErrorHandling(async () => {
      throw original
    })
    await handler()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unhandled error'), original)
    consoleSpy.mockRestore()
  })

  it('maps a Prisma unique-constraint violation (P2002) to a 409 with a friendly message', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['officeId', 'number'] },
    })
    const handler = withErrorHandling(async () => {
      throw prismaError
    })
    const res = await handler()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'يوجد سجل بنفس القيمة مسبقاً' })
    consoleSpy.mockRestore()
  })

  it('treats a non-P2002 Prisma error as a generic 500, not a 409', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prismaError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: '5.22.0',
    })
    const handler = withErrorHandling(async () => {
      throw prismaError
    })
    const res = await handler()
    expect(res.status).toBe(500)
    consoleSpy.mockRestore()
  })

  it('forwards arguments through to the wrapped handler (dynamic route params)', async () => {
    const handler = withErrorHandling(async (req: string, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params
      return NextResponse.json({ req, id })
    })
    const res = await handler('the-request', { params: Promise.resolve({ id: 'abc-123' }) })
    expect(await res.json()).toEqual({ req: 'the-request', id: 'abc-123' })
  })
})
