-- ============================================================
--  AI Legal Research Assistant — schema
--  Postgres 16 + pgvector
--  Idempotent: safe to run repeatedly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- users
-- No login in phase 1. The table exists so that the admin seat
-- and future lawyer accounts have a home without a migration.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  email       TEXT        UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'lawyer'
              CHECK (role IN ('admin', 'lawyer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- email was NOT NULL UNIQUE from the original stub, before this project had
-- any real signup flow. The lawyer gate identifies people by name only (no
-- password, no email) — ALTER rather than a new table, since this row is
-- exactly the "future lawyer accounts" home the original comment reserved.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_name TEXT;

-- The name a lawyer re-enters to log back in, folded the same way search
-- folds Arabic (foldForSearch: alef/ya/ta-marbuta variants, lowercased) plus
-- whitespace-collapsed, so "أحمد  الحسن" / "احمد الحسن" register as the same
-- person rather than silently creating a second row. Enforced unique so two
-- different real lawyers can never collide onto one identity — the price is
-- that a genuine name clash must add something to disambiguate (a middle
-- name), which is the explicit tradeoff requested over silent merging.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_key ON users (name_key) WHERE name_key IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- legal_sources
-- One row per uploaded authority: a law, a regulation, a court
-- decision file. The unit an admin manages and re-indexes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_sources (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT        NOT NULL,
  source_type  TEXT        NOT NULL
               CHECK (source_type IN (
                 'law',            -- قانون
                 'regulation',     -- نظام
                 'instruction',    -- تعليمات
                 'court_decision', -- قرار محكمة
                 'principle',      -- مبدأ / اجتهاد
                 'template'        -- قالب صياغة
               )),
  category     TEXT,          -- حقوقية / جزائية / عمالية / تجارية ...
  court        TEXT,          -- بداية / استئناف / تمييز
  year         INTEGER,
  file_path    TEXT,

  -- SHA-256 of the file bytes. Bulk ingest of a folder is a long, resumable
  -- job: this is what lets a re-run skip what already succeeded instead of
  -- re-embedding it and paying twice. Also catches the same decision filed
  -- under two different names.
  file_hash    TEXT,

  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error        TEXT,
  chunk_count  INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS is a no-op on an existing table — it will not add
-- a column. Every field introduced after the first deploy needs its own ALTER
-- or the migration silently succeeds while the column is still missing.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- Non-fatal caveat about a source the admin should see: "this file's text came
-- from OCR, so its article numbers are unverified". Distinct from `error`,
-- which means the ingest failed outright.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS note TEXT;

-- ---- law identity & legal versioning ---------------------------------------
-- A statute is not just a title. A lawyer cites "قانون العمل رقم 8 لسنة 1996",
-- and the same law lives in the corpus as an original plus a stack of amending
-- acts ("قانون معدل لقانون العمل ..."). Without explicit links, retrieval
-- returns the original text of an article and its amended text side by side
-- with nothing to say which is in force — a citation-collision that is exactly
-- the failure this system exists to prevent. These columns make the version
-- lineage explicit, and the retrieval layer (search/hybrid.ts) uses them to
-- return the current version by default and older versions only when the
-- lawyer asks about a past date — a decision taken in code, never by the model.

-- The law's own number, e.g. "8" for قانون العمل رقم 8 لسنة 1996. Kept beside
-- `year`, which already exists and holds لسنة <year>. Together they are the
-- citation identity a lawyer searches by.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS law_number TEXT;

-- تاريخ النفاذ — the date the law/regulation entered into force ("يعمل به من
-- تاريخ نشره في الجريدة الرسمية"). Distinct from `year` (the year OF the law)
-- and from `created_at` (when we ingested it). This is the field the retrieval
-- layer orders versions by and compares an "as-of" query date against.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS effective_date DATE;

-- ---- versioning columns, added data-preservingly ---------------------------
-- The first cut of this feature shipped `amends_source_id` and `is_in_force`.
-- The versioning spec renames them to `amendment_of` / `is_current_version`
-- and adds `supersedes`. RENAME (not drop+add) so the links already backfilled
-- into the old columns survive the migration untouched. Each rename is guarded
-- so it runs exactly once and is a no-op on a fresh database (where the ADD
-- COLUMN statements below create the columns under their final names).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'legal_sources' AND column_name = 'amends_source_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'legal_sources' AND column_name = 'amendment_of') THEN
    ALTER TABLE legal_sources RENAME COLUMN amends_source_id TO amendment_of;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'legal_sources' AND column_name = 'is_in_force')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'legal_sources' AND column_name = 'is_current_version') THEN
    ALTER TABLE legal_sources RENAME COLUMN is_in_force TO is_current_version;
  END IF;
END $$;

-- amendment_of: for an amending act, the original (base) law it amends. NULL
-- means "this IS an original / base law". ON DELETE SET NULL, not CASCADE:
-- deleting a base law must not silently delete the amendments that reference
-- it — it orphans them so the admin notices.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS amendment_of BIGINT
  REFERENCES legal_sources(id) ON DELETE SET NULL;

-- supersedes: the specific prior VERSION this row replaces — distinct from
-- amendment_of. amendment_of points up to the base law; supersedes points back
-- along the timeline to the version that was current before this one (e.g. a
-- 2024 consolidated text supersedes the 2019 consolidated text of the same
-- law). It is how the timeline is ordered without inferring it from dates alone.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS supersedes BIGINT
  REFERENCES legal_sources(id) ON DELETE SET NULL;

-- is_current_version: whether this row is the version in force today. The
-- retrieval default returns only rows where this is true; a historical ("as of
-- year X") query is what lifts that filter. A superseded version is flipped
-- false so it leaves the default results without being deleted from the record.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN NOT NULL DEFAULT true;

-- A row cannot amend or supersede itself — either would make the version
-- lineage recurse forever. Guarded so it is added once and survives the rename.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_no_self_amend') THEN
    ALTER TABLE legal_sources
      ADD CONSTRAINT legal_sources_no_self_amend CHECK (amendment_of IS NULL OR amendment_of <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_no_self_supersede') THEN
    ALTER TABLE legal_sources
      ADD CONSTRAINT legal_sources_no_self_supersede CHECK (supersedes IS NULL OR supersedes <> id);
  END IF;
END $$;

-- Drop the old index names from before the rename, then (re)create under the
-- new column names. DROP by the old name is a no-op once already dropped.
DROP INDEX IF EXISTS idx_sources_amends;
DROP INDEX IF EXISTS idx_sources_in_force;
CREATE INDEX IF NOT EXISTS idx_sources_amendment  ON legal_sources (amendment_of);
CREATE INDEX IF NOT EXISTS idx_sources_supersedes ON legal_sources (supersedes);
CREATE INDEX IF NOT EXISTS idx_sources_current    ON legal_sources (is_current_version);
CREATE INDEX IF NOT EXISTS idx_sources_lawnum     ON legal_sources (law_number);
CREATE INDEX IF NOT EXISTS idx_sources_effective  ON legal_sources (effective_date);

-- Partial unique index, not a plain UNIQUE: a failed ingest leaves a row whose
-- file the admin may legitimately retry, and NULL hashes (pre-existing rows,
-- manual uploads) must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_hash
  ON legal_sources (file_hash) WHERE file_hash IS NOT NULL AND status = 'ready';

CREATE INDEX IF NOT EXISTS idx_sources_type     ON legal_sources (source_type);
CREATE INDEX IF NOT EXISTS idx_sources_category ON legal_sources (category);
CREATE INDEX IF NOT EXISTS idx_sources_year     ON legal_sources (year);

-- ------------------------------------------------------------
-- legal_documents
-- The retrieval unit. One row per chunk, with its embedding and
-- the citation metadata needed to render a source card.
--
-- Two copies of the text, on purpose:
--   chunk_text  — verbatim, this is what we quote to a lawyer.
--   folded_text — orthographically folded (أ/إ/ا, ى/ي, ة/ه). Search only.
-- Arabic is written inconsistently; a lawyer typing "اجراءات" must match
-- stored "إجراءات". Folding cannot happen at query time because the index is
-- built on the stored form, and it must not happen in chunk_text because that
-- would corrupt the statute text we quote back. Hence both.
--
-- content_tsv is GENERATED from folded_text so keyword search can never drift
-- out of sync with it. Config is 'simple': no stemmer — Postgres has no Arabic
-- one, and 'simple' tokenises on whitespace without mangling surface forms.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_documents (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT      NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
  chunk_index     INTEGER     NOT NULL,
  chunk_text      TEXT        NOT NULL,
  folded_text     TEXT        NOT NULL DEFAULT '',
  extracted_text  TEXT,       -- full parent text, kept on chunk 0 only
  embedding       vector(1536),

  -- denormalised citation fields: these are what the lawyer
  -- actually searches by, so they get real columns + indexes
  -- rather than living inside the metadata JSON.
  article_number  TEXT,
  law_name        TEXT,
  court           TEXT,
  decision_number TEXT,
  year            INTEGER,
  category        TEXT,
  keywords        TEXT[],

  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  content_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('simple', folded_text)) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_id, chunk_index)
);

-- Structural + semantic context of the chunk, produced by chunkLegalText.
-- Added after the first deploy, so each needs its own ALTER (CREATE TABLE IF
-- NOT EXISTS is a no-op on the existing table).
--   part / chapter / section — the الباب/الفصل/الفرع the article sits under, so
--     a retrieved article carries its place in the law's structure even though
--     those headings appear paragraphs away and never inside the chunk itself.
--   legal_topics — curated subject tags (legal-topics.ts), distinct from the
--     frequency-based keywords.
--   decision_section — for a court ruling, which part it is (الوقائع/الأسباب/
--     المبدأ/المنطوق).
--   proves_chunk_index — for a principle chunk, the chunk_index of the
--     reasoning that establishes it (the "المبدأ ↔ سنده" link).
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS law_number         TEXT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS part               TEXT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS chapter            TEXT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS section            TEXT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS legal_topics       TEXT[];
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS decision_section   TEXT;
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS proves_chunk_index INTEGER;

-- stemmed_text: search/arabic-stem.ts's light-stemmed form of chunk_text
-- (clitic prefixes/suffixes stripped, NOT root extraction — see that file's
-- header for why). Postgres's 'simple' tsvector config has no Arabic
-- stemmer, so "المستأجرين"/"للمستأجر"/"مستأجر" tokenise as three unrelated
-- words in content_tsv; content_tsv_stemmed gives search/hybrid.ts a third
-- fusion arm where all three collide on one token. A third TEXT + generated
-- tsvector column, not a rewrite of folded_text/content_tsv, so the exact
-- (unstemmed) keyword arm keeps working exactly as it does today — stemming
-- only ever ADDS a ranking signal, never replaces the precise one.
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS stemmed_text TEXT NOT NULL DEFAULT '';
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS content_tsv_stemmed tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', stemmed_text)) STORED;
CREATE INDEX IF NOT EXISTS idx_documents_tsv_stemmed ON legal_documents USING gin (content_tsv_stemmed);

-- HNSW over cosine distance. Chosen over IVFFlat because it needs no
-- training step and stays accurate on a small, constantly-growing
-- corpus — which is exactly an MVP knowledge base.
CREATE INDEX IF NOT EXISTS idx_documents_embedding
  ON legal_documents USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_documents_tsv
  ON legal_documents USING gin (content_tsv);

-- Trigram index: catches misspellings and partial forms that tsvector's exact
-- token match misses. Built on folded_text for the same reason as content_tsv.
CREATE INDEX IF NOT EXISTS idx_documents_chunk_trgm
  ON legal_documents USING gin (folded_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_documents_source   ON legal_documents (source_id);
CREATE INDEX IF NOT EXISTS idx_documents_article  ON legal_documents (article_number);
CREATE INDEX IF NOT EXISTS idx_documents_decision ON legal_documents (decision_number);
CREATE INDEX IF NOT EXISTS idx_documents_keywords ON legal_documents USING gin (keywords);
CREATE INDEX IF NOT EXISTS idx_documents_topics   ON legal_documents USING gin (legal_topics);

-- ------------------------------------------------------------
-- court_cases
-- Structured header for a decision. legal_documents holds the
-- searchable body; this holds the one-row summary a lawyer reads.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS court_cases (
  id               BIGSERIAL PRIMARY KEY,
  source_id        BIGINT REFERENCES legal_sources(id) ON DELETE CASCADE,
  case_number      TEXT,
  court_name       TEXT,
  case_type        TEXT,
  year             INTEGER,
  decision_text    TEXT,
  legal_principle  TEXT,
  keywords         TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_number ON court_cases (case_number);
CREATE INDEX IF NOT EXISTS idx_cases_court  ON court_cases (court_name);
CREATE INDEX IF NOT EXISTS idx_cases_type   ON court_cases (case_type);
CREATE INDEX IF NOT EXISTS idx_cases_year   ON court_cases (year);

-- ------------------------------------------------------------
-- uploaded_cases
-- A visitor's own PDF. Scoped to their anonymous session, never
-- mixed into the shared knowledge base.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploaded_cases (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT        NOT NULL,
  file_name       TEXT,
  file_path       TEXT,
  extracted_text  TEXT,
  analysis        JSONB,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploaded_session ON uploaded_cases (session_id);

-- ------------------------------------------------------------
-- chat_history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_history (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT        NOT NULL,
  question      TEXT        NOT NULL,
  answer        TEXT,
  sources_used  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  grounded      BOOLEAN     NOT NULL DEFAULT false,

  -- How the answer was produced: grounded | general | refused. Kept so the
  -- history renders an ungrounded answer with the same amber fencing it had
  -- when it was live — a reloaded answer must not look more authoritative
  -- than the original.
  mode          TEXT,

  tokens_in     INTEGER     NOT NULL DEFAULT 0,
  tokens_out    INTEGER     NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS is a no-op on an existing table — it will not add
-- a column. Every field introduced after the first deploy needs its own ALTER.
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS mode TEXT;

-- Phase 6 self-verification (src/lib/ai/self-verify.ts) — logged for
-- monitoring per its own spec. NULL on every row the verifier didn't run for
-- (usedDirectSourceFallback, or any non-grounded mode) — not "passed", just
-- "not applicable", a real distinction an admin view should be able to make.
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS verification_issues TEXT[];
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS verification_severity TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS verification_action TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS verification_repaired BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_history (created_at DESC);

-- ------------------------------------------------------------
-- anonymous_usage
-- One row per session. ip_hash is salted SHA-256, never the raw IP.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anonymous_usage (
  id               BIGSERIAL PRIMARY KEY,
  session_id       TEXT        NOT NULL UNIQUE,
  ip_hash          TEXT,
  user_agent       TEXT,
  questions_count  INTEGER     NOT NULL DEFAULT 0,
  tokens_used      INTEGER     NOT NULL DEFAULT 0,
  estimated_cost   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON anonymous_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_iphash  ON anonymous_usage (ip_hash);

-- ------------------------------------------------------------
-- search_log
-- Feeds the "most searched topics" panel without having to
-- re-scan chat_history text on every dashboard load.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_log (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT,
  query       TEXT        NOT NULL,
  category    TEXT,
  hit_count   INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_created ON search_log (created_at DESC);

-- ------------------------------------------------------------
-- rate_limit_buckets
-- Durable backing store for src/lib/ratelimit.ts. Was a plain
-- in-memory Map — resets on every restart/redeploy and would
-- silently multiply the effective limit across multiple Node
-- instances. One row per limiter key (e.g. "chat:lawyer:42" or
-- "chat-daily-ip:<hash>"); a single atomic UPSERT does the
-- check-and-increment, so two concurrent requests for the same
-- key can never both slip through as the Nth request.
--
-- Fixed-window semantics, not sliding: a key's window starts on
-- its own first request, not a clock-aligned boundary (avoids the
-- classic double-burst-at-the-edge problem a naive clock-aligned
-- window has).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key  TEXT        PRIMARY KEY,
  count       INTEGER     NOT NULL DEFAULT 0,
  reset_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_buckets (reset_at);

-- ------------------------------------------------------------
-- cost_ledger
-- Durable backing store for src/lib/costcap.ts's daily USD
-- circuit breakers (per-IP and site-wide). Same restart/
-- multi-instance problem as rate_limit_buckets above, for the
-- same reason: this is the thing standing between the app and an
-- unbounded OpenAI/Anthropic bill, so it has to actually hold
-- across a redeploy, not just within one process's uptime.
--
-- One row per (key, day). Site-wide spend for today is
-- SUM(usd) WHERE day = current_date — no reserved sentinel key
-- needed, unlike the in-memory version this replaces.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_ledger (
  cost_key  TEXT          NOT NULL,
  day       DATE          NOT NULL,
  usd       NUMERIC(12,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (cost_key, day)
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_day ON cost_ledger (day);

-- ------------------------------------------------------------
-- error_log
-- Every console.error site in the app (see src/lib/error-log.ts)
-- also writes here, so an unexpected failure shows up on the
-- admin dashboard instead of requiring someone to watch server
-- logs live to notice it. `context` is the same bracketed tag
-- already used in the console output (e.g. "[chat] stream
-- failed"), so a row and its matching log line are trivially
-- cross-referenced if the stack isn't enough on its own.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_log (
  id          BIGSERIAL PRIMARY KEY,
  context     TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  stack       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log (created_at DESC);

-- ------------------------------------------------------------
-- law_versions  (view)
-- One row per source, flattened so the admin (and any lineage
-- query) can read a law's version story without a recursive CTE:
--   • base_id     — the original law this row belongs to
--                   (itself, if it is the original).
--   • role        — 'original' | 'amendment'.
--   • base_title  — the original's title, for grouping in the UI.
-- "النافذ حالياً" for a base law is then: that base's rows WHERE
-- is_current_version, ordered by effective_date — the original plus
-- every amendment that has taken effect, newest last.
-- A view, not a table: always in sync with legal_sources, costs
-- nothing to keep. DROP+CREATE (not REPLACE) because the underlying
-- columns were renamed and REPLACE cannot rename a view's output.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS law_versions;
CREATE VIEW law_versions AS
SELECT
  s.id,
  s.title,
  s.source_type,
  s.law_number,
  s.year,
  s.effective_date,
  s.is_current_version,
  s.amendment_of,
  s.supersedes,
  COALESCE(s.amendment_of, s.id)                  AS base_id,
  CASE WHEN s.amendment_of IS NULL
       THEN 'original' ELSE 'amendment' END       AS role,
  base.title                                      AS base_title
FROM legal_sources s
LEFT JOIN legal_sources base ON base.id = s.amendment_of
WHERE s.source_type IN ('law', 'regulation', 'instruction');

-- ============================================================
--  Phase 2 — AI boundary, provenance, accounting
-- ============================================================

-- service_request_nonces
-- One row per accepted service assertion (src/lib/service-auth.ts): the jti
-- is accepted once, so a captured Dostoori request cannot be replayed even
-- inside its short validity window. Rows are useless after expires_at and
-- are pruned opportunistically.
CREATE TABLE IF NOT EXISTS service_request_nonces (
  jti         TEXT        PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_nonces_expiry ON service_request_nonces (expires_at);

-- ---- source provenance ----------------------------------------------------
-- Every legal answer must trace to a concrete source and version. title/year/
-- law_number/effective_date/is_current_version already exist; these add where
-- the text came from and how authoritative that origin is.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS source_url        TEXT;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS issuing_authority TEXT;
-- ISO country code. Retrieval only ever serves JO; a source from elsewhere
-- must be labelled so it can never answer a Jordanian question silently.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS jurisdiction      TEXT NOT NULL DEFAULT 'JO';
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS language          TEXT NOT NULL DEFAULT 'ar';
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS publication_date  DATE;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS acquired_at       TIMESTAMPTZ;
-- 'official' (the issuing authority's own publication), 'secondary' (a
-- non-official republication), or NULL = not recorded. Shown to the admin.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS provenance        TEXT
  CHECK (provenance IS NULL OR provenance IN ('official', 'secondary', 'synthetic'));
-- Test fixtures (eval/fixtures) are marked synthetic and are excluded from
-- retrieval unless ALLOW_SYNTHETIC_CORPUS=true — a fixture accidentally loaded
-- into production can never be quoted to a lawyer as law.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS is_synthetic      BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_sources_jurisdiction ON legal_sources (jurisdiction);

-- ---- embedding versioning ---------------------------------------------------
-- Which model produced each vector. Two models with the same dimension would
-- otherwise mix silently after a config change; retrieval only compares a
-- query vector against rows from the SAME model (search/hybrid.ts), and the
-- reindex script finds the stale ones.
ALTER TABLE legal_documents ADD COLUMN IF NOT EXISTS embedding_model TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_embedding_model ON legal_documents (embedding_model);

-- ---- per-request AI accounting ----------------------------------------------
-- One row per AI request, metadata only: never the question, the document or
-- the answer. office_id/user_id are Dostoori's opaque ids (service callers)
-- so an office's rows can be reported on and deleted at offboarding.
CREATE TABLE IF NOT EXISTS ai_requests (
  id                BIGSERIAL   PRIMARY KEY,
  request_id        TEXT,
  caller_kind       TEXT        NOT NULL CHECK (caller_kind IN ('lawyer', 'service')),
  office_id         TEXT,
  user_id           TEXT,
  lawyer_id         BIGINT,
  feature           TEXT        NOT NULL,
  chat_model        TEXT,
  embedding_model   TEXT,
  prompt_version    TEXT,
  corpus_version    TEXT,
  llm_calls         INTEGER     NOT NULL DEFAULT 0,
  tokens_in         INTEGER     NOT NULL DEFAULT 0,
  tokens_out        INTEGER     NOT NULL DEFAULT 0,
  embedding_tokens  INTEGER     NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms        INTEGER,
  success           BOOLEAN     NOT NULL,
  outcome           TEXT,
  grounding_level   TEXT,
  retrieval_count   INTEGER,
  source_count      INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_office  ON ai_requests (office_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_requests_created ON ai_requests (created_at DESC);

-- ---- retired synthetic Dostoori identities ------------------------------------
-- Dostoori calls used to run as a synthetic lawyer per office
-- ("dostoori-office-<id>") that anyone could log in as by typing the name.
-- Service calls now authenticate with signed assertions and are never lawyer
-- rows; the leftovers are removed (rate-limit buckets keyed on them expire on
-- their own). Idempotent.
DELETE FROM users WHERE name_key LIKE 'dostoori-office-%' OR office_name = 'Dostoori (integration)';

-- ============================================================
--  Phase 2.1 — corpus integrity
-- ============================================================

-- Whether a source's TEXT can be relied on. Its values and its CHECK
-- constraint were redefined by the corpus repair below ("separate states"):
-- unchecked / passed / quarantined / replaced, and Gazette verification is a
-- column of its own. The Phase 2.1 values (verified / unverified) are migrated
-- there.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS integrity_status TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS integrity_note       TEXT;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS integrity_checked_at TIMESTAMPTZ;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS replaced_by          BIGINT REFERENCES legal_sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sources_integrity ON legal_sources (integrity_status);

-- Every integrity decision, append-only: who changed a source's status, from
-- what to what, why, and against which evidence (the official publication's
-- URL or file hash). Quarantining or replacing a source never deletes it.
CREATE TABLE IF NOT EXISTS corpus_integrity_events (
  id           BIGSERIAL   PRIMARY KEY,
  source_id    BIGINT      NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT        NOT NULL,
  actor        TEXT        NOT NULL,
  reason       TEXT        NOT NULL,
  evidence     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integrity_events_source ON corpus_integrity_events (source_id, created_at);

-- ---- Phase 2.1: automatic retention ------------------------------------------
-- When periodic maintenance last ran, shared by every instance: the content
-- purge (src/lib/retention.ts) runs from request handling at most once per
-- interval across the deployment, so retention no longer depends on an
-- operator having installed the cron job.
CREATE TABLE IF NOT EXISTS maintenance_runs (
  task         TEXT        PRIMARY KEY,
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  last_report  JSONB
);

-- Phase 2.1: where each request's time went — pipeline stages and model time
-- per purpose, ms (src/lib/ai/request.ts stageTimings). Numbers only.
ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS stage_ms JSONB;

-- ============================================================
--  Corpus repair — separate states, safe by default (2026-10)
-- ============================================================
-- Five facts about a source are recorded separately, and none is inferred
-- from another (src/lib/corpus/integrity.ts):
--   provenance          where the text came from: the official publisher, or a
--                       secondary republication (column above, unchanged)
--   integrity_status    whether the stored TEXT passed the integrity checks
--   gazette_status      whether the text was compared with the Official
--                       Gazette — with the reference it was compared against
--   is_current_version / effective_date   which version of the law it is
--   authority           derived, never stored: Gazette-verified AND integrity
--                       passed AND not a fixture
-- A text from the Legislation Bureau is an official source but NOT
-- Gazette-verified until someone compares it; a Ministry of Justice
-- republication is secondary, and can still be Gazette-verified later.
--
-- integrity_status, redefined:
--   'unchecked'   never checked — NEVER served. The default: nothing reaches a
--                 lawyer until it has passed the checks.
--   'passed'      passed the integrity checks (automatic: not garbled, not
--                 empty, article numbering intact; or a reviewer's decision).
--                 Served. Says nothing about the Official Gazette.
--   'quarantined' damaged or suspect — NEVER served, kept as evidence
--   'replaced'    replaced by a repaired re-ingest — NEVER served, kept
-- Phase 2.1's values migrate:
--   'verified'   (a reviewer compared the text with "the official publication",
--                which may have been the Legislation Bureau's copy rather than
--                the Official Gazette) becomes integrity 'passed' — the text was
--                reviewed — and gazette_status stays 'unverified': a Gazette
--                verification is never inferred from it. A reviewer confirms it
--                with `corpus:integrity gazette-verify` and the Gazette reference.
--   'unverified' (served without any check) becomes 'unchecked', so nothing is
--                served again until it has been checked
--                (npm run corpus:integrity -- prepare --apply).
-- Both migrations are logged as events.
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS gazette_status      TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS gazette_reference   TEXT;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS gazette_verified_at TIMESTAMPTZ;
ALTER TABLE legal_sources ADD COLUMN IF NOT EXISTS gazette_verified_by TEXT;
ALTER TABLE legal_sources ALTER COLUMN integrity_status SET DEFAULT 'unchecked';

-- Every corpus decision, not only integrity ones: what kind of fact changed
-- ('integrity', 'gazette', 'metadata', 'classification', 'provenance').
-- Repairs from deploy/sources/corpus-repairs.json are logged here too.
ALTER TABLE corpus_integrity_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'integrity';

DO $$
DECLARE c record;
BEGIN
  -- Phase 2.1 created integrity_status (and the first deploy source_type) with
  -- an inline CHECK, auto-named: drop every CHECK on those columns but ours.
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'legal_sources'::regclass AND contype = 'c'
              AND conname NOT IN ('legal_sources_integrity_chk', 'legal_sources_source_type_chk')
              AND (pg_get_constraintdef(oid) LIKE '%integrity_status%' OR pg_get_constraintdef(oid) LIKE '%source_type%')
  LOOP
    EXECUTE format('ALTER TABLE legal_sources DROP CONSTRAINT %I', c.conname);
  END LOOP;

  INSERT INTO corpus_integrity_events (source_id, kind, from_status, to_status, actor, reason, evidence)
  SELECT id, 'integrity', 'verified', 'passed', 'migration (corpus repair 2026-10)',
         'Phase 2.1 "verified" (compared with an official publication) recorded as integrity passed. '
         'Gazette verification is NOT inferred from it: confirm with corpus:integrity gazette-verify and the Gazette reference.',
         integrity_note
    FROM legal_sources WHERE integrity_status = 'verified';
  UPDATE legal_sources SET integrity_status = 'passed' WHERE integrity_status = 'verified';

  INSERT INTO corpus_integrity_events (source_id, kind, from_status, to_status, actor, reason, evidence)
  SELECT id, 'integrity', 'unverified', 'unchecked', 'migration (corpus repair 2026-10)',
         'Phase 2.1 served "unverified" texts without any check; nothing is served now until the integrity check passes (corpus:integrity prepare --apply).',
         NULL
    FROM legal_sources WHERE integrity_status = 'unverified';
  UPDATE legal_sources SET integrity_status = 'unchecked' WHERE integrity_status = 'unverified';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_integrity_chk') THEN
    ALTER TABLE legal_sources ADD CONSTRAINT legal_sources_integrity_chk
      CHECK (integrity_status IN ('unchecked', 'passed', 'quarantined', 'replaced'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_gazette_chk') THEN
    ALTER TABLE legal_sources ADD CONSTRAINT legal_sources_gazette_chk
      CHECK (gazette_status IN ('unverified', 'verified'));
  END IF;
  -- Gazette verification is a claim about a text: it needs the reference it was
  -- compared against, and who compared it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_gazette_evidence_chk') THEN
    ALTER TABLE legal_sources ADD CONSTRAINT legal_sources_gazette_evidence_chk
      CHECK (gazette_status <> 'verified' OR (gazette_reference IS NOT NULL AND gazette_verified_by IS NOT NULL));
  END IF;

  -- Source classes (src/lib/corpus/source-class.ts). Added: 'interpretation'
  -- (decisions of the Special Bureau for the Interpretation of Laws, until now
  -- filed as 'principle'), 'mou' (memoranda of understanding, until now filed
  -- as 'instruction' for want of a type) and 'secondary' (commentary and other
  -- secondary material).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_sources_source_type_chk') THEN
    ALTER TABLE legal_sources ADD CONSTRAINT legal_sources_source_type_chk
      CHECK (source_type IN ('law', 'regulation', 'instruction', 'court_decision', 'principle', 'template',
                             'interpretation', 'mou', 'secondary'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sources_gazette ON legal_sources (gazette_status);
