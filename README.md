# MeaningNonce

<img src="public/logo.png" alt="MeaningNonce logo" width="112" />

**Semantic anti-verdict-shopping for AI-agent retries on GenLayer.**

> Traditional nonces stop exact transaction replay. MeaningNonce stops a rejected request from buying another semantic roll merely by changing its wording when the evidence is unchanged or the same evidence set has already been adjudicated.

## StudioNet deployment

- Contract: `0x1A81177f32d22185F421F0019714DCB6e3124263`
- Explorer: `https://explorer-studio.genlayer.com/address/0x1A81177f32d22185F421F0019714DCB6e3124263`
- Frozen repository contract SHA-256: `d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f`
- Live dApp: `https://meaning-nonce.vercel.app`
- Runtime verification: [`runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md`](./runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md)

## Core behavior

A decision authority seeds a previously rejected case with a case reference, rejection reason, and evidence baseline. Any non-authority wallet may submit a retry against that same contract-local case.

- Same normalized evidence → `EXACT_REPLAY`, no model call.
- Candidate removes baseline evidence → `BASELINE_REMOVAL_BLOCKED`, no model call and baseline does not shrink.
- Same already-adjudicated candidate set → `ALREADY_ADJUDICATED`, no second semantic roll.
- At most three distinct semantic candidates per budget window; exhaustion → `RETRY_BUDGET_EXHAUSTED` without a model call.
- Only explicit additions reach GenLayer's bounded materiality question.
- `IMMATERIAL_DELTA` keeps the case locked.
- `MATERIAL_DELTA` opens `AWAITING_FRESH_DECISION`; it does **not** decide the merits.
- Only the authority may decline a reopening, grant more bounded budget, or record the fresh upstream `REJECTED` / `ACCEPTED` decision.
- Fresh `REJECTED` installs the full reopened candidate as the new baseline and opens a new epoch.
- Fresh `ACCEPTED` closes the case as `CLOSED_ACCEPTED`.
- The authority cannot submit retries against its own case.

Request wording is recorded for audit but excluded from the semantic materiality prompt and from the deterministic evidence-set key.

## Why GenLayer is load-bearing

Deterministic code can canonicalize evidence, detect exact replay/removal, remember adjudicated candidate sets, enforce roles, and bound retry grinding. It cannot decide whether a genuinely new natural-language evidence delta is materially relevant to reopening the recorded rejection. GenLayer is used only for that narrow classification.

## Explicit trust root / honest scope

The wallet that seeds a case is only the **contract-local decision authority** for that `(authority, case_ref)` namespace. MeaningNonce does not prove that the wallet is a canonical external-world institution, does not prove supplied evidence is true, and does not claim provenance merely because data is immutable. Evidence strings remain assertions supplied to the contract.

MeaningNonce also does not claim perfect semantic deduplication. A paraphrased evidence item can hash differently and consume a bounded semantic slot, and a third party can consume a budget window before a legitimate requester.

Authority budget restoration is the recovery path, and it has a floor worth stating plainly. Grants are capped at five per epoch, and the epoch counter resets in exactly one place — a fresh `REJECTED` decision, which requires a pending `MATERIAL_DELTA`, which requires a semantic call. So the reset that restores the budget sits behind the budget it would restore: eighteen spam retries from any wallet drive a `case_id` to a state where **nobody, authority included, can reopen it again**. The same terminal state is reachable a second way, because the baseline only ever grows and a retry must carry all of it — a baseline holding `MAX_EVIDENCE_ITEMS` items refuses every possible future retry in canonicalisation.

Neither is a lost decision. Case identity is `authority + case_ref`, so the authority re-seeds the same rejection under a new reference and retries resume; it is a griefing tax per reference, not permanent denial, and it is not a laundering route, because re-seeding is authority-only and the authority is the party the lock protects. Both bounds and the recovery path ship as executable tests: `tests/direct/test_liveness_bounds.py` and `tests/direct/test_recovery_probe.py`.

## Runtime result

The StudioNet run exercised the load-bearing paths, including:

