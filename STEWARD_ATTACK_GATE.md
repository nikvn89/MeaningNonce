# MeaningNonce — Steward Attack Gate

This file applies the repository-wide lessons learned from prior GenLayer steward reviews to the frozen MeaningNonce StudioNet deployment and final submission package.

## Gate A — non-bypassable consequences / escape paths

MeaningNonce does **not** claim an economic penalty, notice bond, or compensation consequence, so there is no monetary "non-bypassable" claim to make.

The relevant escape paths are still audited:

- `grant_retry_budget` is authority-only;
- it resets only the distinct-candidate call counter;
- it never clears the adjudicated-set ledger;
- at most five budget grants are allowed per epoch, bounding growth of the embedded adjudication ledger;
- therefore the same evidence set cannot buy a second semantic roll through the budget escape;
- `decline_reopening` returns to the prior baseline but also leaves the material candidate adjudicated;
- therefore decline cannot be used to reroll the same candidate;
- `record_fresh_decision(..., "REJECTED", ...)` is the only path that starts a new epoch and clears the ledger, and it is evidence-bound to the pending material attempt.

Known liveness limitation: `submit_retry` is permissionless, so a third-party wallet can consume a case's current three-call budget window. This is not hidden or described as prevented. The authority is the explicit recovery actor through `grant_retry_budget`, and per-requester counters are not used because fresh wallets would reopen unbounded grinding.

Adversarial requirement: disable any one of the ledger persistence, decline no-refill, fresh-rejection reset, grant-cap, role, or fence guards and at least one executable test must fail.

## Gate B — immutability is not provenance

MeaningNonce makes no canonical-publisher or external-fact provenance claim.

The wallet that calls `seed_rejected_case` is the **contract-local decision authority** for that `(authority, case_ref)` namespace. The contract does not prove that this wallet is a canonical external-world judge, publisher, service, or institution.

Two different authority wallets using the same `case_ref` intentionally create different case IDs. That proves namespace separation only, not real-world independence or provenance.

Honest limitation: distinct addresses do not prove distinct real-world control.

## Gate C — static evidence is not executable behavioral proof

The repository labels evidence by strength:

- `scripts/check_contract_ast.py` — STATIC source/AST gate only.
- `scripts/test_contract_logic.py` — EXECUTABLE off-chain behavioral test that loads and runs the actual `contracts/MeaningNonce.py` source under a minimal GenLayer stub.
- `npm run test:adversarial` — EXECUTABLE adversarial subset of the same actual-source harness.
- `scripts/mutation_matrix.py` — mutation-quality gate over the actual source.
- `pytest tests/direct/ -v` — official GenLayer Direct Mode execution; repository-executable evidence that must be rerun before submission when required by the steward.
- StudioNet runtime — real network behavioral evidence; completed for the frozen deployment and recorded under `runtime-evidence/`.

No grep, marker, vector-file, AST, or documentation check may be described as runtime proof.

## Gate D — prompt-boundary injection

The semantic prompt uses a fixed-point, bounded sanitizer for MeaningNonce's own `<UNTRUSTED_EVIDENCE>` delimiter. Nested case/whitespace variants must not reconstruct a live fence token. `scripts/fence_probe.py` and Direct Mode reviewer test A1 exercise that attack.

## Gate E — transaction finalization is not execution success

The frontend never equates `FINALIZED` with contract success.

- pre-submission wallet/signing/RPC failures are surfaced as infrastructure/submission errors;
- if the runtime publishes `txExecutionResultName`, a value other than `FINISHED_WITH_RETURN` is treated as execution failure;
- when Studio does not publish that enum, each UI write verifies an explicit finalized contract-state postcondition before displaying success.

## Gate F — literal role collapse

The decision-authority address cannot submit retries against its own case. This preserves a minimum on-chain role boundary. The repository does not claim that two different addresses necessarily belong to different real-world parties.

## Required submission result

The frozen StudioNet runtime path is complete. Before resubmission, do not overclaim any unexecuted repository gate: rerun official Direct Mode, GenVM lint/typecheck, and the frontend production build in a compatible networked environment, and retain an exact-source independent review artifact if the steward requires it. Static checks may never be substituted for those executable gates.
