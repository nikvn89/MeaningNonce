import { useMemo } from 'react';
import { createTransactionKit, type TransactionKit } from '@genlayer/transaction-kit';
import { GENLAYER_CHAIN } from './network';
import { getProvider } from './genlayer';

/**
 * Transaction Kit instance for the connected account.
 *
 * Studio Next charges fees (Consensus v0.6), so every write goes through the
 * kit's estimate → review → sign → track flow instead of a bare writeContract.
 * The kit is rebuilt whenever the account changes so a wallet switch can never
 * sign with the previous address' quote.
 */
export function useTransactionKit(account: string | null): TransactionKit | null {
  return useMemo(() => {
    const provider = getProvider();
    if (!provider || !account || !account.startsWith('0x')) return null;

    return createTransactionKit({
      chain: GENLAYER_CHAIN,
      provider,
      account: account as `0x${string}`,
    });
  }, [account]);
}
