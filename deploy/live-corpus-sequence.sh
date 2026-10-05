#!/usr/bin/env bash
#
# Phase 2.4 — the live corpus sequence, in order, every output kept as
# evidence in $OUT. Run it on a Neon BRANCH first (DATABASE_ENVIRONMENT=branch),
# never straight on production.
#
#   export DATABASE_URL=…            # the branch (never printed)
#   export DATABASE_ENVIRONMENT=branch
#   export PRODUCTION_DATABASE_HOST=… # the production endpoint host: refused even if mislabelled
#   export OUT=evidence/live-YYYYMMDD
#
#   bash deploy/live-corpus-sequence.sh before   # identity, snapshot, inventory, migrate, DRY-RUN prepare
#   #   → READ $OUT/prepare-dry-run.txt: every decision, every mismatch. Stop if anything is wrong.
#   bash deploy/live-corpus-sequence.sh apply    # prepare --apply, history, inventory, strict, snapshot diff
#   bash deploy/live-corpus-sequence.sh live     # preflight with probe; then, only if it passes: the critical-law
#                                                #   checks, the pre-registered probes (retrieval, then answers)
#                                                #   and the live evaluation
#
# Nothing here prints a credential. Each stage stops at the first failure.
set -euo pipefail

stage="${1:-}"
: "${OUT:?set OUT to the evidence directory (kept between stages)}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.."

run() { # run <name> <command…>: output to the terminal and to $OUT/<name>.txt
  local name="$1"; shift
  echo -e "\n\033[1;33m==> $name\033[0m"
  "$@" 2>&1 | tee "$OUT/$name.txt"
  return "${PIPESTATUS[0]}"
}

case "$stage" in
  before)
    run identity-before npm run -s db:identity -- --json "$OUT/identity-before.json"
    run snapshot-before npm run -s corpus:snapshot -- --out "$OUT/snapshot-before.json"
    run inventory-before npm run -s corpus:inventory -- --md "$OUT/inventory-before.md" --json "$OUT/inventory-before.json"
    run migrate npm run -s db:migrate
    run identity-migrated npm run -s db:identity -- --json "$OUT/identity-migrated.json"
    run prepare-dry-run npm run -s corpus:integrity -- prepare
    echo -e "\nREVIEW $OUT/prepare-dry-run.txt — every 'apply', every 'mismatch' and 'conflict' — before: bash deploy/live-corpus-sequence.sh apply"
    ;;
  apply)
    [[ -f "$OUT/prepare-dry-run.txt" ]] || { echo "No dry run in $OUT: run the 'before' stage and review it first." >&2; exit 1; }
    run prepare-apply npm run -s corpus:integrity -- prepare --apply
    run history-civil-code npm run -s corpus:integrity -- history 2
    run history-penal-code-old npm run -s corpus:integrity -- history 3
    run inventory-after npm run -s corpus:inventory -- --md "$OUT/inventory-after.md" --json "$OUT/inventory-after.json"
    # --strict exits 1 while critical anomalies remain (missing P0 laws included): recorded, not fatal here.
    npm run -s corpus:inventory -- --strict > "$OUT/inventory-strict.md" 2>&1 && echo "strict: no critical anomaly" | tee "$OUT/inventory-strict.txt" \
      || echo "strict: critical anomalies remain — $OUT/inventory-strict.md" | tee "$OUT/inventory-strict.txt"
    run snapshot-after npm run -s corpus:snapshot -- --out "$OUT/snapshot-after.json"
    run snapshot-diff npm run -s corpus:snapshot -- --compare "$OUT/snapshot-before.json" "$OUT/snapshot-after.json" --md "$OUT/snapshot-diff.md"
    ;;
  live)
    # Measurements never purge the database they measure.
    export AUTO_RETENTION=false
    run preflight npm run -s eval:preflight -- --probe --json "$OUT/preflight.json"
    # Phase D/E with evidence; exits 1 if a corrupted text is reachable by any route.
    run critical npm run -s corpus:critical -- --md "$OUT/critical.md" --json "$OUT/critical.json"
    # Phase F/G: the probes pre-registered in benchmark/live-probes-2.4.json.
    run probes npm run -s eval:probes -- --json "$OUT/probes.json" --md "$OUT/probes.md"
    run probes-answers npm run -s eval:probes -- --answers --json "$OUT/probes-answers.json" --md "$OUT/probes-answers.md"
    EVAL_RESULTS_DIR="$OUT" run eval-live npm run -s eval:live
    ;;
  *)
    echo "usage: OUT=… bash deploy/live-corpus-sequence.sh before|apply|live" >&2
    exit 2
    ;;
esac
