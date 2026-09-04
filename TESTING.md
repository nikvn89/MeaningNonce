# MeaningNonce — reviewer testing

## Frozen deployment

```text
Network: GenLayer StudioNet
Contract: 0x1A81177f32d22185F421F0019714DCB6e3124263
Contract source SHA-256 (repo): d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f
Main runtime case: fcbab56d34ba7520125cc205bf4b1ab392d20d5ac7b0827b32d7b63df5e6bc95
Role-guard case: 6f1bc3dcd447849d1aeed5ce9021c6df989792bbf3d6ac9955f38c028023595f
```

## A. Local actual-source gates — PASS in packaging environment

```bash
npm run check:contract
npm run test:logic
npm run test:adversarial
npm run test:fence
npm run test:mutations
python -m py_compile contracts/MeaningNonce.py
```

Observed:

```text
PASS AST contract invariants
PASS actual-contract off-chain logic: 15/15
PASS executable adversarial actual-contract suite: 12/12
PASS prompt-fence probe: 0/9 bypasses
caught mutations: 15/15
PASS Python compile
```

Evidence-strength rule: AST/grep/vector checks are **static only**. `test:logic` and `test:adversarial` execute the actual production contract source under a stub, but are still off-chain behavior rather than GenVM runtime proof.

## B. Exact-source GenVM / Direct Mode / frontend build — rerun before submission when required

Pinned Python tooling in `requirements.txt`:

```text
genlayer-test==0.29.2
genvm-linter==0.11.0
```

Use Python 3.12+ in the reviewer environment:

```bash
python -m pip install -r requirements.txt
npm run lint:genvm
npm run test:direct
npm install
npm run build
```

The packaging environment used here has Python 3.13 without those GenLayer packages installed, and its `npm install` package fetch timed out. Those exact-source gates are therefore **not claimed PASS here**.

## C. StudioNet runtime — PASS

Runtime sequence actually exercised on `0x1A81177f32d22185F421F0019714DCB6e3124263`:

1. Authority seeded rejected baseline A+B.
2. Requester reworded while reordering/duplicating A+B → `EXACT_REPLAY`, `model_called=false`.
3. Requester removed B → `BASELINE_REMOVAL_BLOCKED`; baseline remained A+B.
4. Irrelevant addition → `IMMATERIAL_DELTA`.
5. Same candidate, different request wording → `ALREADY_ADJUDICATED`, `model_called=false`, prior result `IMMATERIAL_DELTA`; model call count did not increase.
6. Material addition → `MATERIAL_DELTA`, status `AWAITING_FRESH_DECISION`.
7. Authority declined reopening → status returned to `LOCKED_REJECTED`; consumed model count was not refilled.
8. Another material addition reopened the case.
9. Authority tried to record a fresh decision with the wrong evidence set → rollback `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`.
10. Authority recorded fresh `REJECTED` with the exact reopened candidate → epoch 2, full candidate became new baseline, adjudication/model/grant counters reset.
11. Reword/reorder of the new epoch-2 baseline → `EXACT_REPLAY`, `model_called=false`.
12. New C-301 addition → `MATERIAL_DELTA`, `AWAITING_FRESH_DECISION`.
13. Authority recorded fresh `ACCEPTED` with exact candidate → `CLOSED_ACCEPTED`.
14. Requester retried after close → rollback `CASE_NOT_RETRYABLE`.
15. Separate role-guard case: authority tried to submit its own retry → rollback `AUTHORITY_CANNOT_SUBMIT_RETRY`; `attempt_count=0`, `model_calls_this_epoch=0`.

Machine-readable states and screenshots are under `runtime-evidence/`.

## D. Frontend production verification

The checked-in frontend defaults to `0x1A81177f32d22185F421F0019714DCB6e3124263`.

Before publishing the final Vercel evidence:

1. Run `npm install && npm run build` in a networked Node environment.
2. Deploy the repo to Vercel as a Vite project.
3. Open the deployed page and confirm the contract field defaults to `0x1A81177f32d22185F421F0019714DCB6e3124263`.
4. Connect a StudioNet wallet and use **Inspect** on the main case ID.
5. Confirm it reads `ACCEPTED / CLOSED_ACCEPTED` from finalized state.
6. Exercise one browser write on a fresh test case; do not claim success from `FINALIZED` alone—verify the method-specific postcondition.

## E. Steward-attack checklist

Before resubmission, verify all three mandatory anti-pattern gates:

- **Non-bypassable consequence:** audit cancel/decline/timeout/refund/close paths so no claimed consequence can be escaped by an early exit.
- **Immutability ≠ provenance:** never call self-declared/commit-pinned data canonical authority without an independent trust root.
- **Static evidence ≠ executable behavioral proof:** never present marker/vector/source checks as contract runtime tests.

MeaningNonce's runtime evidence above directly addresses the third gate; its README explicitly narrows the trust-root claim for the second.
