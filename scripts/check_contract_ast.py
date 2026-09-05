#!/usr/bin/env python3
"""AST invariant gate for the actual production contract source."""
import ast
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = Path(os.environ.get("MEANINGNONCE_CONTRACT_PATH", ROOT / "contracts" / "MeaningNonce.py"))
src = PATH.read_text(encoding="utf-8")
tree = ast.parse(src)
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "MeaningNonce")
funcs = {n.name: n for n in cls.body if isinstance(n, ast.FunctionDef)}

required = {
    "_case_id_for", "_canonicalize_evidence", "_semantic_materiality",
    "seed_rejected_case", "submit_retry", "grant_retry_budget",
    "decline_reopening", "record_fresh_decision",
}
assert required <= funcs.keys(), f"missing functions: {sorted(required - funcs.keys())}"


def text(node):
    return ast.unparse(node)


def exact_if(fn, wanted):
    return any(isinstance(n, ast.If) and text(n.test) == wanted for n in ast.walk(fn))

# Core authorization and deterministic partitions.
assert exact_if(funcs["submit_retry"], "case_data['status'] != self.STATUS_LOCKED_REJECTED")
assert exact_if(funcs["submit_retry"], "Address(case_data['authority']) == gl.message.sender_address")
assert exact_if(funcs["submit_retry"], "baseline_hash not in candidate_hashes")
assert exact_if(funcs["submit_retry"], "h not in baseline_hashes")
assert exact_if(funcs["submit_retry"], "candidate_key in adjudicated")
assert exact_if(funcs["submit_retry"], "calls_used >= self.MAX_MODEL_CALLS_PER_EPOCH")
assert exact_if(funcs["record_fresh_decision"], "Address(case_data['authority']) != gl.message.sender_address")
assert exact_if(funcs["record_fresh_decision"], "evidence_hashes != pending_attempt['candidate_hashes']")
assert exact_if(funcs["grant_retry_budget"], "Address(case_data['authority']) != gl.message.sender_address")
assert exact_if(funcs["grant_retry_budget"], "grants_used >= self.MAX_BUDGET_GRANTS_PER_EPOCH")
assert exact_if(funcs["decline_reopening"], "Address(case_data['authority']) != gl.message.sender_address")

# Case identity cannot depend on requester/wallet state.
case_id_text = text(funcs["_case_id_for"])
assert "gl.message.sender_address" not in case_id_text
assert "authority.as_bytes" in case_id_text and "case_ref.encode" in case_id_text

# Prompt boundary sanitation must be case/whitespace tolerant and fixed-point bounded.
fence_text = text(funcs["_strip_prompt_fence_tokens"])
assert "re.sub" in fence_text and "IGNORECASE" in fence_text
assert "untrusted_evidence" in fence_text.lower()
assert "\\s*" in fence_text, "fence pattern must tolerate whitespace inside the tag"
assert "for _ in range(8)" in fence_text
assert "stripped == cleaned" in fence_text
assert "'[<>]'" in fence_text or '"[<>]"' in fence_text

# Request wording cannot enter semantic materiality or the semantic call arguments.
semantic = funcs["_semantic_materiality"]
assert [a.arg for a in semantic.args.args] == ["self", "rejection_reason", "baseline_evidence_json", "additions_json"]
submit = funcs["submit_retry"]
semantic_calls = [n for n in ast.walk(submit) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "_semantic_materiality"]
assert len(semantic_calls) == 1
assert all("request" not in text(arg).lower() for arg in semantic_calls[0].args)

# Nondeterminism shape: exec_prompt must live inside leader_fn so genvm-lint can
# prove reachability from run_nondet_unsafe; validator reruns that same leader.
leader = None
validator = None
for n in semantic.body:
    if isinstance(n, ast.FunctionDef) and n.name == "leader_fn":
        leader = n
    if isinstance(n, ast.FunctionDef) and n.name == "validator_fn":
        validator = n
assert leader is not None and validator is not None
leader_text = text(leader)
validator_text = text(validator)
assert "gl.nondet.exec_prompt" in leader_text
assert "leader_fn()" in validator_text
assert "classify_once" not in text(semantic)
assert validator.body and isinstance(validator.body[0], ast.If), "validator must fail closed before any success return"
assert "not isinstance(leaders_res, gl.vm.Return)" == text(validator.body[0].test)
assert "validator_decision == leader_decision" in validator_text
assert not (isinstance(validator.body[0], ast.Return) and isinstance(validator.body[0].value, ast.Constant) and validator.body[0].value.value is True)

# No second JS canonicalizer/oracle is allowed to exist.
assert not (ROOT / "scripts" / "reference_model.mjs").exists()

print("PASS AST contract invariants")
