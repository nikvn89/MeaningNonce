# Changelog

## 2.0.0-studionext — 2026-09-15

Rebuilt for **GenLayer Studio Next** (Consensus v0.6). The previous build targeted StudioNet with
GenVM v0.2 and does not run on this network.

### Contract — ported v0.2 → v0.3

- header: added `# v0.3.0`, runner pin moved to
  `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`
- `from genlayer import *` → `import genlayer as gl` + `from genlayer.types import *` +
  `from genlayer.storage import TreeMap` (v0.3 no longer binds `gl` through the star import)
- `gl.Contract` → `gl.contract.Contract`
- `gl.vm.run_nondet_unsafe` → `gl.vm.run_nondet`
- `gl.message_raw["datetime"]` → `gl.message.raw["datetime"]` (5 sites)
- removed `self.cases = TreeMap()` / `self.attempts = TreeMap()` from `__init__` — v0.3 allocates
  storage fields from the storage layout and raises `GenerationError` on an explicit constructor

No logic, constant, prompt, fence or state-machine change. Redeployed at
`0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4`.

### Frontend

- `genlayer-js` 1.1.8 → 2.0.0-rc.1
- writes moved to `@genlayer/transaction-kit` + `@genlayer/transaction-kit-react` 0.1.0-rc.2:
  estimate → fee review → sign → tracked status, because v0.6 charges fees (the kit's
  press-and-hold applies to touch only; with a mouse a single click is the gesture)
- single network definition in `src/network.ts` shared by reads, MetaMask and the kit
- added `ensureNetwork()`: genlayer-js skips its chain assertion for Studio chains, so the wallet's
  chain is now checked before anything is signed
- postcondition verification kept and moved into `src/TxGate.tsx` — a decided transaction is never
  reported as success until contract state has been re-read
- removed the two hardcoded showcase case IDs; they belonged to the old deployment and do not exist
  here. Now `VITE_RUNTIME_CASE_ID` / `VITE_ROLE_CASE_ID`, unset by default
- added `vercel.json` (framework vite, `npm ci`, SPA rewrite) and `.env.example`

### Testing

- `scripts/gate_v03_runtime.py`: 23 deterministic checks on the real py-genlayer v0.3.0-rc7 SDK
- the previous evidence pack (genvm-linter 0.11.0, gltest Direct Mode pinned to GenVM v0.2.12, and
  the runtime screenshots of `0x1A81177f32d22185F421F0019714DCB6e3124263`) does **not** carry over
  and is not claimed here