```text
EXACT_REPLAY -> model_called=false
BASELINE_REMOVAL_BLOCKED -> model_called=false, baseline unchanged
IMMATERIAL_DELTA -> same candidate reword -> ALREADY_ADJUDICATED, no reroll
MATERIAL_DELTA -> AWAITING_FRESH_DECISION
evidence mismatch -> DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT
fresh REJECTED -> epoch reset + full new baseline
fresh ACCEPTED -> CLOSED_ACCEPTED
retry after close -> CASE_NOT_RETRYABLE
authority self-retry -> AUTHORITY_CANNOT_SUBMIT_RETRY, no attempt/model call
```

Main case finished `ACCEPTED / CLOSED_ACCEPTED` at epoch 2. See the runtime evidence document for exact case IDs and snapshots.

## Repository-executable gates

```bash
npm run check:contract
npm run test:logic
npm run test:adversarial
npm run test:fence
npm run test:mutations
npm run lint:genvm
npm run test:direct
npm run build
```

Recorded packaging-environment results:

```text
PASS AST contract invariants
PASS actual-contract off-chain logic: 15/15
PASS executable adversarial actual-contract suite: 12/12
PASS prompt-fence probe: 0/9 bypasses
caught mutations: 17/17
PASS Python compile
```

In an environment with the pinned dependencies installed, the exact-source gates
also pass: `genvm_linter.cli lint` exits 0 on three checks, and
`pytest tests/direct/` runs 23 tests on a real GenVM build — the 19 behavioural
and adversarial tests plus four that prove the project's own limits
(`test_liveness_bounds.py`, `test_recovery_probe.py`). `tests/direct/conftest.py`
pins the GenVM version so a clean machine executes the same runtime rather than
resolving "latest".

The original packaging environment had no `genvm-linter` / `genlayer-test` and its `npm install` timed out, which is why the two result blocks above are reported separately rather than merged: the first is what that environment executed, the second is what a machine with `requirements.txt` installed executes. Neither is a source-marker assertion. Exact commands are in `TESTING.md`.

## Frontend

The dApp is stamped to the runtime-tested StudioNet deployment by default. `VITE_CONTRACT_ADDRESS` remains an optional override.

The interface is organized as a Web3 protocol workspace with persistent navigation, connected-contract context, clear status panels, and dedicated Seed / Retry / Resolve / Inspect / Verification surfaces. **Action forms are empty by default**: no runtime case, rejection reason, request text, evidence set, or decision is prefilled. Runtime reference cases are isolated to inspection and verification surfaces so reviewers can inspect executed behavior without turning transaction forms into a scripted demo.

The Submit Retry page includes the signature **Semantic Boundary Scan**: wording visibly exits the decision boundary, the loaded baseline locks in place, candidate evidence is scanned, and the outcome is revealed only after the finalized attempt is read back from StudioNet. It is explanatory motion, not a simulated verdict.

The client does not treat `FINALIZED` alone as successful execution.

In practice the postcondition is the whole check, and that is deliberate. `receipt.txExecutionResultName` is set only by `decodeTransaction` in genlayer-js 1.1.8, while `waitForTransactionReceipt` routes a chain with `isStudio` through `decodeLocalnetTransaction`, which never sets it — so on StudioNet the enum is always absent and the branch that would read it never fires. Every write therefore verifies a method-specific finalized on-chain state postcondition instead: `seed` re-derives the case and checks its authority, `retry` requires exactly one new attempt bound to the connected requester, `resolve` requires the expected status and a cleared pending attempt, `grantBudget` requires the counters to have moved, and `decline` requires the prior locked state to be restored. Reading state back is stronger evidence than an enum would have been.

Brand files are `public/logo.png` and `public/brand-lockup.png`; design rationale is documented in [`BRAND_ASSETS.md`](./BRAND_ASSETS.md).

## Reviewer entry points

- `LOCKED_SPEC.md` — locked product scope and implementation boundaries.
- `contracts/MeaningNonce.py` — frozen production source.
- `runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md` — StudioNet behavior verification.
- `runtime-evidence/RUNTIME_EVIDENCE.json` — machine-readable snapshots.
- `scripts/test_contract_logic.py` — executable actual-source behavior tests.
- `tests/direct/` — GenLayer Direct Mode tests, including `test_liveness_bounds.py` and `test_recovery_probe.py`, which execute the limitations named in the honest-scope section above.
- `TESTING.md` — exact reproduction and verification path.
