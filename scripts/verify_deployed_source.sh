#!/usr/bin/env bash
set -euo pipefail

RPC='https://studio.genlayer.com/api'
ADDR='0x1A81177f32d22185F421F0019714DCB6e3124263'
EXPECTED_LF='d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f'
EXPECTED_CRLF='b550a8a2afe70b94151e86243fd92912e5f91d31dd82b59e621cb01685c3baab'
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

post() {
  local payload="$1"
  curl -fsS -X POST "$RPC" -H 'Content-Type: application/json' -d "$payload" > "$TMP"
}

ok_result() {
  python3 - "$TMP" <<'PY'
import json,sys
try:
    o=json.load(open(sys.argv[1],encoding='utf-8'))
except Exception:
    raise SystemExit(1)
if o.get('error') or o.get('result') in (None, '', {}):
    raise SystemExit(1)
raise SystemExit(0)
PY
}

echo "MeaningNonce deployed-source parity check (newline-aware)"
echo "RPC:      $RPC"
echo "Contract: $ADDR"
echo

PAYLOAD1="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"gen_getContractCode\",\"params\":[\"$ADDR\"]}"
PAYLOAD2="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"gen_getContractCode\",\"params\":[\"$ADDR\",\"finalized\"]}"
PAYLOAD3="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"gen_getContractCode\",\"params\":[{\"address\":\"$ADDR\",\"status\":\"finalized\"}]}"

if post "$PAYLOAD1" && ok_result; then
  MODE='legacy address-only'
elif post "$PAYLOAD2" && ok_result; then
  MODE='legacy address + finalized'
elif post "$PAYLOAD3" && ok_result; then
  MODE='documented request object'
else
  echo 'RPC did not return contract code.'
  cat "$TMP"; echo
  exit 2
fi

echo "RPC request mode: $MODE"

python3 - "$TMP" "$EXPECTED_LF" "$EXPECTED_CRLF" <<'PY'
import base64, hashlib, json, sys
path, expected_lf, expected_crlf = sys.argv[1:]
obj = json.load(open(path, 'r', encoding='utf-8'))
if obj.get('error'):
    raise SystemExit(f"RPC error: {obj['error']}")
r = obj.get('result')
if isinstance(r, dict):
    for k in ('code','source','contractCode'):
        if r.get(k):
            r = r[k]
            break
if not isinstance(r, str) or not r:
    raise SystemExit(f'Unexpected RPC result: {r!r}')

if r.startswith('0x'):
    b = bytes.fromhex(r[2:])
else:
    try:
        b = base64.b64decode(r, validate=True)
        if not b:
            raise ValueError('empty payload')
    except Exception:
        b = r.encode('utf-8')

raw = hashlib.sha256(b).hexdigest()
normalized = b.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
norm = hashlib.sha256(normalized).hexdigest()

print('Deployed bytes:            ', len(b))
print('Raw deployed SHA256:       ', raw)
print('Expected CRLF SHA256:      ', expected_crlf)
print('Normalized deployed bytes: ', len(normalized))
print('Normalized deployed SHA256:', norm)
print('Expected LF source SHA256: ', expected_lf)
print()

if raw == expected_crlf and norm == expected_lf:
    print('SOURCE PARITY PROVEN — exact source text; deployed copy uses CRLF line endings.')
elif norm == expected_lf:
    print('SOURCE PARITY PROVEN — source matches after newline normalization.')
else:
    raise SystemExit('SOURCE PARITY MISMATCH — substantive source difference remains.')
PY
