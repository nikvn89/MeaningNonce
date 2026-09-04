import { useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_CONTRACT_ADDRESS, STUDIONET_EXPLORER_URL } from './config';
import { connectWallet, readJson, readString, writeAndFinalize } from './genlayer';
import type { AttemptRecord, CaseRecord } from './types';

const linesToJson = (value: string) => JSON.stringify(value.split('\n').map((x) => x.trim()).filter(Boolean));
const short = (value: string) => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—';

function App() {
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT_ADDRESS);
  const [account, setAccount] = useState('');
  const [walletClient, setWalletClient] = useState<any>(null);
  const [tab, setTab] = useState<'seed'|'retry'|'resolve'|'inspect'>('seed');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('StudioNet runtime deployment loaded. Connect a wallet or inspect a finalized case.');
  const [txHash, setTxHash] = useState('');
  const [caseData, setCaseData] = useState<CaseRecord | null>(null);
  const [attemptData, setAttemptData] = useState<AttemptRecord | null>(null);

  const [caseRef, setCaseRef] = useState('agent-case-104');
  const [reason, setReason] = useState('The previous request was rejected because the submitted evidence did not establish the required condition.');
  const [seedEvidence, setSeedEvidence] = useState('Original evidence item A\nOriginal evidence item B');

  const [caseId, setCaseId] = useState('');
  const [requestText, setRequestText] = useState('Please reconsider this request with the evidence below.');
  const [retryEvidence, setRetryEvidence] = useState('Original evidence item A\nOriginal evidence item B\nNew evidence item C');

  const [freshDecision, setFreshDecision] = useState<'REJECTED'|'ACCEPTED'>('REJECTED');
  const [freshReason, setFreshReason] = useState('Fresh upstream decision after reviewing the reopened case.');
  const [freshEvidence, setFreshEvidence] = useState('Original evidence item A\nOriginal evidence item B\nNew evidence item C');
  const [declineNote, setDeclineNote] = useState('The reopened evidence does not justify adopting a new upstream baseline.');
  const [attemptId, setAttemptId] = useState('');

  const validAddress = useMemo(() => /^0x[a-fA-F0-9]{40}$/.test(contractAddress), [contractAddress]);
  const isAuthority = !!account && !!caseData?.authority && account.toLowerCase() === caseData.authority.toLowerCase();

  async function withWrite(name: string, args: unknown[]) {
    if (!walletClient || !account) throw new Error('Connect a wallet first.');
    if (!validAddress) throw new Error('Enter a deployed MeaningNonce contract address.');
    setBusy(true); setTxHash(''); setNotice(`Submitting ${name}…`);
    try {
      const result = await writeAndFinalize(walletClient, contractAddress as `0x${string}`, name, args, (h) => {
        setTxHash(h); setNotice(`Submitted ${short(h)} — waiting for finalization…`);
      });
      setNotice(`${name} finalized. Verifying durable contract state…`);
      return result;
    } finally { setBusy(false); }
  }

  async function onConnect() {
    setBusy(true);
    try {
      const connected = await connectWallet();
      setAccount(connected.account); setWalletClient(connected.client);
      setNotice(`Wallet ${short(connected.account)} connected to Studionet.`);
    } catch (e:any) { setNotice(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  async function seed() {
    try {
      const derived = await readString(contractAddress as `0x${string}`, 'derive_case_id', [account, caseRef]);
      const existing = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [derived]);
      if (existing) throw new Error('This authority + case reference already exists; refusing a duplicate seed.');
      await withWrite('seed_rejected_case', [caseRef, reason, linesToJson(seedEvidence)]);
      const nextCase = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [derived]);
      if (!nextCase || nextCase.authority.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Finalized seed did not produce the expected on-chain case.');
      }
      setCaseId(derived); setTab('inspect'); setCaseData(nextCase);
      setNotice('Seed verified in finalized contract state.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function retry() {
    try {
      const before = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!before) throw new Error('Case not found in finalized state.');
      const previousAttempt = before.latest_attempt_id || '';
      const previousCount = before.attempt_count;
      await withWrite('submit_retry', [caseId, requestText, linesToJson(retryEvidence)]);
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!c?.latest_attempt_id || c.latest_attempt_id === previousAttempt || c.attempt_count !== previousCount + 1) {
        throw new Error('Finalized retry did not create exactly one new on-chain attempt.');
      }
      const a = await readJson<AttemptRecord>(contractAddress as `0x${string}`, 'get_attempt', [c.latest_attempt_id]);
      if (!a || a.requester.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Latest on-chain attempt is not bound to the connected requester.');
      }
      setCaseData(c); setAttemptId(c.latest_attempt_id); setAttemptData(a); setTab('inspect');
      setNotice(`Retry verified on-chain: ${a.outcome}; model_called=${String(a.model_called)}.`);
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function resolve() {
    try {
      await withWrite('record_fresh_decision', [caseId, freshDecision, freshReason, linesToJson(freshEvidence)]);
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      const expectedStatus = freshDecision === 'ACCEPTED' ? 'CLOSED_ACCEPTED' : 'LOCKED_REJECTED';
      if (!c || c.decision !== freshDecision || c.status !== expectedStatus || c.pending_attempt_id !== '') {
        throw new Error('Finalized fresh decision did not produce the expected on-chain state.');
      }
      setCaseData(c); setTab('inspect'); setNotice(`Fresh ${freshDecision} decision verified on-chain.`);
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function grantBudget() {
    try {
      const before = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!before || before.model_calls_this_epoch <= 0) throw new Error('No consumed semantic-call budget to reset.');
      await withWrite('grant_retry_budget', [caseId]);
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!c || c.model_calls_this_epoch !== 0 || c.status !== 'LOCKED_REJECTED' || c.budget_grants_this_epoch !== before.budget_grants_this_epoch + 1) {
        throw new Error('Finalized budget grant did not produce the expected on-chain state.');
      }
      setCaseData(c);
      setNotice('Budget grant verified on-chain. Previously adjudicated evidence sets remain blocked and grants are bounded per epoch.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function decline() {
    try {
      await withWrite('decline_reopening', [caseId, declineNote]);
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!c || c.status !== 'LOCKED_REJECTED' || c.pending_attempt_id !== '') {
        throw new Error('Finalized decline did not restore the prior locked state.');
      }
      setCaseData(c); setTab('inspect'); setNotice('Reopening decline verified on-chain; prior baseline remains active.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function inspect() {
    if (!validAddress || !caseId) return;
    setBusy(true);
    try {
      setCaseData(await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]));
      if (attemptId) setAttemptData(await readJson<AttemptRecord>(contractAddress as `0x${string}`, 'get_attempt', [attemptId]));
      setNotice('Loaded latest finalized state.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><div className="mark">MN</div><div><b>MeaningNonce</b><span>semantic anti-verdict-shopping</span></div></div>
      <button className="wallet" onClick={onConnect} disabled={busy}>{account ? short(account) : 'Connect wallet'}</button>
    </header>

    <section className="hero">
      <div>
        <div className="eyebrow">AGENT TANK BUILD · STUDIONET RUNTIME</div>
        <h1>Changing the wording<br/><em>is not a new case.</em></h1>
        <p>An AI agent can keep rewriting a rejected request until one version gets through. MeaningNonce remembers the previous decision and evidence on-chain, blocks unchanged retries deterministically, and asks GenLayer only whether genuinely new evidence is material enough to reopen.</p>
        <div className="principles"><span>① no AI court</span><span>② no external truth oracle</span><span>③ request wording never enters the gate</span></div>
      </div>
      <div className="fingerprint" aria-hidden="true"><i/><i/><i/><i/><b>meaning<br/>≠ wording</b></div>
    </section>

    <section className="contractbar">
      <label>Contract address <input value={contractAddress} onChange={e=>setContractAddress(e.target.value as any)} placeholder="0x… StudioNet contract"/></label>
      <span className={validAddress ? 'dot ok':'dot'}>{validAddress ? 'studionet ready' : 'address required'}</span>
    <a className="explorerLink" href={STUDIONET_EXPLORER_URL} target="_blank" rel="noreferrer">Open deployed contract in Explorer ↗</a>
    </section>

    <nav className="tabs">
      {(['seed','retry','resolve','inspect'] as const).map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x}</button>)}
    </nav>

    <section className="workspace">
      <div className="panel">
        {tab==='seed' && <>
          <h2>Seed a rejected case</h2><p className="muted">The connected wallet becomes the decision authority for this case reference.</p>
          <Field label="Case reference"><input value={caseRef} onChange={e=>setCaseRef(e.target.value)}/></Field>
          <Field label="Recorded rejection reason"><textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field>
          <Field label="Baseline evidence · one item per line"><textarea className="tall" value={seedEvidence} onChange={e=>setSeedEvidence(e.target.value)}/></Field>
          <button className="primary" disabled={busy} onClick={seed}>Seed rejected case</button>
        </>}
        {tab==='retry' && <>
          <h2>Submit a retry</h2><p className="muted">Request wording is stored for audit, but it is not part of the semantic decision input.</p>
          <Field label="Case ID"><input value={caseId} onChange={e=>setCaseId(e.target.value)}/></Field>
          <Field label="Reworded request"><textarea value={requestText} onChange={e=>setRequestText(e.target.value)}/></Field>
          <Field label="Full candidate evidence · one item per line"><textarea className="tall" value={retryEvidence} onChange={e=>setRetryEvidence(e.target.value)}/></Field>
          <div className="actions"><button className="primary" disabled={busy || isAuthority} onClick={retry}>Run MeaningNonce gate</button><button className="secondary" disabled={busy || !caseId || !isAuthority || caseData?.status !== 'LOCKED_REJECTED' || (caseData?.model_calls_this_epoch ?? 0) < 3 || (caseData?.budget_grants_this_epoch ?? 0) >= 5} onClick={grantBudget}>Authority · grant more budget</button></div>
          <p className="muted">Each budget window allows three distinct evidence sets to reach consensus, with at most five authority grants per epoch. Re-submitting an already adjudicated set never calls the model again. The decision-authority wallet cannot submit retries against its own case.</p>
        </>}
        {tab==='resolve' && <>
          <h2>Record fresh upstream decision</h2><p className="muted">Authority-only. Available only after a MATERIAL_DELTA reopened the case.</p>
          <Field label="Case ID"><input value={caseId} onChange={e=>setCaseId(e.target.value)}/></Field>
          <Field label="Decision"><select value={freshDecision} onChange={e=>setFreshDecision(e.target.value as any)}><option>REJECTED</option><option>ACCEPTED</option></select></Field>
          <Field label="Decision reason"><textarea value={freshReason} onChange={e=>setFreshReason(e.target.value)}/></Field>
          <Field label="Evidence reviewed · must match reopened attempt"><textarea className="tall" value={freshEvidence} onChange={e=>setFreshEvidence(e.target.value)}/></Field>
          <div className="actions"><button className="primary" disabled={busy || !isAuthority || caseData?.status !== 'AWAITING_FRESH_DECISION'} onClick={resolve}>Record fresh decision</button></div>
          <Field label="Or decline the reopening · authority only"><textarea value={declineNote} onChange={e=>setDeclineNote(e.target.value)}/></Field>
          <button className="secondary" disabled={busy || !isAuthority || caseData?.status !== 'AWAITING_FRESH_DECISION'} onClick={decline}>Decline reopening · keep prior baseline</button>
        </>}
        {tab==='inspect' && <>
          <h2>Inspect finalized state</h2>
          <Field label="Case ID"><input value={caseId} onChange={e=>setCaseId(e.target.value)}/></Field>
          <Field label="Attempt ID · optional"><input value={attemptId} onChange={e=>setAttemptId(e.target.value)}/></Field>
          <button className="primary" disabled={busy} onClick={inspect}>Refresh finalized state</button>
        </>}
      </div>

      <aside className="rail">
        <div className="statusCard"><span>runtime</span><b>{notice}</b>{txHash && <code>{txHash}</code>}</div>
        <div className="stateCard">
          <div className="cardTitle">Case state</div>
          {caseData ? <>
            <Pill value={caseData.status}/>
            <dl><dt>authority</dt><dd>{short(caseData.authority)}</dd><dt>epoch</dt><dd>{caseData.epoch}</dd><dt>attempts</dt><dd>{caseData.attempt_count}</dd><dt>blocked</dt><dd>{caseData.blocked_count}</dd><dt>model budget</dt><dd>{caseData.model_calls_this_epoch}/3 used</dd><dt>budget grants</dt><dd>{caseData.budget_grants_this_epoch}/5 used</dd><dt>baseline</dt><dd>{caseData.baseline_evidence.length} items</dd></dl>
            <p className="reason">{caseData.decision_reason}</p>{caseData.last_decline_note && <p className="reason">Last reopen decline: {caseData.last_decline_note}</p>}
          </> : <p className="muted">Load a case to see its semantic nonce.</p>}
        </div>
        <div className="stateCard">
          <div className="cardTitle">Latest attempt</div>
          {attemptData ? <>
            <Pill value={attemptData.outcome}/>
            <dl><dt>requester</dt><dd>{short(attemptData.requester)}</dd><dt>model called</dt><dd>{String(attemptData.model_called)}</dd><dt>new delta</dt><dd>{attemptData.additions.length} items</dd>{attemptData.prior_semantic_outcome && <><dt>prior result</dt><dd>{attemptData.prior_semantic_outcome}</dd></>}</dl>
          </> : <p className="muted">Exact replay should show model called = false.</p>}
        </div>
      </aside>
    </section>

    <footer><b>MeaningNonce</b><span>Traditional nonces protect bytes. MeaningNonce protects the meaning boundary.</span></footer>
  </main>
}

function Field({label, children}:{label:string, children:ReactNode}) { return <label className="field"><span>{label}</span>{children}</label> }
function Pill({value}:{value:string}) { return <span className={`pill ${value.includes('MATERIAL') && !value.includes('IMMATERIAL') ? 'hot':''}`}>{value}</span> }
export default App;
