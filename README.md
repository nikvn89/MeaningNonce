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

MeaningNonce also does not claim perfect semantic deduplication. A paraphrased evidence item can hash differently and consume a bounded semantic slot; a third party can consume a budget window before a legitimate requester, with authority budget restoration as the explicit recovery path.

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

The packaging environment did not have `genvm-linter` / `genlayer-test` installed and its package fetch timed out during `npm install`, so those exact-source gates are not relabelled as locally reproduced PASS. The production frontend is live on Vercel. Exact-source GenVM/Direct Mode commands remain documented in `TESTING.md` for reproducible execution in an environment with the pinned dependencies.

## Frontend

The dApp is stamped to the runtime-tested StudioNet deployment by default. `VITE_CONTRACT_ADDRESS` remains an optional override.

The interface is organized as a Web3 protocol workspace with persistent navigation, connected-contract context, clear status panels, and dedicated Seed / Retry / Resolve / Inspect / Verification surfaces. **Action forms are empty by default**: no runtime case, rejection reason, request text, evidence set, or decision is prefilled. Runtime reference cases are isolated to inspection and verification surfaces so reviewers can inspect executed behavior without turning transaction forms into a scripted demo.

The Submit Retry page includes the signature **Semantic Boundary Scan**: wording visibly exits the decision boundary, the loaded baseline locks in place, candidate evidence is scanned, and the outcome is revealed only after the finalized attempt is read back from StudioNet. It is explanatory motion, not a simulated verdict.

The client does not treat `FINALIZED` alone as successful execution. Where an execution enum is exposed it requires `FINISHED_WITH_RETURN`; otherwise each write verifies a method-specific finalized on-chain state postcondition before presenting success.

Brand files are `public/logo.png` and `public/brand-lockup.png`; design rationale is documented in [`BRAND_ASSETS.md`](./BRAND_ASSETS.md).

## Reviewer entry points

- `LOCKED_SPEC.md` — locked product scope and implementation boundaries.
- `contracts/MeaningNonce.py` — frozen production source.
- `runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md` — StudioNet behavior verification.
- `runtime-evidence/RUNTIME_EVIDENCE.json` — machine-readable snapshots.
- `scripts/test_contract_logic.py` — executable actual-source behavior tests.
- `tests/direct/` — GenLayer Direct Mode tests.
- `TESTING.md` — exact reproduction and verification path.
