# Testing

Contract under test: `contracts/MeaningNonce.py`, sha256
`d561ae4588b1113c4c0224fb3c000e0947f5df6fc094651f7b5c77933a23fb6d`
Deployment: `0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4` on GenLayer Studio Next
(chain 61997, GenVM v0.3.0-rc7).

Everything below is run against **that exact source file**, never a paraphrase or
a second implementation of the same logic.

---

## Offline gates

```bash
npm run check
```

runs, in order, and stops at the first failure:

| Gate | Command | Result |
|---|---|---|
| AST invariants | `npm run check:ast` | `PASS AST contract invariants` |
| Contract logic | `npm run check:logic` | `15/15` |
| Adversarial suite | `npm run check:adversarial` | `12/12` |
| Prompt fence probe | `npm run check:fence` | `bypasses: 0/9` |
| Mutation matrix | `npm run check:mutations` | `caught mutations: 17/17` |
| Frontend build | `tsc -b && vite build` | rc 0 |

### What each one is

**`scripts/check_contract_ast.py`** — static invariants on the parsed contract:
the request text never reaches the semantic prompt, the case id does not include
the requester, the fence strip is a fixed point, the verdict enum has exactly two
members.

**`scripts/test_contract_logic.py`** — executes the real contract source against a
minimal py-genlayer v0.3 stub (`gl.contract.Contract`, `gl.message.raw`,
`gl.vm.run_nondet`, `genlayer.types` / `genlayer.storage` as real submodules).
Storage fields are allocated by the stub base class, matching v0.3 semantics
where a contract must not construct `TreeMap()` itself. 15 state-machine tests
plus a 12-test adversarial suite (`--suite adversarial`) covering prompt-boundary
injection, nested fence reconstruction, ledger preservation across budget grants,
and the per-epoch grant cap.

**`scripts/fence_probe.py`** — 9 attempts to reconstruct the prompt fence from
user-controlled text (nested tokens, doubled tokens, tokens split by the
normalizer's own whitespace handling). 0 bypasses.

**`scripts/mutation_matrix.py`** — 17 deliberate semantic defects injected into
the source, each scored on the three gates above. The unmutated baseline is green
on **all three**, so the columns are meaningful rather than constant; the AST gate
alone catches 12 of 17, and the logic gates catch the rest.

**`scripts/gate_v03_runtime.py`** — the only gate that uses the *real* SDK:

```bash
bash scripts/setup_v03_sdk.sh /tmp/genvm-v03
SDK=/tmp/genvm-v03/genvm/runners/genlayer-py-std/src
STUB=/tmp/genvm-v03/stub
PYTHONPATH="$STUB:$SDK" python3.13 scripts/gate_v03_runtime.py contracts/MeaningNonce.py
```

23 checks against py-genlayer **v0.3.0-rc7**, in-memory, no network:

```
[1] constructor        3 checks   __init__, storage auto-allocation, counters
[2] seed_rejected_case 6 checks   case_id, case_count, status, authority,
                                  created_at from gl.message.raw, derive_case_id
[3] revert branches    7 checks   CASE_ALREADY_EXISTS, CASE_REF_REQUIRED,
                                  EVIDENCE_JSON_INVALID, EVIDENCE_MUST_BE_JSON_ARRAY,
                                  EVIDENCE_REQUIRED, AUTHORITY_CANNOT_SUBMIT_RETRY,
                                  CASE_NOT_FOUND
[4] EXACT_REPLAY       4 checks   outcome, model_called=false, status, blocked_count
[5] authority control  3 checks   ONLY_AUTHORITY, grant budget, NO_FRESH_DECISION_PENDING
GATE: ALL PASS
```

`scripts/probe_v03_schema.py` runs the narrower check the network performs before
a deploy — module load plus schema extraction. Result: `SCHEMA: OK methods=9
(view=4, write=5)`.

---

## What the offline gates do NOT cover

Every path that goes through `gl.vm.run_nondet` / `gl.nondet.exec_prompt` needs a
real GenVM and is not exercised offline:

- `IMMATERIAL_DELTA`
- `MATERIAL_DELTA` and the transition to `AWAITING_FRESH_DECISION`
- `ALREADY_ADJUDICATED`
- `RETRY_BUDGET_EXHAUSTED`
- `record_fresh_decision` and `CLOSED_ACCEPTED`

These are exercised on Studio Next, through the dApp, and each result is read
back from contract state before it is recorded.

---

## Source parity

```bash
npm run verify:deployed
```

Fetches the source the network holds at the deployed address and compares it with
`contracts/MeaningNonce.py`. The expected hash is computed from the repository
file at run time rather than hardcoded, so the check cannot drift from the source.
The comparison is newline-aware: the Studio editor may store CRLF, which changes
the raw hash without changing a character of source.

---

## On-chain test procedure

Two wallets are required. `submit_retry` reverts with
`AUTHORITY_CANNOT_SUBMIT_RETRY` when the sender is the case authority, so a
single wallet cannot walk the flow. Both need GEN on Studio Next for fees.

| Step | Wallet | Action | Expected |
|---|---|---|---|
| 1 | A | `seed_rejected_case` with 2 baseline items | `LOCKED_REJECTED`, authority = A |
| 2 | B | `submit_retry`, baseline unchanged, new wording | `EXACT_REPLAY`, `model_called=false` |
| 3 | B | add one trivial item | `IMMATERIAL_DELTA`, `model_called=true`, `model_calls_this_epoch=1` |
| 4 | B | same evidence as step 3, different wording | `ALREADY_ADJUDICATED`, `model_calls_this_epoch` still 1 |
| 5 | B | drop a baseline item | `BASELINE_REMOVAL_BLOCKED`, baseline unchanged |
| 6 | B | add genuinely new material evidence | `MATERIAL_DELTA` → `AWAITING_FRESH_DECISION` |
| 7 | A | `record_fresh_decision` ACCEPTED, evidence identical to step 6 | `CLOSED_ACCEPTED`, `attempt_count = 4` |
| 8 | A | retry on the closed case | `CASE_NOT_RETRYABLE` |

Step 4 is the one worth being careful with: the cache key hashes the evidence
set, **not** the request text. Changing both puts the call back on the model
path instead of the cached path.

Step 7 requires `evidence_json` byte-identical to the pending attempt, otherwise
the call reverts with `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`.

### Reading results correctly

A transaction reaching `ACCEPTED` in the consensus history is **not** a success
signal — a failed transaction walks the same
`PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED` path. The authority is
the postcondition: re-read `get_case` / `get_attempt` and compare against the
table above. The dApp does this automatically and reports nothing as done until
the read-back matches.
