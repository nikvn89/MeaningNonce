import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant, TransactionStatus } from 'genlayer-js/types';

export const readClient = createClient({ chain: studionet });

export async function connectWallet() {
  if (!window.ethereum) throw new Error('No EIP-1193 wallet detected.');
  const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.[0]) throw new Error('Wallet returned no account.');
  const account = accounts[0] as `0x${string}`;
  const client = createClient({ chain: studionet, account, provider: window.ethereum as any });

  // Fail closed, but classify Studio/network connection failures clearly so they
  // are not confused with contract execution errors.
  try {
    await client.connect('studionet');
  } catch (error: any) {
    throw new Error(
      'Could not confirm the Studionet connection. Studio rate limiting or CORS may surface as "Failed to fetch"; this is not a contract verdict. ' +
      `Underlying: ${error?.message ?? String(error)}`,
    );
  }
  return { account, client };
}

export async function readJson<T>(address: `0x${string}`, functionName: string, args: unknown[]) {
  const raw = await readClient.readContract({
    address,
    functionName,
    args: args as any[],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (typeof raw !== 'string' || raw === '') return null;
  return JSON.parse(raw) as T;
}

export async function readString(address: `0x${string}`, functionName: string, args: unknown[]) {
  const raw = await readClient.readContract({
    address,
    functionName,
    args: args as any[],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return String(raw ?? '');
}

export async function writeAndFinalize(
  client: any,
  address: `0x${string}`,
  functionName: string,
  args: unknown[],
  onHash?: (hash: string) => void,
) {
  let hash: string;
  try {
    const submitted = await client.writeContract({ address, functionName, args: args as any[] });
    if (typeof submitted !== 'string' || !submitted) throw new Error('writeContract returned no transaction id.');
    hash = submitted;
  } catch (error) {
    // No transaction id: wallet/signing/RPC/submission failure. Never label this
    // as a contract revert.
    throw error;
  }

  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 4000,
    retries: 40,
  });

  // FINALIZED alone is not a success verdict. If the SDK/runtime publishes the
  // documented execution enum, a non-return outcome is a contract execution
  // failure. When Studio omits the enum, callers must verify a state postcondition
  // before displaying success.
  const execution = receipt?.txExecutionResultName ?? null;
  if (execution && execution !== 'FINISHED_WITH_RETURN') {
    throw new Error(`Contract execution failed: ${execution}`);
  }

  return { hash, receipt, executionVerified: execution === 'FINISHED_WITH_RETURN' };
}
