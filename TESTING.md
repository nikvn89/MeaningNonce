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

These were exercised on Studio Next through the dApp, in the run recorded below,
with contract state re-read after every write.

---

## Source parity

```bash
npm run verify:deployed
```

Fetches the source the network holds at the deployed address and compares it with
`contracts/MeaningNonce.py`. The expected hash is computed from the repository
file at run time rather than hardcoded, so the check cannot drift from the source.
The comparison normalizes CRLF/CR to LF and removes at most one optional terminal
LF from each copy. Raw hashes are reported separately. It accepts this editor-only
formatting difference and still rejects every substantive source difference.

---

## On-chain run — EXECUTED

Two wallets are required. `submit_retry` reverts with
`AUTHORITY_CANNOT_SUBMIT_RETRY` when the sender is the case authority, so a
single wallet cannot walk the flow. Both need GEN on Studio Next for fees.

```text
case reference  WARRANTY-4420
case id         d23479064540a5ecf21f214a64c5fe80696f433a3baa663511215b3f24df9186
latest attempt  638b34081a3a20d7603731c80650bedd9c5e8d8067ad3857e54e92d6889c8cbe
authority       0x627609…4657F4        requester   0x146e44…95ec8e
```

| # | Wallet | Action | Result | Model called | Model calls after |
|---|---|---|---|---|---|
| 1 | A | `seed_rejected_case`, 2 baseline items | `LOCKED_REJECTED`, authority = A | — | 0/3 |
| 2 | B | `submit_retry`, baseline unchanged, new wording | `EXACT_REPLAY` | **No** | 0/3 |
| 3 | B | add one item that restates what is on file | `IMMATERIAL_DELTA` | Yes | 1/3 |
| 4 | B | same evidence as step 3, different wording | `ALREADY_ADJUDICATED` | **No** | 1/3 |
| 5 | B | drop a baseline item | `BASELINE_REMOVAL_BLOCKED`, baseline unchanged | **No** | 1/3 |
| 6 | B | add two third-party records that predate the sign-off | `MATERIAL_DELTA` → `AWAITING_FRESH_DECISION` | Yes | 2/3 |
| 7 | A | `record_fresh_decision` ACCEPTED, evidence identical to step 6 | `CLOSED_ACCEPTED` | — | 2/3 |
| 8 | — | retry on the closed case | refused by the interface; no transaction sent | — | 2/3 |

Final durable state, read back from the contract:

```text
status                  CLOSED_ACCEPTED
epoch                   1
attempt_count           5
blocked_count           4
model_calls_this_epoch  2
baseline items          4      (replaced by the accepted evidence set)
```

Five attempts, two model calls. Steps 2, 4 and 5 were blocked without consulting
a model; only steps 3 and 6 reached consensus.

### Transactions — all FINALIZED

```text
1  seed_rejected_case          A  0x51304fbcb14d1744c054d05cb09c5b395dcd4ff675123e5ac8ba445bd588b17a
2  submit_retry · replay       B  0x6ea64c62ba4e155ee9466018a2b019646e694dfac1746bf2f5266a7da0350da6
3  submit_retry · immaterial   B  0x5bef69ee82bf29c9ee75e0e300e00f1c604c36bf8118087a0349b4326d2e09f0
4  submit_retry · adjudicated  B  0x567ad2bdc594c201b522e1055cce4153b9c7d58a12fdb6d38f4e7e762f227892
5  submit_retry · removal      B  0x5089e0d9c01b0f8e0b8c592ce44e9f9d496edd0d502e53e951f801c2908c408b
6  submit_retry · material     B  0x33878838362419e27a1f93692694dba15046b4fdd877c793175491b2faa3c463
7  record_fresh_decision       A  0x40a07b92e2dcee78efb100a6602d7a4f21e6c9734be510566183b5f79700a8bc
```

Step 8 sends nothing: on a `CLOSED_ACCEPTED` case the submit control is disabled,
so `CASE_NOT_RETRYABLE` is covered by the offline suites rather than by a
deliberately failed transaction on chain.

### What this run does NOT prove

`RETRY_BUDGET_EXHAUSTED` and `grant_retry_budget` were not exercised on chain:
this run spent 2 of 3 calls and never hit the cap. Both are covered by
`check:logic` and `check:adversarial`, which is offline coverage, not on-chain
coverage, and this section does not present it as such.

Step 4 is the one worth reading twice: the cache key hashes the evidence set,
**not** the request text. That is why a complete rewrite of the wording bought
nothing and the counter stayed at 1/3.

Step 7 canonicalizes `evidence_json` and requires its evidence hashes to match
the pending attempt. Evidence order and duplicate representations do not create
a mismatch; changed evidence content does. A mismatched canonical evidence set
reverts with `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`.

### Reading results correctly

A transaction reaching `ACCEPTED` in the consensus history is **not** a success
signal — a failed transaction walks the same
`PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED` path. The authority is
the postcondition: re-read `get_case` / `get_attempt` and compare against the
table above. The dApp does this automatically and reports nothing as done until
the read-back matches.
