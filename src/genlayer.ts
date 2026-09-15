import { createClient } from 'genlayer-js';
import {
  GENLAYER_CHAIN,
  GENLAYER_CHAIN_ID,
  GENLAYER_CHAIN_ID_HEX,
  GENLAYER_NETWORK,
} from './network';

/**
 * Read client. Reads never need a wallet, so this is created once at module
 * load and reused; the UI can inspect finalized state with no account.
 */
export const readClient = createClient({ chain: GENLAYER_CHAIN });

export type Eip1193 = {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function getProvider(): Eip1193 | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

/**
 * Put MetaMask on the configured chain before anything is signed.
 *
 * genlayer-js skips its own chain assertion for Studio chains (`isStudio`), so
 * a wallet left on another network would otherwise sign against the wrong
 * chain id with no error surfaced. This is that missing check.
 */
export async function ensureNetwork(): Promise<void> {
  const provider = getProvider();
  if (!provider) throw new Error('No EIP-1193 wallet detected.');

  const current = (await provider.request({ method: 'eth_chainId' })) as string;
  if (typeof current === 'string' && parseInt(current, 16) === GENLAYER_CHAIN_ID) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: GENLAYER_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [GENLAYER_NETWORK] });
    } else if (code === 4001) {
      throw new Error('You declined the network switch. MeaningNonce can only write on ' + GENLAYER_NETWORK.chainName + '.');
    } else {
      throw error;
    }
  }

  const after = (await provider.request({ method: 'eth_chainId' })) as string;
  if (typeof after !== 'string' || parseInt(after, 16) !== GENLAYER_CHAIN_ID) {
    throw new Error('Wallet is not on ' + GENLAYER_NETWORK.chainName + ' (chain id ' + GENLAYER_CHAIN_ID + ').');
  }
}

export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error('No EIP-1193 wallet detected. Install MetaMask to write.');

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('Wallet returned no account.');

  await ensureNetwork();
  return accounts[0];
}

/** Show the account picker even when already connected. */
export async function switchAccount(): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error('No EIP-1193 wallet detected.');
  await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
  if (!accounts?.[0]) throw new Error('No account selected.');
  await ensureNetwork();
  return accounts[0];
}

/**
 * Every MeaningNonce view returns a JSON string, so reads are one readContract
 * plus a parse. An empty string means "not found", never an exception.
 */
export async function readJson<T>(
  address: `0x${string}`,
  functionName: string,
  args: unknown[],
): Promise<T | null> {
  const raw = await readClient.readContract({ address, functionName, args: args as never[] });
  if (typeof raw !== 'string' || raw === '') return null;
  return JSON.parse(raw) as T;
}

export async function readString(
  address: `0x${string}`,
  functionName: string,
  args: unknown[],
): Promise<string> {
  const raw = await readClient.readContract({ address, functionName, args: args as never[] });
  return String(raw ?? '');
}

/** Pull a readable message out of a revert / RPC error, including nested causes. */
export function describeChainError(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  const parts: string[] = [];

  while (current && !seen.has(current)) {
    seen.add(current);
    const message = (current as { message?: string })?.message;
    if (typeof message === 'string' && message.trim() !== '') parts.push(message.trim());
    current = (current as { cause?: unknown })?.cause;
  }

  const joined = parts.join(' — ');
  const userError = joined.match(/[A-Z][A-Z0-9_]{4,}/g);
  if (userError && userError.length > 0) {
    return userError[0] + (joined ? ' (' + joined.slice(0, 220) + ')' : '');
  }
  return joined || String(error);
}
