# Security

## Reporting

Open a GitHub issue, or contact the maintainer privately for anything that should not be public
before a fix.

## Scope and trust model

MeaningNonce records a rejected decision and its evidence baseline, and decides whether a retry is
entitled to a fresh upstream decision. It does not decide the underlying case and does not verify
whether any piece of evidence is true.

### Deterministic guarantees

These hold without any model call:

- a retry that removes a baseline evidence item is blocked (`BASELINE_REMOVAL_BLOCKED`)
- a retry with no new evidence is blocked (`EXACT_REPLAY`)
- an evidence set already adjudicated in this epoch never buys a second model call
  (`ALREADY_ADJUDICATED`) — the cache key hashes the evidence set, not the request wording
- the case authority cannot submit a retry against its own case (`AUTHORITY_CANNOT_SUBMIT_RETRY`)
- a fresh decision must carry an evidence set whose canonical hashes match the pending
  attempt (`DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`). Canonicalisation collapses
  whitespace, removes duplicates and sorts by content hash, so reordering or re-spacing
  the same evidence is not a mismatch — changed evidence content is
- `CLOSED_ACCEPTED` is terminal

### What is stochastic

Materiality is one classification per distinct evidence set, bounded by
`MAX_MODEL_CALLS_PER_EPOCH = 3` and at most `MAX_BUDGET_GRANTS_PER_EPOCH = 5` authority resets per
epoch. It is not a proof about the evidence.

### Prompt boundary

User text is fenced and the fence tokens are stripped to a fixed point, with a fallback that drops
`<` and `>`. The accepted answer is a two-value enum; anything else fails closed and writes no
state.

Validator rerun is **not** injection resistance: the validator rebuilds the same prompt, so an
injection that reliably steers one model steers them all. The fence and the enum whitelist are the
defences.

### Denial-of-service bounds, stated deliberately

- 18 spam retries can permanently close a case reference by exhausting budget and grants
- a baseline that reaches `MAX_EVIDENCE_ITEMS = 12` refuses every future retry
- recovery in both cases is re-seeding under a new case reference

### Frontend

- no private keys are handled; signing is MetaMask only
- the wallet's chain id is checked before every signature — genlayer-js skips its own assertion for
  Studio chains
- no transaction is reported as successful until contract state has been re-read; a failed
  transaction still reaches `ACCEPTED` in the consensus history
