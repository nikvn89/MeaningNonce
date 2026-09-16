# MeaningNonce

**Changing the wording is not a new case.**

## Demo video

**▶ Watch the demo: https://www.youtube.com/watch?v=b9UQicWFo-k**

A walkthrough of what the app does and a full run against the deployed contract
on GenLayer Studio Next — seeding a rejected case, the four blocked retry paths,
the one material delta that reopens it, and the authority's fresh decision.

Every result in the video is read back from contract state before it is shown;
the contract address and all transactions are public on the explorer linked
below, and `npm run check` re-runs every offline gate against this exact source.


MeaningNonce is a semantic anti-verdict-shopping primitive for GenLayer. It records a rejected
decision together with its evidence baseline on-chain. A retry that carries no new evidence is
blocked deterministically without a materiality-model call. The retry still submits a paid write
transaction and proceeds through transaction consensus. Only an explicit evidence delta is sent through GenLayer consensus, which answers one narrow question: is the new evidence
material enough to reopen the recorded rejection?

MeaningNonce does not decide the underlying case and does not verify whether evidence is true.

---

## Deployment

| | |
|---|---|
| Network | **GenLayer Studio Next** (Consensus v0.6) |
| RPC | `https://studio-next.genlayer.com/api` |
| Chain ID | `61997` |
| Contract | `0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4` |
| Contract source | [`contracts/MeaningNonce.py`](contracts/MeaningNonce.py) |
| Source sha256 | `d561ae4588b1113c4c0224fb3c000e0947f5df6fc094651f7b5c77933a23fb6d` |
| GenVM | `v0.3.0-rc7`, runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |

---

## Run it locally

```bash
npm ci
cp .env.example .env          # then set VITE_CONTRACT_ADDRESS
npm run dev
```

Build exactly the way Vercel does, which is also the only smoke test that catches a broken
`tsconfig`:

