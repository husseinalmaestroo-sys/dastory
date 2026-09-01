#!/usr/bin/env bash
# Post-deploy smoke test: drives the whole core workflow through the PUBLIC
# URL (real HTTP, real nginx, real containers) and fails loudly if anything
# in the chain is broken. deploy/deploy.sh runs this as a gate; run it by
# hand any time.
#
#   ./scripts/smoke.sh https://app.example.com
#
# Needs: curl, node   (node is already required — it's a Node app; no jq).
# Env:
#   SMOKE_REQUIRE_AI=1   treat a non-working AI path as a failure, not a
#                        warning (the AI endpoints are "optional
#                        infrastructure" by default — a fresh deploy with no
#                        AI_LEGAL_SERVICE_* set 503s there, which is fine
#                        unless you're about to onboard a pilot).
#   SMOKE_AI_MAX_S=90    fail an AI call slower than this (nginx
#                        proxy_read_timeout is 300s; this is the "is it
#                        actually answering" bound).
set -uo pipefail

BASE="${1:-}"
[ -n "$BASE" ] || { echo "usage: smoke.sh https://app.<domain>" >&2; exit 2; }
BASE="${BASE%/}"
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }
command -v node >/dev/null || { echo "node not found" >&2; exit 2; }

REQUIRE_AI="${SMOKE_REQUIRE_AI:-0}"
AI_MAX_S="${SMOKE_AI_MAX_S:-90}"
JAR="$(mktemp)"
WORK="$(mktemp -d)"
TMPTXT="$WORK/smoke.txt"
printf 'smoke test document %s\n' "$(date -u +%FT%TZ)" > "$TMPTXT"
PNG="$WORK/sig.png"
# a real 1x1 transparent PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > "$PNG"
trap 'rm -rf "$JAR" "$WORK"' EXIT

# jget <dotted.path>  — reads JSON on stdin, prints the value or "".
jget() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{let v=JSON.parse(d);for(const k of (process.argv[1]||"").split(".").filter(Boolean))v=v==null?v:v[k];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"
}

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }

