export const DEFAULT_CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ||
  '0x8CB652d2a1d3E01DdD4eD1515F2c3F665c7D10b4') as `0x${string}`;

/**
 * Optional showcase case IDs.
 *
 * The previous build hardcoded two case IDs from the StudioNet (v0.2)
 * deployment. Those records do not exist on this deployment, so they are not
 * carried over: set them here only once the corresponding cases have actually
 * been created and read back on Studio Next.
 */
export const RUNTIME_CASE_ID = import.meta.env.VITE_RUNTIME_CASE_ID || '';
export const ROLE_GUARD_CASE_ID = import.meta.env.VITE_ROLE_CASE_ID || '';
