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
- Deployed-source parity: **PROVEN** via `gen_getContractCode`; Studio returned CRLF source whose newline-normalized SHA-256 is the frozen repository hash above.

## Core behavior

A decision authority seeds a previously rejected case with a case reference, rejection reason, and evidence baseline. Any non-authority wallet may submit a retry against that same contract-local case.

- Same normalized evidence → `EXACT_REPLAY`, no model call.
- Candidate removes baseline evidence → `BASELINE_REMOVAL_BLOCKED`, no model call and baseline does not shrink.
- Same candidate set after a **committed** semantic adjudication → `ALREADY_ADJUDICATED`, no second committed semantic roll in that epoch.
- At most three distinct semantic adjudications can commit per budget window; exhaustion → `RETRY_BUDGET_EXHAUSTED` without a model call.
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

MeaningNonce also does not claim perfect semantic deduplication. A paraphrased evidence item can hash differently and consume a bounded semantic slot; a third party can consume a budget window before a legitimate requester, with authority budget restoration as the explicit recovery path. The adjudication ledger and semantic-call counter bind **committed** consensus rounds: if a round fails to reach validator majority, the transaction reverts and neither entry persists, so that candidate may be submitted again for another round.

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

Re-executed in the current packaging environment:

```text
PASS AST contract invariants
PASS actual-contract off-chain logic: 15/15
PASS executable adversarial actual-contract suite: 12/12
PASS prompt-fence probe: 0/9 bypasses
caught mutations: 17/17
PASS Python compile
```

The local packaging environment does not have `genvm-linter` / `genlayer-test` installed and did not perform a dependency-installed Vite build. Separately, an independent final review executed the frozen contract source at SHA `d0fbf198…1934f`: GenVM lint/validation passed, typecheck reported no errors, and official GenLayer Direct Mode reported **19 passed**. The production frontend is live on Vercel and has been visually checked across the main navigation and verified-case views; the final Resolve state-gate source must be the version deployed before submission.

## Frontend

The dApp is stamped to the runtime-tested StudioNet deployment by default. `VITE_CONTRACT_ADDRESS` remains an optional override.

The final UI was redesigned for reviewer usability rather than visual novelty: persistent left navigation, a three-step overview, dedicated Seed / Retry / Resolve / Inspect pages, explicit role/status cards, one-click loading of verified runtime cases, and a separate Runtime Proof page. The Submit Retry page also includes a signature **Semantic Boundary Scan**: wording visibly exits the decision boundary, the recorded baseline locks in place, candidate evidence is scanned, and the outcome is revealed only after the finalized attempt is read back from StudioNet. It is explanatory motion, not a simulated verdict. The project mark is included at `public/logo.png`; the wider brand lockup and UI reference are stored under `public/`. The Resolve page now exposes write actions only while the loaded case is `AWAITING_FRESH_DECISION`; terminal `CLOSED_ACCEPTED` and ordinary `LOCKED_REJECTED` cases render finalized read-only state and real on-chain baseline evidence instead of stale action forms.

The client does not treat `FINALIZED` alone as successful execution. Where an execution enum is exposed it requires `FINISHED_WITH_RETURN`; otherwise each write verifies a method-specific finalized on-chain state postcondition before presenting success.

Brand rationale and the reusable image-generation prompt/spec are documented in [`BRAND_ASSETS.md`](./BRAND_ASSETS.md).

## Reviewer entry points

- `LOCKED_SPEC.md` — scope lock from the Agent Tank pitch.
- `STEWARD_ATTACK_GATE.md` — mandatory anti-pattern checks learned from prior steward reviews.
- `contracts/MeaningNonce.py` — frozen production source.
- `runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md` — StudioNet behavior proof.
- `runtime-evidence/RUNTIME_EVIDENCE.json` — machine-readable snapshots, including source-parity hashes.
- `scripts/verify_deployed_source.sh` — reviewer-runnable StudioNet source-parity check.
- `scripts/test_contract_logic.py` — executable actual-source behavior tests.
- `tests/direct/` — GenLayer Direct Mode tests.
- `TESTING.md` — exact reviewer/reproduction path.
