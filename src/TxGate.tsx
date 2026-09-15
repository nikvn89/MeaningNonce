import { useState } from 'react';
import {
  GenLayerTransactionPanel,
  describeOutcome,
  type SubmitInput,
  type TrackedStatus,
} from '@genlayer/transaction-kit-react';
import type { TransactionKit } from '@genlayer/transaction-kit';
import { GENLAYER_CHAIN_NAME } from './network';

export type PendingWrite = {
  /** Contract method, used only for operator-facing copy. */
  label: string;
  /** Must be a stable object reference: the kit re-estimates when it changes. */
  tx: SubmitInput;
  /**
   * Postcondition check, run after consensus decides. It re-reads contract
   * state and throws if the state does not match what the call claimed to do.
   * Returns the notice to display on success.
   */
  verify: (status: TrackedStatus) => Promise<string>;
};

type Props = {
  kit: TransactionKit | null;
  pending: PendingWrite;
  onVerified: (notice: string) => void;
  onFailed: (message: string) => void;
  onCancel: () => void;
};

/**
 * Wraps the Transaction Kit panel with MeaningNonce's own success rule.
 *
 * A decided transaction is NOT a success signal on its own — a failed
 * deployment still walks PENDING → PROPOSING → COMMITTING → REVEALING →
 * ACCEPTED. Nothing is reported as done until `verify` has re-read contract
 * state and found the postcondition it expected.
 */
export function TxGate({ kit, pending, onVerified, onFailed, onCancel }: Props) {
  const [phase, setPhase] = useState<'panel' | 'verifying'>('panel');

  if (!kit) {
    return (
      <div className="warningBox">
        Connect a wallet before submitting <b>{pending.label}</b>.
      </div>
    );
  }

  async function handleDone(status: TrackedStatus) {
    if (status.successful === false) {
      const outcome = describeOutcome(status.statusName, status.executionResultName);
      onFailed(`${pending.label} did not execute: ${outcome.title}. ${outcome.detail}`);
      return;
    }

    setPhase('verifying');
    try {
      onVerified(await pending.verify(status));
    } catch (error) {
      onFailed((error as Error)?.message || String(error));
    } finally {
      setPhase('panel');
    }
  }

  return (
    <div className="txGate">
      <div className="txGateHead">
        <div>
          <span className="sectionEyebrow">Fees · Consensus v0.6</span>
          <b>{pending.label}</b>
        </div>
        <button className="secondaryButton compact" onClick={onCancel} disabled={phase === 'verifying'}>
          Back to form
        </button>
      </div>

      <GenLayerTransactionPanel
        kit={kit}
        tx={pending.tx}
        network={GENLAYER_CHAIN_NAME}
        theme="dark"
        trackUntil="decided"
        onDone={handleDone}
      />

      <p className="txGateNote">
        {phase === 'verifying'
          ? 'Consensus decided. Re-reading contract state before anything is reported as done…'
          : 'A decided transaction is not a verdict. MeaningNonce re-reads contract state and only then reports success.'}
      </p>
    </div>
  );
}
