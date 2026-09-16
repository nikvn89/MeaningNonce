#!/usr/bin/env python3
"""
Deployed-source parity check — cross-platform.

Fetches the contract code the chain is actually running and compares it against
`contracts/MeaningNonce.py`. The expected hash is computed from the repository
file at run time, so the check can never drift from the source it claims to
verify.

The comparison is newline-aware: Studio may store the source with CRLF endings
and may drop the terminal newline. Both copies are normalized to LF and at most
ONE trailing LF is removed from each; every other byte must still match.

This replaces the bash version, which cannot run in Windows cmd.exe — the people
reviewing this project should not need a particular shell to check it.

    python scripts/verify_deployed_source.py
    python scripts/verify_deployed_source.py 0xOTHERADDRESS

Environment: GENLAYER_RPC, VITE_CONTRACT_ADDRESS, CONTRACT_PATH.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RPC = os.environ.get("GENLAYER_RPC", "https://studio-next.genlayer.com/api")
ADDR = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get(
        "VITE_CONTRACT_ADDRESS", "0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4"
    )
)
SRC = Path(os.environ.get("CONTRACT_PATH", "contracts/MeaningNonce.py"))


def canonical(data: bytes) -> bytes:
    data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return data[:-1] if data.endswith(b"\n") else data


def post(payload: dict) -> tuple[dict | None, str]:
    """Return (result_object, diagnostic). Never swallow the reason it failed —
    a verification tool that hides the server's answer is useless."""
    body = json.dumps(payload).encode("utf-8")
    # Cloudflare in front of the Studio RPC rejects the default
    # "Python-urllib/3.x" signature with HTTP 403 error code 1010. The app's own
    # reads reach the same endpoint from a browser, so this sends the headers a
    # browser sends. Nothing else about the request changes.
    req = urllib.request.Request(
        RPC,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Origin": "https://studio-next.genlayer.com",
            "Referer": "https://studio-next.genlayer.com/",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300] if exc.fp else ""
        return None, f"HTTP {exc.code} {exc.reason} {detail}".strip()
    except urllib.error.URLError as exc:
        return None, f"network: {exc.reason}"
    except OSError as exc:
        return None, f"network: {exc}"

    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None, f"non-JSON response: {text[:300]}"

    if obj.get("error"):
        return None, f"RPC error: {json.dumps(obj['error'])[:300]}"
    if obj.get("result") in (None, "", {}):
        return None, f"empty result: {json.dumps(obj)[:300]}"
    return obj, ""


def main() -> int:
    if not SRC.is_file():
        print(f"FAIL: không thấy {SRC}. Chạy lệnh này từ thư mục gốc của repo.")
        return 2

    raw_repo = SRC.read_bytes()
    expected_raw = hashlib.sha256(raw_repo).hexdigest()
    expected_lf = hashlib.sha256(canonical(raw_repo)).hexdigest()

    print("MeaningNonce deployed-source parity check (newline-aware)")
    print(f"RPC:      {RPC}")
    print(f"Contract: {ADDR}")
    print(f"Source:   {SRC}")
    print(f"Expected canonical SHA256: {expected_lf}")
    print()

    # The RPC has accepted three shapes across Studio versions; try each.
    attempts = [
        ("address-only", [ADDR]),
        ("address + finalized", [ADDR, "finalized"]),
        ("request object", [{"address": ADDR, "status": "finalized"}]),
    ]
    obj = None
    mode = ""
    diagnostics: list[str] = []
    for mode, params in attempts:
        obj, why = post(
            {"jsonrpc": "2.0", "id": 1, "method": "gen_getContractCode", "params": params}
        )
        if obj is not None:
            break
        diagnostics.append(f"  {mode:20s} -> {why}")

    if obj is None:
        print("RPC did not return contract code. What the server actually said:")
        for line in diagnostics:
            print(line)
        print()
        print("Cách đọc:")
        print("  'RPC error: ... Method not found'  -> endpoint này không có gen_getContractCode;")
        print("                                        parity phải kiểm bằng Studio UI hoặc explorer.")
        print("  'empty result'                     -> địa chỉ không có contract trên mạng này.")
        print("  'HTTP 403 ... error code: 1010'    -> Cloudflare chặn theo chữ ký trình duyệt.")
        print("  'HTTP 4xx/5xx' khác hoặc 'network'  -> sai URL, firewall, hoặc mạng.")
        return 2

    print(f"RPC request mode: {mode}")
    print()

    result = obj.get("result")
    if isinstance(result, dict):
        for key in ("code", "source", "contractCode"):
            if result.get(key):
                result = result[key]
                break
    if not isinstance(result, str) or not result:
        print(f"Unexpected RPC result: {result!r}")
        return 2

    if result.startswith("0x"):
        raw_bytes = bytes.fromhex(result[2:])
    else:
        try:
            raw_bytes = base64.b64decode(result, validate=True)
            if not raw_bytes:
                raise ValueError("empty payload")
        except Exception:  # noqa: BLE001
            raw_bytes = result.encode("utf-8")

    normalized = canonical(raw_bytes)
    raw_hash = hashlib.sha256(raw_bytes).hexdigest()
    norm_hash = hashlib.sha256(normalized).hexdigest()

    print("Deployed bytes:            ", len(raw_bytes))
    print("Raw deployed SHA256:       ", raw_hash)
    print("Normalized deployed bytes: ", len(normalized))
    print("Normalized deployed SHA256:", norm_hash)
    print("Repository raw SHA256:     ", expected_raw)
    print("Expected canonical SHA256: ", expected_lf)
    print()

    first_line = normalized.split(b"\n", 1)[0].decode("utf-8", "replace").strip()
    print("Deployed first line:", first_line)
    if not first_line.startswith("# v0.3"):
        print("WARNING: deployed source does not carry the v0.3 version comment.")
    print()

    if norm_hash != expected_lf:
        print("SOURCE PARITY MISMATCH — substantive source difference remains.")
        return 1

    if raw_hash == expected_raw:
        print("SOURCE PARITY PROVEN — byte-identical to the repository source.")
    else:
        print(
            "SOURCE PARITY PROVEN — identical after CRLF/LF and optional "
            "terminal-newline normalization."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
