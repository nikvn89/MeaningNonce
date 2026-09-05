# MeaningNonce — StudioNet runtime verification

## Frozen runtime deployment

- Network: **GenLayer StudioNet**
- Contract: `0x1A81177f32d22185F421F0019714DCB6e3124263`
- Repository contract SHA-256: `d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f`
- Main runtime case: `fcbab56d34ba7520125cc205bf4b1ab392d20d5ac7b0827b32d7b63df5e6bc95`
- Role-guard case: `6f1bc3dcd447849d1aeed5ce9021c6df989792bbf3d6ac9955f38c028023595f`

The Studio UI showed the deployment as accepted/finalized. Deployed-source parity was subsequently verified directly through StudioNet `gen_getContractCode` on 2026-09-05. Studio returned 18,982 bytes with CRLF line endings (`b550a8a2afe70b94151e86243fd92912e5f91d31dd82b59e621cb01685c3baab`); newline normalization produced 18,517 bytes with SHA-256 `d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f`, exactly matching the frozen repository source.

Reviewer reproduction: `bash scripts/verify_deployed_source.sh`. Screenshot: `runtime-evidence/screenshots/08_source_parity_proven.png`.

## Runtime gates observed PASS

1. `seed_rejected_case` created the rejected baseline.
2. Reword + reorder + duplicate evidence produced `EXACT_REPLAY` with `model_called=false`.
3. Removing prior evidence produced `BASELINE_REMOVAL_BLOCKED`; the original baseline remained intact.
4. An irrelevant addition was semantically adjudicated `IMMATERIAL_DELTA`.
5. Re-submitting that same candidate with different wording produced `ALREADY_ADJUDICATED`, `model_called=false`, and `prior_semantic_outcome=IMMATERIAL_DELTA`; `model_calls_this_epoch` stayed at 1.
6. A material addition produced `MATERIAL_DELTA` and `AWAITING_FRESH_DECISION`.
7. Authority `decline_reopening` returned the case to `LOCKED_REJECTED` without refilling the consumed semantic-call counter.
8. `record_fresh_decision` with the wrong evidence set rolled back with `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`.
9. Fresh `REJECTED` installed the full reopened candidate as the epoch-2 baseline and reset `adjudicated`, model-call budget, and grant counter.
10. Reword + reorder against that epoch-2 baseline again produced `EXACT_REPLAY`, `model_called=false`.
11. A new material C-301 addition reopened epoch 2.
12. Fresh `ACCEPTED` closed the main case as `CLOSED_ACCEPTED`.
13. A post-acceptance retry rolled back with `CASE_NOT_RETRYABLE`.
14. On a fresh rejected case, the authority's own `submit_retry` rolled back with `AUTHORITY_CANNOT_SUBMIT_RETRY`; `attempt_count=0` and `model_calls_this_epoch=0` remained unchanged.

## Final main-case state

```text
decision = ACCEPTED
status = CLOSED_ACCEPTED
epoch = 2
attempt_count = 8
blocked_count = 5
pending_attempt_id = ""
```

## Evidence files

- `runtime-evidence/RUNTIME_EVIDENCE.json` — machine-readable runtime snapshots.
- `runtime-evidence/screenshots/` — key StudioNet transaction screenshots, including the three rollback gates and deployed-source parity proof.

## Evidence scope

This is real StudioNet behavioral evidence gathered through GenLayer Studio writes and finalized read methods. It is not a substitute for repository-executable GenVM lint/Direct Mode tests, and no static source marker is relabelled as runtime proof.
