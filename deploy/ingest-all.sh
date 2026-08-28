#!/usr/bin/env bash
#
# Fetches and indexes the whole Jordanian corpus, in the right order, with the
# right flags per batch. The flags are not interchangeable — see each block.
#
#   bash deploy/ingest-all.sh --dry-run    # plan + cost, spends nothing
#   bash deploy/ingest-all.sh              # for real
#
# Requires DATABASE_URL (Postgres + pgvector) and OPENAI_API_KEY in .env.
# Safe to re-run: fetch skips files on disk, ingest skips sources already
# indexed by content hash. An interrupted run resumes where it stopped.
set -euo pipefail

cd "$(dirname "$0")/.."

DRY=""
[[ "${1:-}" == "--dry-run" ]] && DRY="--dry-run"

say() { echo -e "\n\033[1;33m==> $1\033[0m"; }

[[ -f .env ]] || { echo ".env missing. Copy .env.example and fill it in." >&2; exit 1; }
set -a; source .env; set +a

if [[ -z "${OPENAI_API_KEY:-}" || "${OPENAI_API_KEY}" == "sk-replace-me" ]]; then
  echo "OPENAI_API_KEY is not set in .env — ingest calls the embedding API." >&2
  exit 1
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in .env." >&2
  exit 1
fi

say "Applying migrations"
npm run db:migrate

# ---------------------------------------------------------------- laws
say "1/5  القوانين — 24 laws"
npm run fetch  -- --list=deploy/sources/moj-laws-ar.txt --out=./downloads/moj-laws
npm run ingest -- ./downloads/moj-laws --type=law $DRY

# ---------------------------------------------------------------- regulations
say "2/5  الأنظمة والتعليمات — 35 files"
# No --type on purpose: this batch mixes أنظمة and تعليمات (the ministry files
# both under one section). classify.ts reads the type from each filename's
# leading word. Forcing --type=regulation here would mislabel 8 instructions.
npm run fetch  -- --list=deploy/sources/moj-regulations-ar.txt --out=./downloads/moj-regs
npm run ingest -- ./downloads/moj-regs $DRY

# ---------------------------------------------------------------- constitution
say "3/5  الدستور — 10 chapters"
# Both flags are required. The files are named الفصل01..الفصل10: nothing in the
# name says what they are (so the classifier refuses to guess), and "الفصل07"
# alone is meaningless on a citation card.
npm run fetch  -- --list=deploy/sources/moj-constitution-ar.txt --out=./downloads/moj-dustour
npm run ingest -- ./downloads/moj-dustour --type=law --title-prefix="الدستور الأردني" $DRY

# ---------------------------------------------------------------- diwan
say "4/5  قرارات الديوان الخاص بتفسير القانون — 78 texts + attachments"
# Two passes because the source is mixed: most decisions are inline HTML, a
# few are PDF attachments. The HTML text is the best-quality input we have —
# it never touches a font map, so correct digits and no OCR.
npm run fetch  -- --list=deploy/sources/jc-diwan-decisions.txt --out=./downloads/jc-diwan --as-text="#MainContent_DivContent"
npm run fetch  -- --list=deploy/sources/jc-diwan-decisions.txt --out=./downloads/jc-diwan --match=news_new
npm run ingest -- ./downloads/jc-diwan --type=principle --title-prefix="قرار الديوان الخاص بتفسير القانون" $DRY

# ---------------------------------------------------------------- jba
say "5/5  مستجدات القرارات — نقابة المحامين"
# --type is explicit because these filenames (camscanner1.pdf, jba.pdf) say
# nothing, and the classifier stops rather than guess. Mixed courts — review
# each in /admin afterwards to set court, decision number and year.
npm run fetch  -- --list=deploy/sources/jba-decisions.txt --out=./downloads/jba-decisions --match=eb_list_page
npm run ingest -- ./downloads/jba-decisions --type=court_decision $DRY

# ----------------------------------------------------------------
if [[ -n "$DRY" ]]; then
  say "Dry run complete — nothing was written and no API was called."
  exit 0
fi

say "Done"
cat <<'EOF'
  Check /admin for:
    - sources marked "فشل"  — a malformed file; retry or replace it
    - amber notes           — OCR'd sources whose article numbers were withheld
    - the نقابة المحامين batch — set court / decision number / year by hand

  Then ask the chat something you know the answer to, e.g.
    "ما هي مدة التقادم في الدعاوى العمالية؟"
  and one you know is NOT in the corpus, to confirm it refuses instead of
  inventing an answer.
EOF
