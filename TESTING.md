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
caught mutations: 17/17
PASS Python compile
```

Evidence-strength rule: AST/grep/vector checks are **static only**. `test:logic` and `test:adversarial` execute the actual production contract source under a stub, but are still off-chain behavior rather than GenVM runtime execution.

## B. Exact-source GenVM / Direct Mode path

Pinned Python tooling remains in `requirements.txt`. Recorded exact-source results for the frozen contract SHA are:

```text
genvm-lint check / validation: PASS
genvm-lint typecheck: PASS
```

Re-executed on a machine with `requirements.txt` installed, against the same frozen contract SHA:

```text
python -m genvm_linter.cli lint contracts/MeaningNonce.py   ->  Lint passed (3 checks), rc 0
pytest tests/direct/                                        ->  23 passed
npm run build                                               ->  clean
```

`tests/direct/conftest.py` pins the GenVM build (`v0.2.12`, overridable with
`GENVM_VERSION`). Without it, `direct_deploy` resolves "latest" at run time, so a
clean machine executes a runtime this contract was never verified against — and
a withdrawn release returns 404 instead of a test result.

The 23 are the 19 behavioural and adversarial tests plus four that execute the
project's own limits rather than only its guarantees:

```text
tests/direct/test_liveness_bounds.py
  test_a_third_party_can_lock_a_case_permanently
  test_one_wide_material_delta_can_brick_the_case
tests/direct/test_recovery_probe.py
  test_authority_can_reseed_under_a_new_reference_after_a_brick
  test_reseeding_does_not_launder_a_closed_acceptance
```

The first two drive a `case_id` into a state from which no caller can reopen it —
by exhausting the semantic budget past the grant cap, and by saturating the
evidence baseline. The second two show the recovery path (`LOCKED_SPEC` #23) and
show that it is not a laundering route. These bounds are stated in
`LOCKED_SPEC.md` #21, #24 and #25 and in the README honest-scope section; the
tests are what make those statements checkable rather than assertions.

Reproduction commands:

```bash
python -m pip install -r requirements.txt
python -m genvm_linter.cli lint contracts/MeaningNonce.py
npm run test:direct
npm install
npm run build
```

`npm run lint:genvm` additionally runs `genvm-lint check`, which resolves the SDK
over the network and therefore needs outbound access; `lint` is the offline
AST-only pass and is the one that gates on source alone.

## B2. Repository integrity

```bash
sha256sum -c FINAL_CHECKSUMS.txt
```

Every tracked file, 53 of 53, including `contracts/MeaningNonce.py` at the frozen
SHA. A mismatch anywhere means the package is not the reviewed one.

## C. Deployed-source parity — PASS

Repository check:

```bash
bash scripts/verify_deployed_source.sh
```

Observed on 2026-09-05:

```text
Raw deployed SHA256:        b550a8a2afe70b94151e86243fd92912e5f91d31dd82b59e621cb01685c3baab
Expected CRLF SHA256:       b550a8a2afe70b94151e86243fd92912e5f91d31dd82b59e621cb01685c3baab
Normalized deployed SHA256: d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f
Expected LF source SHA256:  d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f
SOURCE PARITY PROVEN
```

StudioNet returned the same source text with CRLF line endings; normalizing line endings gives the exact frozen repository hash. Screenshot: `runtime-evidence/screenshots/08_source_parity_proven.png`.

## D. StudioNet runtime — PASS

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

## E. Frontend verification path

The checked-in frontend defaults to `0x1A81177f32d22185F421F0019714DCB6e3124263`.

Production URL: `https://meaning-nonce.vercel.app`

Expected submission-facing behavior:

1. Overview, Seed Case, Submit Retry, Resolve, Inspect Cases, and Verification are separate navigation surfaces.
2. Seed Case opens with empty case reference, rejection reason, and baseline evidence fields.
3. Submit Retry opens with empty case ID/request fields and does not preload candidate evidence before a finalized case is loaded.
4. Resolve opens with no preselected decision or prefilled reason/evidence; decision controls appear only from loaded case state.
5. Inspect Cases starts empty but exposes verified runtime case shortcuts separately from the input form.
6. Verification presents executed StudioNet outcomes and deployment links without preloading transaction forms.
7. The Semantic Boundary Scan is UI-only explanatory motion: it does not reveal a verdict until the finalized attempt is read back after the write.

A dependency-installed local `npm run build` is not claimed as reproduced in the packaging environment where package installation was unavailable.


### E2. Live dApp runtime evidence

A complete reviewer-facing runtime walkthrough was executed through the production
dApp at `https://meaning-nonce.vercel.app` against the frozen StudioNet deployment.
These screenshots complement the deeper StudioNet evidence in `runtime-evidence/screenshots/`;
they do not replace the rollback, role-guard, or source-parity proofs recorded there.

Captured checkpoints:

1. `LOCKED_REJECTED` baseline with zero attempts and zero semantic model calls.
2. `EXACT_REPLAY` with `model_called=false`.
3. `IMMATERIAL_DELTA` with `model_called=true`.
4. `ALREADY_ADJUDICATED` with `model_called=false`; the semantic-call counter does not increase.
5. `MATERIAL_DELTA` -> `AWAITING_FRESH_DECISION`, with two semantic model calls used in the epoch.
6. The decision authority loads the bound candidate evidence and records fresh `ACCEPTED`.
7. Final `CLOSED_ACCEPTED` state with 4 attempts and 2/3 semantic model calls.

Reviewer-facing screenshots:

```text
runtime-evidence/dapp-screenshots/01_baseline_LOCKED_REJECTED.png
runtime-evidence/dapp-screenshots/02_EXACT_REPLAY_model_false.png
runtime-evidence/dapp-screenshots/03_IMMATERIAL_DELTA_model_true.png
runtime-evidence/dapp-screenshots/04_ALREADY_ADJUDICATED_model_false.png
runtime-evidence/dapp-screenshots/05_MATERIAL_DELTA_AWAITING_FRESH_DECISION.png
runtime-evidence/dapp-screenshots/06_Authority_ACCEPTED_bound_evidence.png
runtime-evidence/dapp-screenshots/07_FINAL_CLOSED_ACCEPTED.png
```

## F. Security review checklist

The project is evaluated against three recurring failure modes:

- **Non-bypassable consequence:** audit decline/close and related escape paths so a claimed consequence cannot be escaped by an early exit.
- **Immutability ≠ provenance:** never call self-declared/commit-pinned data canonical authority without an independent trust root.
- **Static evidence ≠ executable behavioral proof:** never present marker/vector/source checks as contract runtime tests.

MeaningNonce's StudioNet evidence addresses executable behavior; its README explicitly narrows the trust-root claim. The anti-reroll ledger/budget claims are scoped to **committed** consensus rounds; a no-majority round reverts and persists neither ledger nor budget state.