```bash
npm run build     # tsc -b && vite build
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import it in Vercel. `vercel.json` already sets framework `vite`, install `npm ci`, build
   `npm run build`, output `dist`, and an SPA rewrite.
3. Add the environment variables from `.env.example` in **Project → Settings → Environment
   Variables**. At minimum `VITE_CONTRACT_ADDRESS`. Vite inlines `VITE_*` at build time, so a
   change needs a redeploy, not just a restart.

---

## How to try it

You need **two wallets**. `submit_retry` reverts with `AUTHORITY_CANNOT_SUBMIT_RETRY` when the
sender is the case authority, so a single wallet cannot walk the whole flow. Both need GEN on
Studio Next for fees.

1. **Seed** (wallet A) — record a rejection reference, its reason, and the baseline evidence, one
   item per line. Wallet A becomes the decision authority for that case reference.
2. **Retry** (wallet B) — load the case, then submit the **full** candidate evidence set.
   - resubmitting the baseline unchanged → `EXACT_REPLAY`, `model_called=false`
   - dropping a baseline item → `BASELINE_REMOVAL_BLOCKED`
   - adding a trivial item → one model call → usually `IMMATERIAL_DELTA`
   - resubmitting that same evidence set with different wording → `ALREADY_ADJUDICATED`, no second
     model call (the cache key hashes evidence, not request text)
   - adding genuinely new material evidence → `MATERIAL_DELTA` → `AWAITING_FRESH_DECISION`
3. **Resolve** (wallet A) — record the fresh decision, or decline the reopening. The canonical evidence hashes you
   submit must match the pending attempt, or the call reverts with
   `DECISION_EVIDENCE_MUST_MATCH_REOPENED_ATTEMPT`.

Every case is created by the person testing it, so nothing depends on shared state.

## Honest limitations

- The materiality verdict is **one stochastic classification per distinct evidence set**, not a
  proof about the evidence. The contract bounds how many of those a case can buy:
  `MAX_MODEL_CALLS_PER_EPOCH = 3`, with at most `MAX_BUDGET_GRANTS_PER_EPOCH = 5` authority resets.
- The contract does **not** check whether evidence is true, and does not decide the underlying
  case. It only decides whether a retry is entitled to a fresh upstream decision.
- Validator rerun is convergence discipline, not injection resistance: the validator rebuilds the
  same prompt, so an injection that steers one model steers them all. The real defences are the
  prompt fence and the two-value enum whitelist.
- A case whose baseline reaches `MAX_EVIDENCE_ITEMS = 12` refuses every future retry, and an
  exhausted budget with no remaining grants closes the case reference permanently. Recovery is by
  re-seeding under a new case reference.
- `CLOSED_ACCEPTED` is terminal. There is no reopen path.

---

## Frontend architecture

- **Vite + React 18 + TypeScript**, no server. Reads need no wallet.
- **One network definition.** `src/network.ts` builds a single chain object from env and every
  consumer — reads, MetaMask, Transaction Kit — uses it, so an RPC override can never sign for a
  chain other than the one being read. The published SDK has no Studio Next preset, so the object
  is `studioDevnet` (Consensus v0.6 wiring, chain 61997) with the RPC moved to Studio Next.
- **Fees.** Consensus v0.6 charges for writes, so every write goes through
  `@genlayer/transaction-kit` — estimate, fee review, sign, tracked status — instead of a bare
  `writeContract`. The kit's signing control is press-and-hold on touch only: its handler returns
  early when `event.pointerType === "mouse"`, so with a mouse a single click is the correct and
  only gesture. Reviewers on a desktop should click, not hold.
- **A decided transaction is not a success signal.** A failed deploy still walks
  `PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED`. `src/TxGate.tsx` reports nothing as
  done until it has re-read contract state and found the postcondition it expected: the seed
  produced a case owned by the sender, the retry created exactly one new attempt bound to the
  sender, the fresh decision produced the exact expected status with no pending attempt left.
- **`txExecutionResultName` is not treated as mandatory.** On Studio chains the SDK's local decoder
  does not populate it, so requiring it would throw on every successful transaction.
- **The wallet's chain is checked before signing.** genlayer-js skips its own chain assertion for
  Studio chains, so `ensureNetwork()` in `src/genlayer.ts` is that missing check.
- **No showcase case IDs are hardcoded.** The previous build shipped two case IDs from the old
  StudioNet deployment; those records do not exist here. Set `VITE_RUNTIME_CASE_ID` and
  `VITE_ROLE_CASE_ID` only after creating and reading back the corresponding cases.

## Shared integration layer

`src/network.ts` and `src/genlayer.ts` are the same Consensus v0.6 wallet adapter used across my
GenLayer submissions: connect a wallet, assert the chain id the SDK skips for Studio chains, read
contract state, and re-read it after every write. `src/main.tsx` is the six-line Vite bootstrap and
is identical to the one in my other entries. None of these carry protocol logic and none is claimed
as novel.

`src/TxGate.tsx` started from that shared adapter but the postconditions it enforces are specific to
this contract: a seed must produce a case owned by the sender, a retry must create exactly one new
attempt bound to the sender, a fresh decision must leave no pending attempt.

The protocol lives entirely in `contracts/MeaningNonce.py` and `src/App.tsx`, neither of which is
shared with any other project.

## Contract gates

```bash
bash scripts/setup_v03_sdk.sh /tmp/genvm-v03
SDK=/tmp/genvm-v03/genvm/runners/genlayer-py-std/src
STUB=/tmp/genvm-v03/stub
PYTHONPATH="$STUB:$SDK" python3.13 scripts/gate_v03_runtime.py contracts/MeaningNonce.py
```

23 deterministic checks against the real py-genlayer v0.3.0-rc7 SDK: constructor and storage
allocation, `seed_rejected_case`, seven revert branches, the `EXACT_REPLAY` path, and the
authority role guard. It runs offline, in-memory, with no network.

It does **not** cover anything that goes through `gl.vm.run_nondet` / `gl.nondet.exec_prompt` —
`IMMATERIAL_DELTA`, `MATERIAL_DELTA`, `ALREADY_ADJUDICATED`, `RETRY_BUDGET_EXHAUSTED` and
`record_fresh_decision` need a real GenVM and are exercised on Studio Next.

## Notes on network values

The migration announcement lists the explorer as `https://explorer-studio-dev.genlayer.com/`, which
is the default in `.env.example`. A live deployment link also resolved on
`https://explorer-studio-next.genlayer.com/`. Open both against the contract address and set
`VITE_EXPLORER_URL` to whichever renders it; nothing else in the app depends on that host.

Migration reference: <https://docs.genlayer.com/developers/consensus-v06-migration>

## Verified demo case

Studio Next contract: `0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4`.
Case reference: `WARRANTY-4417`.
Case ID: `4aba8132a789596bd8662e967439e242b5681e5d3bcdccc9a21e1df55bbe5af6`.
Latest attempt: `c1c69f44290ff7014108ef795a602c1c3cbfcdfe79f5a049e99d336d56dc1fc8`.
Open Inspect Cases, paste the case ID, leave Attempt ID empty, and refresh contract state.
Read-only inspection needs no wallet. The published app currently has no configured showcase buttons.
The Verification page lists expected behaviours; it is not an executed runtime-proof archive.

Source parity compares CRLF/CR as LF and one optional terminal LF only. The raw repository SHA256
above remains unchanged. The deployed source has CRLF and omits the terminal newline; its canonical
SHA256 is `22e7acc64c3995e16b12ad1c590b6c775f06e298ca34ed55ee6730c46d57a95d`.
Other source differences still fail the verifier.
