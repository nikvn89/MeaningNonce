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
pytest tests/direct/ -q: 19 passed
```

The packaging environment itself did not have those GenLayer Python packages installed, so it does not claim to reproduce those commands locally. A dependency-installed local `npm run build` was also not rerun there; Vercel is the production build surface.

Reproduction commands:

```bash
python -m pip install -r requirements.txt
npm run lint:genvm
npm run test:direct
npm install
npm run build
```

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

## F. Security review checklist

The project is evaluated against three recurring failure modes:

- **Non-bypassable consequence:** audit decline/close and related escape paths so a claimed consequence cannot be escaped by an early exit.
- **Immutability ≠ provenance:** never call self-declared/commit-pinned data canonical authority without an independent trust root.
- **Static evidence ≠ executable behavioral proof:** never present marker/vector/source checks as contract runtime tests.

MeaningNonce's StudioNet evidence addresses executable behavior; its README explicitly narrows the trust-root claim. The anti-reroll ledger/budget claims are scoped to **committed** consensus rounds; a no-majority round reverts and persists neither ledger nor budget state.
