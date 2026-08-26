import { readFile } from 'fs/promises'
import { isAbsolute, join, normalize, relative } from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'

function isInside(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const doc = await prisma.document.findFirst({
    where: documentVisibilityWhere(auth.user, { id }),
    select: { name: true, type: true, url: true },
  })
  if (!doc?.url) return NextResponse.json({ error: 'الملف غير موجود' }, { status: 404 })

  if (doc.url.startsWith('/uploads/')) {
    return NextResponse.json({ error: 'مسار ملف قديم غير آمن' }, { status: 410 })
  }

  const relativePath = join('storage', doc.url)
  const absolutePath = normalize(join(process.cwd(), relativePath))
  const allowedRoots = [
    normalize(join(process.cwd(), 'storage', 'case-documents')),
  ]
  if (!allowedRoots.some((root) => isInside(root, absolutePath))) {
    return NextResponse.json({ error: 'مسار الملف غير صالح' }, { status: 400 })
  }

  try {
    const file = await readFile(absolutePath)
    return new NextResponse(file, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'تعذر قراءة الملف' }, { status: 404 })
  }
}
