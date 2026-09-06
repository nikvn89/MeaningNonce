# MeaningNonce — final project summary

## Final deployment

- Network: GenLayer StudioNet
- Contract: `0x1A81177f32d22185F421F0019714DCB6e3124263`
- Production source: `contracts/MeaningNonce.py`
- Contract SHA-256: `d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f`
- Main runtime case: `fcbab56d34ba7520125cc205bf4b1ab392d20d5ac7b0827b32d7b63df5e6bc95`
- Authority role-guard case: `6f1bc3dcd447849d1aeed5ce9021c6df989792bbf3d6ac9955f38c028023595f`
- Live dApp: `https://meaning-nonce.vercel.app`

## Product claim

MeaningNonce is a semantic anti-verdict-shopping primitive for AI-agent retries. Traditional nonces stop exact transaction replay; MeaningNonce prevents a rejected request from buying another semantic roll merely by changing wording when the evidence is unchanged or the same candidate evidence set has already been adjudicated.

It is not an AI court, does not decide whether outside-world evidence is true, and does not treat immutable/self-declared data as provenance.

## StudioNet runtime verification

The final StudioNet deployment exercised the load-bearing behavior:

1. Reword + reorder + duplicate evidence → `EXACT_REPLAY`, `model_called=false`.
2. Remove prior evidence → `BASELINE_REMOVAL_BLOCKED`; baseline remains unchanged.
3. New immaterial evidence → `IMMATERIAL_DELTA`.
4. Same adjudicated evidence with new wording → `ALREADY_ADJUDICATED`, no semantic reroll.
5. New material evidence → `MATERIAL_DELTA` → `AWAITING_FRESH_DECISION`.
6. Authority decline returns the case to `LOCKED_REJECTED` without refunding semantic-call budget.
7. Fresh decision using mismatched evidence → `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT` rollback.
8. Fresh `REJECTED` → new epoch, full candidate becomes the new baseline, adjudication/budget counters reset.
9. Exact replay against the epoch-2 baseline remains deterministic and model-free.
10. Fresh `ACCEPTED` → `CLOSED_ACCEPTED`.
11. Retry after close → `CASE_NOT_RETRYABLE` rollback.
12. Authority self-retry → `AUTHORITY_CANNOT_SUBMIT_RETRY` before an attempt/model call is created.

See `runtime-evidence/STEWARD_RUNTIME_VERIFICATION.md` and `runtime-evidence/RUNTIME_EVIDENCE.json` for the evidence package.

## Executed repository gates

- `PASS AST contract invariants`
- `PASS actual-contract off-chain logic: 15/15`
- `PASS executable adversarial actual-contract suite: 12/12`
- `PASS prompt-fence probe: 0/9 bypasses`
- `PASS mutation matrix: 17/17 caught`
- `PASS Python compile`
- `PASS TypeScript/TSX source syntax transpile check`

The package does not claim exact-source `genvm-lint`, Direct Mode, or a dependency-installed local Vite build as PASS in the packaging environment where those dependencies were unavailable.

## Final UI / brand

The final application is organized as a Web3 protocol workspace:

- persistent sidebar navigation;
- Overview with a clear Seed → Retry → Resolve workflow;
- dedicated Seed Case, Submit Retry, Resolve, Inspect Cases, and Verification pages;
- connected-contract and wallet context;
- visible authority/requester role context;
- clear case status and latest-attempt cards;
- action forms that are **empty by default** rather than preloaded with runtime/demo values;
- verified runtime references isolated to Inspect Cases and Verification;
- responsive navigation;
- MeaningNonce project logo and brand lockup;
- signature **Semantic Boundary Scan** on Submit Retry: request wording is visibly excluded, baseline evidence locks, candidate evidence is scanned, and the real outcome appears only after finalized state verification.

Brand files:

- `public/logo.png`
- `public/brand-lockup.png`
- `BRAND_ASSETS.md`

## Security and scope constraints

MeaningNonce keeps its claims narrow and explicit:

- **No external-world provenance claim:** the authority is contract-local; immutable or self-declared data is not treated as canonical truth.
- **Executable behavior over static markers:** the core anti-reroll claims are backed by executed StudioNet behavior and repository-executable tests.
- **Bounded semantic scope:** GenLayer is used only to classify whether explicit new evidence is materially relevant to reopening the recorded rejection.

The contract does not claim to arbitrate the underlying case or establish the truth of supplied evidence.
