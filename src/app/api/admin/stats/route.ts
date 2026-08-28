import { requireAdmin } from "@/lib/admin-auth";
import { queryOne, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  // One round-trip per panel, run concurrently — the dashboard is one screen
  // and sequential awaits here would stack their latencies for no reason.
  const [totals, sources, topics, daily, recent] = await Promise.all([
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*)            FROM anonymous_usage)                                     AS total_sessions,
        (SELECT COUNT(DISTINCT ip_hash) FROM anonymous_usage WHERE ip_hash IS NOT NULL)       AS approx_visitors,
        (SELECT COUNT(*)            FROM anonymous_usage WHERE last_seen_at > now() - interval '30 minutes') AS active_sessions,
        (SELECT COUNT(*)            FROM chat_history)                                        AS total_questions,
        (SELECT COALESCE(SUM(tokens_used), 0)    FROM anonymous_usage)                        AS total_tokens,
        (SELECT COALESCE(SUM(estimated_cost), 0) FROM anonymous_usage)                        AS estimated_cost,
        (SELECT COUNT(*)            FROM chat_history WHERE grounded = false)                 AS unanswered,
        -- Split the ungrounded half. "Answered from general knowledge" and
        -- "refused outright" are both grounded=false but call for different
        -- action: the first is fine, the second names a law worth uploading.
        (SELECT COUNT(*)            FROM chat_history WHERE mode = 'general')                 AS general_answers,
        (SELECT COUNT(*)            FROM chat_history WHERE mode = 'refused')                 AS refused_answers,
        (SELECT COALESCE(AVG(latency_ms), 0)     FROM chat_history WHERE latency_ms IS NOT NULL) AS avg_latency_ms,
        (SELECT COUNT(*)            FROM uploaded_cases)                                      AS uploaded_cases
    `),

    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM legal_sources)                        AS total_sources,
        (SELECT COUNT(*) FROM legal_sources WHERE status = 'ready') AS ready_sources,
        (SELECT COUNT(*) FROM legal_sources WHERE status = 'failed')AS failed_sources,
        (SELECT COUNT(*) FROM legal_documents)                      AS total_chunks,
        (SELECT COUNT(*) FROM court_cases)                          AS total_cases
    `),

    // Keyword frequency across recent questions. unnest+GROUP BY beats scanning
    // question text on every dashboard load.
    query(`
      SELECT word, COUNT(*)::int AS count
        FROM (
          SELECT unnest(string_to_array(lower(regexp_replace(query, '[^؀-ۿ\\w\\s]', ' ', 'g')), ' ')) AS word
            FROM search_log
           WHERE created_at > now() - interval '30 days'
        ) w
       WHERE length(word) >= 4
         AND word NOT IN ('التي','الذي','هذا','هذه','ماهي','حسب','قانون','ماهو','وهل','عليه','كيف','ماذا','لماذا','يجوز','يمكن')
       GROUP BY word
       ORDER BY count DESC
       LIMIT 15
    `),

    query(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             COALESCE(c.questions, 0)::int AS questions,
             COALESCE(c.sessions, 0)::int  AS sessions
        FROM generate_series(now()::date - interval '13 days', now()::date, interval '1 day') AS d(day)
        LEFT JOIN (
          SELECT created_at::date AS day,
                 COUNT(*) AS questions,
                 COUNT(DISTINCT session_id) AS sessions
            FROM chat_history
           WHERE created_at > now() - interval '14 days'
           GROUP BY 1
        ) c ON c.day = d.day
       ORDER BY d.day
    `),

    query(`
      SELECT id, question, grounded, mode, latency_ms,
             jsonb_array_length(sources_used) AS source_count,
             to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
        FROM chat_history
       ORDER BY created_at DESC
       LIMIT 25
    `),
  ]);

  return Response.json({ totals, sources, topics, daily, recent });
}
