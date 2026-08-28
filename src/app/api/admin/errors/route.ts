import { requireAdmin } from "@/lib/admin-auth";
import { queryOne, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Feeds the admin dashboard's error panel — see src/lib/error-log.ts, which
 * every console.error site in the app now also writes through, so a failure
 * shows up here instead of requiring someone to watch server logs live.
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const [totals, byContext, recent] = await Promise.all([
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM error_log)                                        AS total,
        (SELECT COUNT(*) FROM error_log WHERE created_at > now() - interval '24 hours') AS last_24h
    `),

    query<{ context: string; count: number }>(`
      SELECT context, COUNT(*)::int AS count
        FROM error_log
       WHERE created_at > now() - interval '7 days'
       GROUP BY context
       ORDER BY count DESC
       LIMIT 10
    `),

    query(`
      SELECT id, context, message, stack,
             to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
        FROM error_log
       ORDER BY created_at DESC
       LIMIT 100
    `),
  ]);

  return Response.json({ totals, byContext, recent });
}
