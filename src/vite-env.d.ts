/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_ADDRESS?: string;
  readonly VITE_GENLAYER_RPC_URL?: string;
  readonly VITE_GENLAYER_CHAIN_ID?: string;
  readonly VITE_GENLAYER_CHAIN_NAME?: string;
  readonly VITE_GENLAYER_SYMBOL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_RUNTIME_CASE_ID?: string;
  readonly VITE_ROLE_CASE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