# req METHOD PATH [curl args...]  -> sets $HTTP and $BODY
req() {
  local method="$1" path="$2"; shift 2
  local out; out="$(curl -sS -m 60 -w $'\n%{http_code}' -X "$method" \
    -b "$JAR" -c "$JAR" -H 'Accept: application/json' "$@" "$BASE$path" 2>/dev/null)" || true
  HTTP="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}

echo "smoke: $BASE"

# ---- 1. health ----------------------------------------------------------------
req GET /api/health
if [ "$HTTP" = "200" ] && [ "$(jget status <<<"$BODY")" = "ok" ]; then
  ok "health 200 / ok"
else
  bad "health: HTTP $HTTP — $(echo "$BODY" | head -c 200)"
  echo; echo "aborting — the app itself is not healthy."; exit 1
fi

# ---- 2. signup (fresh throwaway office) --------------------------------------------
EMAIL="smoke+$(date -u +%Y%m%d%H%M%S)-$RANDOM@smoke.invalid"
req POST /api/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"officeName\":\"Smoke Office\",\"email\":\"$EMAIL\",\"password\":\"SmokeTest1234\"}"
[ "$HTTP" = "201" ] && ok "signup 201 ($EMAIL)" || { bad "signup: HTTP $HTTP — $BODY"; exit 1; }

# ---- 3. client -> case -> session -> invoice -------------------------------------
req POST /api/clients -H 'Content-Type: application/json' -d '{"name":"Smoke Client","phone":"+962790000000"}'
CLIENT_ID="$(jget id <<<"$BODY")"
{ [ "$HTTP" = "201" ] && [ -n "$CLIENT_ID" ]; } && ok "client created" || bad "client: HTTP $HTTP — $BODY"

CNUM="SMK-$(date -u +%H%M%S)-$RANDOM"
req POST /api/cases -H 'Content-Type: application/json' \
  -d "{\"number\":\"$CNUM\",\"title\":\"Smoke Case\",\"type\":\"مدني\",\"clientId\":\"$CLIENT_ID\"}"
CASE_ID="$(jget id <<<"$BODY")"
{ [ "$HTTP" = "201" ] && [ -n "$CASE_ID" ]; } && ok "case created" || bad "case: HTTP $HTTP — $BODY"

req POST /api/sessions -H 'Content-Type: application/json' \
  -d "{\"caseId\":\"$CASE_ID\",\"date\":\"$(date -u -d '+7 days' +%F 2>/dev/null || date -u +%F)\",\"time\":\"09:30\",\"court\":\"محكمة صلح عمان\"}"
[ "$HTTP" = "201" ] && ok "session created" || bad "session: HTTP $HTTP — $BODY"

req POST /api/invoices -H 'Content-Type: application/json' \
  -d "{\"number\":\"INV-$CNUM\",\"amount\":500,\"clientId\":\"$CLIENT_ID\"}"
[ "$HTTP" = "201" ] && ok "invoice created" || bad "invoice: HTTP $HTTP — $BODY"

# ---- 4. document upload + e-signature -----------------------------------------------
req POST /api/documents/upload -F "file=@$TMPTXT" -F "caseId=$CASE_ID"
DOC_ID="$(jget id <<<"$BODY")"
{ { [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; } && [ -n "$DOC_ID" ]; } && ok "document uploaded" || bad "upload: HTTP $HTTP — $BODY"

if [ -n "$DOC_ID" ]; then
  req POST "/api/documents/$DOC_ID/sign" -F "signatureImage=@$PNG"
  { [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; } && ok "document e-signed" || bad "sign: HTTP $HTTP — $BODY"
fi

# ---- 5. AI: contract review + 2-turn assistant (through nginx) --------------------
ai_result() { # name http seconds
  local name="$1" http="$2" secs="$3"
  case "$http" in
    200) if [ "${secs%.*}" -gt "$AI_MAX_S" ]; then bad "$name: 200 but ${secs}s (> ${AI_MAX_S}s)"; else ok "$name: 200 in ${secs}s"; fi ;;
    502|504) bad "$name: HTTP $http after ${secs}s — nginx/upstream timeout or error" ;;
    503) if [ "$REQUIRE_AI" = "1" ]; then bad "$name: 503 (AI not configured; SMOKE_REQUIRE_AI=1)"; else warn "$name: 503 — AI not configured on this deploy, skipped"; fi ;;
    *)   bad "$name: unexpected HTTP $http after ${secs}s" ;;
  esac
}
timed_post() { # path json  -> echoes "<http> <secs>"
  local t0 t1 out; t0=$(date +%s)
  out="$(curl -sS -m "$((AI_MAX_S + 60))" -w $'\n%{http_code}' -b "$JAR" -X POST \
    -H 'Content-Type: application/json' -d "$2" "$BASE$1" 2>/dev/null)" || true
  t1=$(date +%s); AI_HTTP="${out##*$'\n'}"; AI_BODY="${out%$'\n'*}"; AI_SECS=$((t1 - t0))
}

if [ -n "$DOC_ID" ]; then
  timed_post /api/ai/contract-review "{\"documentId\":\"$DOC_ID\"}"
  ai_result "contract-review" "$AI_HTTP" "$AI_SECS"
fi

timed_post /api/ai/assistant '{"message":"ما هي مدة التقادم في الدعوى المدنية بشكل عام؟"}'
ai_result "assistant turn 1" "$AI_HTTP" "$AI_SECS"
A1_HTTP="$AI_HTTP"; A1_ANSWER="$(jget answer <<<"$AI_BODY" | head -c 80 | tr -d '"\\')"

if [ "$A1_HTTP" = "200" ]; then
  timed_post /api/ai/assistant "{\"message\":\"وهل تختلف هذه المدة في الدعاوى التجارية؟\",\"history\":[{\"role\":\"user\",\"content\":\"ما هي مدة التقادم في الدعوى المدنية؟\"},{\"role\":\"assistant\",\"content\":\"$A1_ANSWER\"}]}"
  ai_result "assistant turn 2 (follow-up)" "$AI_HTTP" "$AI_SECS"
fi

# ---- summary --------------------------------------------------------------------
echo
echo "smoke: $PASS passed, $WARN warned, $FAIL failed"
[ "$FAIL" -eq 0 ] || { echo "SMOKE FAILED"; exit 1; }
echo "SMOKE PASSED"
echo "(created a throwaway office '$EMAIL' — smoke offices accumulate; prune periodically by the smoke.invalid domain)"
