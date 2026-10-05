/**
 * Comparable corpus snapshots (Phase 2.4): every source row as stored, and a
 * fingerprint of each source's TEXT (sha256 of its chunks in order), its
 * article numbering and its vectors — taken before and after any migration or
 * repair, so the effect of a change can be shown row by row and a text that
 * changed is caught. No `server-only` import: the CLI uses it directly.
 *
 * Works on any schema version: it reads the columns that exist.
 */

export type SourceSnapshot = {
  id: number;
  /** Every legal_sources column, as stored (dates as ISO strings). */
  row: Record<string, unknown>;
  chunks: number;
  /** sha256 of the source's chunk texts joined in chunk order — any change to the text changes it. */
  textSha256: string | null;
  /** sha256 of its article numbers in chunk order. */
  articlesSha256: string | null;
  embedded: number;
  models: string[];
};

export type CorpusSnapshot = {
  takenAt: string;
  /** Host, database, environment — never credentials (db-target.ts). */
  target: Record<string, unknown>;
  schemaFingerprint: string | null;
  sourceColumns: string[];
  sources: SourceSnapshot[];
  integrityEvents: number | null;
};

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

export async function takeSnapshot(db: Q, target: Record<string, unknown>): Promise<CorpusSnapshot> {
  const cols = new Set(
    (await db.query(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`)).rows.map((r) => `${r.t}.${r.c}`)
  );
  const tables = new Set([...cols].map((c) => c.split(".")[0]));
  const sourceColumns = [...cols].filter((c) => c.startsWith("legal_sources.")).map((c) => c.split(".")[1]).sort();
  const rows = (await db.query(`SELECT * FROM legal_sources ORDER BY id`)).rows;
  const model = cols.has("legal_documents.embedding_model") ? "embedding_model" : "NULL::text";
  const stats = new Map(
    (
      await db.query(
        `SELECT source_id,
                count(*)::int AS chunks,
                encode(sha256(convert_to(string_agg(chunk_text, E'\\n' ORDER BY chunk_index), 'UTF8')), 'hex') AS text_sha,
                encode(sha256(convert_to(string_agg(COALESCE(article_number, ''), ',' ORDER BY chunk_index), 'UTF8')), 'hex') AS art_sha,
                count(embedding)::int AS embedded,
                COALESCE(array_agg(DISTINCT ${model}) FILTER (WHERE embedding IS NOT NULL AND ${model} IS NOT NULL), '{}') AS models
           FROM legal_documents GROUP BY source_id`
      )
    ).rows.map((r) => [Number(r.source_id), r])
  );
  const schema = tables.has("schema_versions") ? (await db.query(`SELECT fingerprint FROM schema_versions ORDER BY applied_at DESC LIMIT 1`)).rows[0] : undefined;
  const events = tables.has("corpus_integrity_events") ? (await db.query(`SELECT count(*)::int AS n FROM corpus_integrity_events`)).rows[0] : undefined;
  return {
    takenAt: new Date().toISOString(),
    target,
    schemaFingerprint: (schema?.fingerprint as string | undefined) ?? null,
    sourceColumns,
    sources: rows.map((r) => {
      const s = stats.get(Number(r.id));
      return {
        id: Number(r.id),
        row: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)])),
        chunks: Number(s?.chunks ?? 0),
        textSha256: (s?.text_sha as string | undefined) ?? null,
        articlesSha256: (s?.art_sha as string | undefined) ?? null,
        embedded: Number(s?.embedded ?? 0),
        models: ((s?.models as string[] | undefined) ?? []).slice().sort(),
      };
    }),
    integrityEvents: events ? Number(events.n) : null,
  };
}

export type SourceChange = {
  id: number;
  title: string;
  fields: { field: string; from: unknown; to: unknown }[];
  /** The source's text itself changed — never expected from a repair. */
  textChanged: boolean;
  articlesChanged: boolean;
  chunks: { from: number; to: number } | null;
};

export type SnapshotDiff = {
  added: { id: number; title: string }[];
  removed: { id: number; title: string }[];
  changed: SourceChange[];
  newColumns: string[];
  textChanges: number;
  eventsAdded: number | null;
};

/** Volatile bookkeeping, not facts about the source. */
const IGNORED = new Set(["updated_at"]);

export function compareSnapshots(a: CorpusSnapshot, b: CorpusSnapshot): SnapshotDiff {
  const before = new Map(a.sources.map((s) => [s.id, s]));
  const after = new Map(b.sources.map((s) => [s.id, s]));
  const title = (s: SourceSnapshot) => String(s.row.title ?? "");
  const changed: SourceChange[] = [];
  for (const [id, x] of before) {
    const y = after.get(id);
    if (!y) continue;
    const fields: SourceChange["fields"] = [];
    for (const k of new Set([...Object.keys(x.row), ...Object.keys(y.row)])) {
      if (IGNORED.has(k) || !(k in x.row)) continue; // a column added by a migration is reported once, below
      if (JSON.stringify(x.row[k]) !== JSON.stringify(y.row[k])) fields.push({ field: k, from: x.row[k], to: y.row[k] });
    }
    const textChanged = x.textSha256 !== y.textSha256;
    const articlesChanged = x.articlesSha256 !== y.articlesSha256;
    const chunks = x.chunks !== y.chunks ? { from: x.chunks, to: y.chunks } : null;
    if (fields.length || textChanged || articlesChanged || chunks) changed.push({ id, title: title(y), fields, textChanged, articlesChanged, chunks });
  }
  return {
    added: b.sources.filter((s) => !before.has(s.id)).map((s) => ({ id: s.id, title: title(s) })),
    removed: a.sources.filter((s) => !after.has(s.id)).map((s) => ({ id: s.id, title: title(s) })),
    changed,
    newColumns: b.sourceColumns.filter((c) => !a.sourceColumns.includes(c)),
    textChanges: changed.filter((c) => c.textChanged).length,
    eventsAdded: a.integrityEvents !== null && b.integrityEvents !== null ? b.integrityEvents - a.integrityEvents : null,
  };
}

export function diffMarkdown(d: SnapshotDiff, a: CorpusSnapshot, b: CorpusSnapshot): string {
  const v = (x: unknown) => (x === null || x === undefined ? "∅" : String(x).slice(0, 80));
  const lines = [
    `# Corpus snapshot comparison`,
    "",
    `Before: ${a.takenAt} — ${JSON.stringify(a.target)}`,
    `After:  ${b.takenAt} — ${JSON.stringify(b.target)}`,
    "",
    `Sources added ${d.added.length} · removed ${d.removed.length} · changed ${d.changed.length} · **texts changed ${d.textChanges}** · audit events added ${d.eventsAdded ?? "?"} · new columns ${d.newColumns.join(", ") || "none"}`,
    "",
  ];
  if (d.removed.length) lines.push("## Removed (must not happen: nothing is ever deleted)", "", ...d.removed.map((r) => `- ${r.id} ${r.title}`), "");
  if (d.added.length) lines.push("## Added", "", ...d.added.map((r) => `- ${r.id} ${r.title}`), "");
  lines.push("## Changed", "", "| id | title | changes | text | articles | chunks |", "|---|---|---|---|---|---|");
  for (const c of d.changed) {
    lines.push(
      `| ${c.id} | ${c.title.slice(0, 50)} | ${c.fields.map((f) => `${f.field}: ${v(f.from)} → ${v(f.to)}`).join("<br>") || "—"} | ${c.textChanged ? "**CHANGED**" : "same"} | ${c.articlesChanged ? "changed" : "same"} | ${c.chunks ? `${c.chunks.from} → ${c.chunks.to}` : "same"} |`
    );
  }
  return lines.join("\n") + "\n";
}
