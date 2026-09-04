#!/usr/bin/env python3
"""Mutation check: every listed semantic/security defect must break a real gate."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "contracts" / "MeaningNonce.py"
orig = SRC.read_text(encoding="utf-8")

MUTS = [
    ("M1 validator neutered",
     "        def validator_fn(leaders_res) -> bool:\n            if not isinstance(leaders_res, gl.vm.Return):",
     "        def validator_fn(leaders_res) -> bool:\n            return True  # MUTANT\n            if not isinstance(leaders_res, gl.vm.Return):"),
    ("M2 authority check inverted",
     'if Address(case_data["authority"]) != gl.message.sender_address:',
     'if Address(case_data["authority"]) == gl.message.sender_address:'),
    ("M3 removal detection disabled",
     "            if baseline_hash not in candidate_hashes:\n                removal_detected = True",
     "            if False and baseline_hash not in candidate_hashes:\n                removal_detected = True"),
    ("M4 additions inverted",
     "                if h not in baseline_hashes:\n                    additions.append(candidate_items[i])",
     "                if h in baseline_hashes:\n                    additions.append(candidate_items[i])"),
    ("M5 case_id includes requester",
     'payload = authority.as_bytes + case_ref.encode("utf-8")',
     'payload = authority.as_bytes + case_ref.encode("utf-8") + gl.message.sender_address.as_bytes'),
    ("M6 retry allowed while pending",
     'if case_data["status"] != self.STATUS_LOCKED_REJECTED:',
     'if case_data["status"] == "__NEVER__":'),
    ("M7 evidence binding removed",
     'if evidence_hashes != pending_attempt["candidate_hashes"]:',
     'if False and evidence_hashes != pending_attempt["candidate_hashes"]:'),
    ("M8 request wording enters semantic call",
     'case_data["decision_reason"],\n                json.dumps(case_data["baseline_evidence"]',
     'request_clean,\n                json.dumps(case_data["baseline_evidence"]'),
    ("M9 authority self-retry guard removed",
     'if Address(case_data["authority"]) == gl.message.sender_address:\n            # Preserve a literal role boundary',
     'if False and Address(case_data["authority"]) == gl.message.sender_address:\n            # Preserve a literal role boundary'),
    ("M10 prompt fence fixed-point reduced to one pass",
     "        for _ in range(8):",
     "        for _ in range(1):"),
    ("M11 validator stops rerunning leader",
     "                validator_decision = leader_fn()",
     "                validator_decision = material"),
    ("M12 budget grant wipes adjudicated ledger",
     '        case_data["model_calls_this_epoch"] = 0\n        case_data["budget_grants_this_epoch"] = grants_used + 1',
     '        case_data["model_calls_this_epoch"] = 0\n        case_data["adjudicated"] = {}\n        case_data["budget_grants_this_epoch"] = grants_used + 1'),
    ("M13 decline refills semantic-call budget",
     '        case_data["pending_attempt_id"] = ""\n        case_data["last_decline_note"] = reason',
     '        case_data["pending_attempt_id"] = ""\n        case_data["model_calls_this_epoch"] = 0\n        case_data["last_decline_note"] = reason'),
    ("M14 budget-grant cap off by one",
     "        if grants_used >= self.MAX_BUDGET_GRANTS_PER_EPOCH:",
     "        if grants_used > self.MAX_BUDGET_GRANTS_PER_EPOCH:"),
    ("M15 fresh rejected forgets grant-cap reset",
     '            case_data["model_calls_this_epoch"] = 0\n            case_data["budget_grants_this_epoch"] = 0',
     '            case_data["model_calls_this_epoch"] = 0'),
]

rows = []
for name, old, new in MUTS:
    if old not in orig:
        raise SystemExit(f"mutation anchor missing: {name}")
    mutated = orig.replace(old, new, 1)
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(mutated)
        temp = f.name
    env = os.environ.copy()
    env["MEANINGNONCE_CONTRACT_PATH"] = temp
    runs = []
    for cmd in (
        [sys.executable, str(ROOT / "scripts" / "check_contract_ast.py")],
        [sys.executable, str(ROOT / "scripts" / "test_contract_logic.py")],
        [sys.executable, str(ROOT / "scripts" / "test_contract_logic.py"), "--suite", "adversarial"],
    ):
        runs.append(subprocess.run(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode)
    caught = any(code != 0 for code in runs)
    rows.append((name, *runs, caught))
    Path(temp).unlink(missing_ok=True)

print(f"{'mutation':<48} {'AST':>5} {'logic':>7} {'advers':>7} {'caught':>8}")
print("-" * 82)
for name, a, b, c, caught in rows:
    fmt = lambda x: "PASS" if x == 0 else "FAIL"
    print(f"{name:<48} {fmt(a):>5} {fmt(b):>7} {fmt(c):>7} {str(caught):>8}")
caught_n = sum(1 for *_, caught in rows if caught)
print("-" * 82)
print(f"caught mutations: {caught_n}/{len(rows)}")
if caught_n != len(rows):
    raise SystemExit(1)
