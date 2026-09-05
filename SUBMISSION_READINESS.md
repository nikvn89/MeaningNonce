# MeaningNonce — submission readiness

## Completed

- Frozen StudioNet deployment: `0x1A81177f32d22185F421F0019714DCB6e3124263`.
- Production contract source frozen at SHA-256 `d0fbf1982ae07411d1b3b0e9af281f41de17391268e7a8d9c91f882c0ab1934f`.
- **Deployed-source parity proven** on 2026-09-05 via StudioNet `gen_getContractCode`: raw deployed CRLF SHA-256 `b550a8a2afe70b94151e86243fd92912e5f91d31dd82b59e621cb01685c3baab`; newline-normalized SHA-256 exactly matches the frozen repository source.
- Core StudioNet runtime path completed through terminal `CLOSED_ACCEPTED`.
- Runtime rollback gates observed for evidence mismatch, post-close retry, and authority self-retry.
- Local actual-source AST/behavior/adversarial/fence/mutation gates re-executed and PASS.
- Independent final review executed the exact frozen source: GenVM lint/validation PASS, typecheck PASS, and official GenLayer Direct Mode **19 passed**.
- Frontend config stamped to the deployed contract.
- Final usability redesign completed: persistent navigation, guided 3-step workflow, clearer role/status context, Runtime Proof page, verified-case shortcuts, and Semantic Boundary Scan.
- Submit Retry is state-gated for terminal/pending cases and hydrates finalized baseline evidence.
- Resolve is state-gated: write controls appear only for `AWAITING_FRESH_DECISION`; `CLOSED_ACCEPTED` / `LOCKED_REJECTED` render finalized read-only state.
- MeaningNonce project logo and brand assets included under `public/`; brand spec recorded in `BRAND_ASSETS.md`.
- Live dApp URL: `https://meaning-nonce.vercel.app`.
- Production screenshots verified the main navigation, verified-case shortcuts, Semantic Boundary Scan, terminal retry UX, and mobile responsiveness.
- `__pycache__`, `.pyc`, `node_modules`, `dist`, and build caches excluded.

## Final pre-submit action

The GitHub repository must contain this exact final frontend source and Vercel must redeploy it. After the deploy, load the known `CLOSED_ACCEPTED` main case on **Resolve** and confirm the page shows finalized read-only state with no REJECTED / ACCEPTED / Decline write controls. No new contract transaction is required.

## Honest remaining environment limitation

The local packaging environment did not perform a dependency-installed `npm run build`; the live Vercel deployment is the production build surface. Do not claim a local dependency-installed Vite build unless it is actually rerun.
