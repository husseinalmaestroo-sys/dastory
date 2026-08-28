import { createHash } from 'crypto'

/**
 * This module backs an audit-trailed *signature image attachment* — NOT a
 * qualified or legally-binding electronic signature under Jordan's
 * Electronic Transactions Law or any other jurisdiction's e-signature
 * framework. It records real, verifiable facts (who, when, and a hash
 * proving the target document's exact byte content at signing time) without
 * claiming a legal status this system has no basis to assert. Every UI
 * surface that uses it must show DISCLOSURE_TEXT or an equivalent.
 */
export const DISCLOSURE_TEXT =
  'هذه صورة توقيع مرفقة مع سجل تدقيق (الموقّع، الوقت، بصمة المستند وقت التوقيع) — وليست توقيعاً إلكترونياً موثقاً قانونياً بموجب قانون المعاملات الإلكترونية أو أي تشريع آخر. للتوثيق القانوني الرسمي راجع جهة معتمدة.'

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
