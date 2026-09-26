// Request-field validation that matches the database's real column limits,
// so over-long or wrongly-typed input is answered with a 400 that names the
// field instead of reaching MySQL and surfacing as a generic 500 (Prisma
// P2000). Limits are in JS string length (UTF-16 code units), which is never
// smaller than MySQL's utf8mb4 character count — a value that passes here
// always fits its column.

/** Column capacities (prisma/schema.prisma). */
export const LIMITS = {
  /** Every plain `String` column is VARCHAR(191). */
  varchar: 191,
  /** `@db.Text` columns (case/session notes): 65,535 bytes; utf8mb4 is ≤4 bytes/char. */
  longText: 10_000,
  personName: 120,
  officeName: 140,
  phone: 40,
  barNumber: 64,
  idNumber: 64,
  email: 191,
  calendarType: 40,
  passwordMin: 8,
  // bcrypt only uses the first 72 bytes; a sane upper bound also stops
  // multi-megabyte "passwords" from being hashed.
  passwordMax: 128,
} as const

export type FieldResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

/**
 * Reads an optional/required text field.
 *  - absent (undefined)      -> value undefined (caller: "not provided / no change")
 *  - null or blank           -> value null (or an error when required)
 *  - non-string              -> error
 *  - longer than `max`       -> error naming the field and the limit
 * Returned strings are trimmed.
 */
export function textField(
  input: unknown,
  opts: { label: string; max: number; required?: boolean }
): FieldResult {
  if (input === undefined) {
    return opts.required ? { ok: false, error: `${opts.label} مطلوب` } : { ok: true, value: undefined }
  }
  if (input === null) {
    return opts.required ? { ok: false, error: `${opts.label} مطلوب` } : { ok: true, value: null }
  }
  if (typeof input !== 'string') return { ok: false, error: `${opts.label}: قيمة غير صالحة` }
  const value = input.trim()
  if (!value) return opts.required ? { ok: false, error: `${opts.label} مطلوب` } : { ok: true, value: null }
  if (value.length > opts.max) return { ok: false, error: `${opts.label}: الحد الأقصى ${opts.max} حرفاً` }
  return { ok: true, value }
}

/**
 * Validates several fields at once. Returns the first error message, or the
 * trimmed values keyed like the spec.
 */
export function validateFields<K extends string>(
  body: Record<string, unknown>,
  spec: Record<K, { label: string; max: number; required?: boolean }>
): { ok: true; values: Record<K, string | null | undefined> } | { ok: false; error: string } {
  const values = {} as Record<K, string | null | undefined>
  for (const key of Object.keys(spec) as K[]) {
    const result = textField(body[key], spec[key])
    if (!result.ok) return result
    values[key] = result.value
  }
  return { ok: true, values }
}

export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length <= LIMITS.email &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
}

/** Null when acceptable, otherwise the user-facing reason. */
export function validatePassword(password: string): string | null {
  if (password.length < LIMITS.passwordMin) return `كلمة المرور يجب أن تكون ${LIMITS.passwordMin} أحرف على الأقل`
  if (password.length > LIMITS.passwordMax) return `كلمة المرور يجب ألا تتجاوز ${LIMITS.passwordMax} حرفاً`
  return null
}

/** Shortens a display name (e.g. an uploaded file's name) to fit its column, keeping the extension. */
export function fitFileName(name: string, max: number = LIMITS.varchar): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ''
  return name.slice(0, max - ext.length - 1) + '…' + ext
}
