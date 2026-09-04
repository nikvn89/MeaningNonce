export type CaseRecord = {
  case_id: string;
  authority: string;
  case_ref: string;
  status: 'LOCKED_REJECTED' | 'AWAITING_FRESH_DECISION' | 'CLOSED_ACCEPTED';
  decision: 'REJECTED' | 'ACCEPTED';
  decision_reason: string;
  baseline_evidence: string[];
  baseline_hashes: string[];
  epoch: number;
  attempt_count: number;
  blocked_count: number;
  adjudicated: Record<string, 'IMMATERIAL_DELTA' | 'MATERIAL_DELTA'>;
  model_calls_this_epoch: number;
  budget_grants_this_epoch: number;
  latest_attempt_id: string;
  pending_attempt_id: string;
  last_decline_note: string;
  created_at: string;
  updated_at: string;
};

export type AttemptRecord = {
  attempt_id: string;
  case_id: string;
  epoch: number;
  requester: string;
  request_text: string;
  request_hash: string;
  candidate_evidence: string[];
  candidate_hashes: string[];
  candidate_key: string;
  additions: string[];
  outcome:
    | 'EXACT_REPLAY'
    | 'BASELINE_REMOVAL_BLOCKED'
    | 'ALREADY_ADJUDICATED'
    | 'RETRY_BUDGET_EXHAUSTED'
    | 'IMMATERIAL_DELTA'
    | 'MATERIAL_DELTA';
  prior_semantic_outcome: '' | 'IMMATERIAL_DELTA' | 'MATERIAL_DELTA';
  model_called: boolean;
  created_at: string;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
    };
  }
}
