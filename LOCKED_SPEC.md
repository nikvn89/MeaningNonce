# MeaningNonce — locked Agent Tank scope

## Source-of-truth pitch

An AI agent gets rejected, then keeps rewriting the same request until one version gets through. Traditional nonces stop the exact same transaction from being replayed; they do not help when the wording changes but the request and evidence are basically the same.

MeaningNonce keeps the previous decision and evidence on-chain.

- If the evidence is unchanged, the retry is blocked.
- If there is genuinely new evidence, GenLayer validators decide only whether that new evidence is important enough to reopen the case.
- The goal is **not** to build another AI court.
- The goal is to stop agents from endlessly shopping for a better verdict just by changing wording.

## Implementation boundaries for v4

1. **General primitive.** `case_ref` is opaque and supplied by the decision authority.
2. **Authority is an explicit contract-local trust root.** The contract records the earlier rejection supplied by that wallet; it does not prove external provenance or truth.
3. **Only rejected cases are retryable.** Fresh `ACCEPTED` is terminal.
4. **Case identity = authority + normalized case_ref.** Requester wallet and request wording cannot create a new nonce for the same authority namespace.
5. **Literal role boundary.** The authority address cannot submit retries against its own case. Different addresses still do not prove independent real-world control.
6. **Request text is audit-only.** Stored in attempts, never included in case identity or semantic materiality input.
7. **Deterministic evidence baseline.** Evidence items are whitespace-normalized, hashed, deduplicated, and hash-sorted.
8. **Removal cannot manufacture novelty.** Omission of any baseline item is blocked before model execution.
9. **No additions means replay.** Reorder, duplicates, and whitespace-only edits become `EXACT_REPLAY` with `model_called=false`.
10. **Only explicit additions reach consensus.** Inputs are rejection reason + full prior baseline + additions; no external fetch/oracle.
11. **Same candidate set gets one committed semantic adjudication per epoch.** After a semantic round commits, reuse returns `ALREADY_ADJUDICATED`, no model call.
12. **Distinct-junk grinding is bounded per committed budget window.** At most three distinct candidate sets can commit semantic adjudications before authority intervention.
13. **Budget escape cannot reroll a committed existing set.** `grant_retry_budget` never clears the adjudicated ledger, and at most five budget grants are allowed per epoch so the per-case ledger is deterministically bounded.

**Consensus qualification for #11–#13:** these guards bind committed rounds. If a semantic round fails to reach validator majority, the whole transaction reverts, so no adjudication entry or budget increment persists; that candidate may be submitted again for another consensus round. Screenshot 05 shows one validator disagreement on a materiality round that still reached quorum and committed.
14. **Semantic output is narrow.** `MATERIAL_DELTA` may reopen; `IMMATERIAL_DELTA` remains locked. Neither decides the underlying case.
15. **Fresh decision is authority-only and evidence-bound.** It must reference exactly the candidate evidence set that caused reopening.
16. **Decline cannot reroll.** `decline_reopening` restores the prior locked baseline, but the material candidate remains adjudicated.
17. **Fresh REJECTED is the only epoch reset.** It installs the full candidate as the new baseline and clears the per-epoch adjudication ledger, semantic-call counter, and budget-grant counter.
18. **Malformed semantic output fails closed.** Invalid/non-object/prompt failure becomes `IMMATERIAL_DELTA`, never reopening.
19. **Prompt boundary is defensive, not a truth filter.** Stored evidence is not rewritten to remove verdict words; only MeaningNonce's own fence tags are stripped case-insensitively from prompt copies.
20. **Finalization is not success.** Browser UX verifies execution/state postconditions and does not infer contract success from a finalized transaction alone.
21. **Permissionless-retry DoS is an explicit limitation.** Because retries are not bound to one requester, an unrelated wallet can consume a case's three-call budget window. The authority can restore budget, but the contract does not claim requester-level anti-DoS. Per-requester budgets are intentionally avoided because fresh wallets would recreate unbounded semantic grinding.
22. **Prompt fence is fixed-point bounded.** Fence-token stripping repeats for a fixed eight passes and then removes angle brackets only on pathological nesting, preventing nested prompt-boundary reconstruction without an unbounded attacker-controlled loop.

## Honest claim

MeaningNonce is a semantic anti-verdict-shopping primitive with deterministic replay/removal/budget guards and a bounded semantic reopening question. It is not perfect semantic deduplication, an external provenance system, a truth oracle, or an arbitration court. A paraphrased evidence item may still create a new deterministic hash and consume one bounded semantic-call slot.
