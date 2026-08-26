import { prisma } from '@/lib/prisma'

export async function notifyUser(userId: string, officeId: string, title: string, body: string) {
  try {
    await prisma.notification.create({ data: { userId, officeId, title, body } })
  } catch (error) {
    console.error('notifyUser failed', error)
  }
}
