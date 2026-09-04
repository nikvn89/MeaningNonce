import { useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_CONTRACT_ADDRESS } from './config';
import { connectWallet, readJson, readString, writeAndFinalize } from './genlayer';
import type { AttemptRecord, CaseRecord } from './types';

const linesToJson = (value: string) => JSON.stringify(value.split('\n').map((x) => x.trim()).filter(Boolean));
const short = (value: string) => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—';
const MAIN_RUNTIME_CASE = 'fcbab56d34ba7520125cc205bf4b1ab392d20d5ac7b0827b32d7b63df5e6bc95';
const ROLE_GUARD_CASE = '6f1bc3dcd447849d1aeed5ce9021c6df989792bbf3d6ac9955f38c028023595f';

type Page = 'overview' | 'seed' | 'retry' | 'resolve' | 'inspect' | 'evidence';
type ScanPhase = 'idle' | 'scanning' | 'finalized';

function App() {
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT_ADDRESS);
  const [account, setAccount] = useState('');
  const [walletClient, setWalletClient] = useState<any>(null);
  const [page, setPage] = useState<Page>('overview');
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
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanBaseline, setScanBaseline] = useState<string[]>([]);
  const [scanCandidate, setScanCandidate] = useState<string[]>([]);
  const [scanResult, setScanResult] = useState<AttemptRecord | null>(null);

  const validAddress = useMemo(() => /^0x[a-fA-F0-9]{40}$/.test(contractAddress), [contractAddress]);
  const loadedCaseMatches = !!caseData && !!caseId && caseData.case_id === caseId;
  const isAuthority = loadedCaseMatches && !!account && !!caseData?.authority && account.toLowerCase() === caseData.authority.toLowerCase();
  const retryStatus = loadedCaseMatches ? caseData.status : null;
  const retryReady = retryStatus === 'LOCKED_REJECTED';
  const retryClosed = retryStatus === 'CLOSED_ACCEPTED';
  const retryAwaiting = retryStatus === 'AWAITING_FRESH_DECISION';
  const retryFormLocked = retryClosed || retryAwaiting;
  const explorerUrl = `https://explorer-studio.genlayer.com/address/${contractAddress}`;

  async function copy(value: string) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setNotice('Copy failed. Select the value manually.'); }
  }

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
      if (!account) throw new Error('Connect the authority wallet before seeding a case.');
      const derived = await readString(contractAddress as `0x${string}`, 'derive_case_id', [account, caseRef]);
      const existing = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [derived]);
      if (existing) throw new Error('This authority + case reference already exists; refusing a duplicate seed.');
      await withWrite('seed_rejected_case', [caseRef, reason, linesToJson(seedEvidence)]);
      const nextCase = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [derived]);
      if (!nextCase || nextCase.authority.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Finalized seed did not produce the expected on-chain case.');
      }
      setCaseId(derived); setCaseData(nextCase); setAttemptData(null); setPage('inspect');
      setNotice('Seed verified in finalized contract state.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function retry() {
    try {
      if (!caseId) throw new Error('Enter a case ID first.');
      const before = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      if (!before) throw new Error('Case not found in finalized state.');
      const candidate = retryEvidence.split('\n').map((x) => x.trim()).filter(Boolean);
      setScanBaseline(before.baseline_evidence);
      setScanCandidate(candidate);
      setScanResult(null);
      setScanPhase('scanning');
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
      setCaseData(c); setAttemptId(c.latest_attempt_id); setAttemptData(a);
      setScanBaseline(c.baseline_evidence);
      setScanCandidate(a.candidate_evidence);
      setScanResult(a);
      setScanPhase('finalized');
      setNotice(`Retry verified on-chain: ${a.outcome}; model_called=${String(a.model_called)}.`);
    } catch (e:any) {
      setScanPhase('idle'); setScanResult(null);
      setNotice(e?.message || String(e));
    }
  }

  async function resolve() {
    try {
      if (!caseId) throw new Error('Enter a case ID first.');
      await withWrite('record_fresh_decision', [caseId, freshDecision, freshReason, linesToJson(freshEvidence)]);
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [caseId]);
      const expectedStatus = freshDecision === 'ACCEPTED' ? 'CLOSED_ACCEPTED' : 'LOCKED_REJECTED';
      if (!c || c.decision !== freshDecision || c.status !== expectedStatus || c.pending_attempt_id !== '') {
        throw new Error('Finalized fresh decision did not produce the expected on-chain state.');
      }
      setCaseData(c); setPage('inspect'); setNotice(`Fresh ${freshDecision} decision verified on-chain.`);
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
      setCaseData(c); setPage('inspect'); setNotice('Reopening decline verified on-chain; prior baseline remains active.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
  }

  async function inspect(targetCaseId = caseId, targetAttemptId = attemptId, hydrateRetry = false) {
    if (!validAddress || !targetCaseId) { setNotice('Enter a case ID to inspect.'); return; }
    setBusy(true);
    try {
      const c = await readJson<CaseRecord>(contractAddress as `0x${string}`, 'get_case', [targetCaseId]);
      if (!c) throw new Error('Case not found in finalized state.');
      setCaseId(targetCaseId); setCaseData(c);
      if (hydrateRetry) {
        const baselineText = c.baseline_evidence.join('\n');
        setRetryEvidence(baselineText);
        setScanBaseline(c.baseline_evidence);
        setScanCandidate([]);
        setScanResult(null);
        setScanPhase('idle');
      }
      const inspectAttemptId = targetAttemptId || c.latest_attempt_id || '';
      if (inspectAttemptId) {
        const a = await readJson<AttemptRecord>(contractAddress as `0x${string}`, 'get_attempt', [inspectAttemptId]);
        setAttemptId(inspectAttemptId); setAttemptData(a);
      } else {
        setAttemptData(null); setAttemptId('');
      }
      setNotice('Loaded latest finalized state.');
    } catch (e:any) { setNotice(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  function openRuntimeCase(id: string) {
    setCaseId(id); setAttemptId(''); setPage('inspect');
    void inspect(id, '');
  }

  function openRetryPage() {
    if (caseData && caseId && caseData.case_id === caseId) {
      setRetryEvidence(caseData.baseline_evidence.join('\n'));
      setScanBaseline(caseData.baseline_evidence);
      setScanCandidate([]);
      setScanResult(null);
      setScanPhase('idle');
    }
    setPage('retry');
  }

  return <div className="appFrame">
    <header className="topbar">
      <button className="brandButton" onClick={() => setPage('overview')} aria-label="MeaningNonce overview">
        <img src="/logo.png" alt="MeaningNonce logo" />
        <span><b>Meaning<span>Nonce</span></b><small>Semantic anti-verdict-shopping</small></span>
      </button>
      <div className="topActions">
        <div className="contractMini">
          <span className={validAddress ? 'liveDot on' : 'liveDot'} />
          <div><small>Contract</small><b>{short(contractAddress)}</b></div>
          <button className="iconButton" onClick={() => copy(contractAddress)} aria-label="Copy contract address">⧉</button>
          <a className="iconButton" href={explorerUrl} target="_blank" rel="noreferrer" aria-label="Open Explorer">↗</a>
        </div>
        <button className="walletButton" onClick={onConnect} disabled={busy}>
          <span className="walletIcon">▣</span>{account ? short(account) : 'Connect wallet'}
        </button>
      </div>
    </header>

    <aside className="sidebar">
      <NavButton active={page==='overview'} icon="⌂" label="Overview" onClick={() => setPage('overview')} />
      <NavButton active={page==='seed'} icon="▤" label="Seed Case" onClick={() => setPage('seed')} />
      <NavButton active={page==='retry'} icon="➤" label="Submit Retry" onClick={openRetryPage} />
      <NavButton active={page==='resolve'} icon="◇" label="Resolve" onClick={() => setPage('resolve')} />
      <NavButton active={page==='inspect'} icon="⌕" label="Inspect Cases" onClick={() => setPage('inspect')} />
      <NavButton active={page==='evidence'} icon="</>" label="Runtime Proof" onClick={() => setPage('evidence')} />
      <div className="sidebarSpacer" />
      <div className="helpCard">
        <b>Need help?</b>
        <p>MeaningNonce blocks reworded retries when the evidence has not meaningfully changed.</p>
        <button onClick={() => setPage('overview')}>How it works</button>
      </div>
    </aside>

    <main className="content">
      <RuntimeBanner notice={notice} txHash={txHash} busy={busy} />
      {page === 'overview' && <Overview
        contractAddress={contractAddress}
        validAddress={validAddress}
        explorerUrl={explorerUrl}
        onOpenSeed={() => setPage('seed')}
        onOpenRetry={openRetryPage}
        onOpenResolve={() => setPage('resolve')}
        onRuntimeCase={() => openRuntimeCase(MAIN_RUNTIME_CASE)}
      />}
      {page === 'seed' && <PageLayout
        title="Seed a rejected case"
        subtitle="Record the original rejection and its baseline evidence. The connected wallet becomes the decision authority."
        aside={<SideState caseData={caseData} attemptData={attemptData} account={account} />}
      >
        <StepHint number="1" title="Connect the authority wallet" body="The connected wallet will own the decision lifecycle for this case reference." done={!!account}/>
        <Field label="Case reference" hint="Use a short unique ID for this case."><input value={caseRef} onChange={e=>setCaseRef(e.target.value)}/></Field>
        <Field label="Recorded rejection reason" hint="What was the original decision and why?"><textarea value={reason} onChange={e=>setReason(e.target.value)}/></Field>
        <Field label="Baseline evidence" hint="One evidence item per line."><textarea className="tall" value={seedEvidence} onChange={e=>setSeedEvidence(e.target.value)}/></Field>
        <button className="primaryButton" disabled={busy || !account} onClick={seed}>Seed rejected case</button>
        <p className="actionNote">🔒 This action is recorded on-chain and becomes the baseline for future retries.</p>
      </PageLayout>}

      {page === 'retry' && <PageLayout
        title="Submit a retry"
        subtitle="Use the full candidate evidence set. Rewording alone never creates a fresh semantic adjudication."
        aside={<SideState caseData={caseData} attemptData={attemptData} account={account} />}
      >
        <CaseLoader caseId={caseId} setCaseId={(value) => { setCaseId(value); if (value !== caseData?.case_id) { setCaseData(null); setAttemptData(null); setScanPhase('idle'); setScanBaseline([]); setScanCandidate([]); setScanResult(null); } }} busy={busy} onLoad={() => { setScanPhase('idle'); setScanResult(null); void inspect(caseId, '', true); }}/>
        <Field label="Reworded request" hint="Stored for audit only. This text does not enter the semantic gate."><textarea disabled={retryFormLocked} value={requestText} onChange={e=>setRequestText(e.target.value)}/></Field>
        <Field label={retryClosed ? "Final baseline evidence" : "Full candidate evidence"} hint={retryClosed ? "Final accepted baseline loaded from finalized contract state." : retryReady ? "Current baseline is prefilled. Append only genuinely new evidence; do not remove baseline items." : "Load a rejected case to prefill its complete baseline evidence."}><textarea className="tall" disabled={retryFormLocked} value={loadedCaseMatches && retryFormLocked ? caseData?.baseline_evidence.join('\n') || '' : retryEvidence} onChange={e=>setRetryEvidence(e.target.value)}/></Field>
        <SemanticBoundaryScan
          phase={scanPhase}
          requestText={requestText}
          baseline={scanBaseline.length ? scanBaseline : (loadedCaseMatches ? caseData?.baseline_evidence || [] : [])}
          candidate={scanCandidate.length ? scanCandidate : (loadedCaseMatches && retryFormLocked ? caseData?.baseline_evidence || [] : retryEvidence.split('\n').map((x) => x.trim()).filter(Boolean))}
          result={scanResult}
          caseStatus={retryStatus}
          onInspect={() => setPage('inspect')}
        />
        <div className="buttonRow">
          <button className="primaryButton" disabled={busy || !account || !caseId || !retryReady || isAuthority} onClick={retry}>{retryClosed ? 'Case closed' : retryAwaiting ? 'Awaiting fresh decision' : 'Run MeaningNonce gate'}</button>
          <button className="secondaryButton" disabled={busy || !caseId || !isAuthority || !retryReady || (caseData?.model_calls_this_epoch ?? 0) < 3 || (caseData?.budget_grants_this_epoch ?? 0) >= 5} onClick={grantBudget}>Authority · grant retry budget</button>
        </div>
        {retryClosed ? <div className="terminalBox"><b>This case is CLOSED_ACCEPTED.</b><span>No further retries are allowed.</span></div> : retryAwaiting ? <div className="pendingBox"><b>This case is AWAITING_FRESH_DECISION.</b><span>The retry gate is paused until the authority records or declines the fresh decision.</span></div> : isAuthority ? <div className="warningBox">The connected wallet is this case's authority. Authorities cannot submit retries against their own rejected case.</div> : null}
      </PageLayout>}

      {page === 'resolve' && <PageLayout
        title="Resolve a reopened case"
        subtitle="Authority-only. A fresh decision is available only after a MATERIAL_DELTA moved the case to AWAITING_FRESH_DECISION."
        aside={<SideState caseData={caseData} attemptData={attemptData} account={account} />}
      >
        <CaseLoader caseId={caseId} setCaseId={setCaseId} busy={busy} onLoad={() => inspect(caseId, '')}/>
        <div className="decisionGrid">
          <button className={freshDecision==='REJECTED' ? 'decisionCard selected' : 'decisionCard'} onClick={()=>setFreshDecision('REJECTED')}><b>REJECTED</b><span>Adopt the reopened evidence as the new rejection baseline.</span></button>
          <button className={freshDecision==='ACCEPTED' ? 'decisionCard selected accept' : 'decisionCard'} onClick={()=>setFreshDecision('ACCEPTED')}><b>ACCEPTED</b><span>Close the case. Future retries are not allowed.</span></button>
        </div>
        <Field label="Decision reason"><textarea value={freshReason} onChange={e=>setFreshReason(e.target.value)}/></Field>
        <Field label="Evidence reviewed" hint="Must match the reopened MATERIAL_DELTA attempt exactly."><textarea className="tall" value={freshEvidence} onChange={e=>setFreshEvidence(e.target.value)}/></Field>
        <button className="primaryButton" disabled={busy || !isAuthority || caseData?.status !== 'AWAITING_FRESH_DECISION'} onClick={resolve}>Record fresh {freshDecision.toLowerCase()} decision</button>
        <div className="divider"><span>or keep the prior baseline</span></div>
        <Field label="Decline note"><textarea value={declineNote} onChange={e=>setDeclineNote(e.target.value)}/></Field>
        <button className="secondaryButton" disabled={busy || !isAuthority || caseData?.status !== 'AWAITING_FRESH_DECISION'} onClick={decline}>Decline reopening</button>
      </PageLayout>}

      {page === 'inspect' && <PageLayout
        title="Inspect finalized state"
        subtitle="Load a case and its latest attempt directly from StudioNet finalized state."
        aside={<InspectorHelp onRuntimeCase={() => openRuntimeCase(MAIN_RUNTIME_CASE)} onRoleCase={() => openRuntimeCase(ROLE_GUARD_CASE)} />}
      >
        <CaseLoader caseId={caseId} setCaseId={setCaseId} busy={busy} onLoad={() => inspect(caseId, attemptId)}/>
        <Field label="Attempt ID" hint="Optional. Leave blank to load the latest attempt."><input value={attemptId} onChange={e=>setAttemptId(e.target.value)}/></Field>
        <button className="primaryButton" disabled={busy || !caseId} onClick={()=>inspect(caseId, attemptId)}>Refresh finalized state</button>
        <div className="inspectGrid">
          <CaseDetail caseData={caseData} onCopy={copy}/>
          <AttemptDetail attemptData={attemptData} onCopy={copy}/>
        </div>
      </PageLayout>}

      {page === 'evidence' && <RuntimeEvidence onRuntimeCase={() => openRuntimeCase(MAIN_RUNTIME_CASE)} onRoleCase={() => openRuntimeCase(ROLE_GUARD_CASE)} />}
    </main>
  </div>
}

function Overview({contractAddress, validAddress, explorerUrl, onOpenSeed, onOpenRetry, onOpenResolve, onRuntimeCase}:{contractAddress:string;validAddress:boolean;explorerUrl:string;onOpenSeed:()=>void;onOpenRetry:()=>void;onOpenResolve:()=>void;onRuntimeCase:()=>void}) {
  return <>
    <section className="overviewHero card">
      <img className="heroLogo" src="/logo.png" alt="MeaningNonce logo"/>
      <div className="heroCopy">
        <span className="kicker">GENLAYER · STUDIONET RUNTIME</span>
        <h1>Semantic anti-verdict shopping</h1>
        <h2>Changing the wording is <em>not a new case.</em></h2>
        <p>MeaningNonce remembers a rejected decision and its evidence on-chain. Unchanged retries are blocked deterministically; only genuinely new evidence can reach the bounded materiality gate.</p>
        <div className="trustRow"><span>✓ No AI court</span><span>✓ No external truth oracle</span><span>✓ Request wording excluded from the gate</span></div>
      </div>
      <div className="deploymentCard">
        <div className="deploymentHead"><span>Connected contract</span><b className={validAddress?'ready':'notReady'}>{validAddress ? 'Ready' : 'Invalid'}</b></div>
        <code>{contractAddress}</code>
        <div className="deploymentFoot"><span><i className="liveDot on"/> Studionet</span><a href={explorerUrl} target="_blank" rel="noreferrer">View on Explorer ↗</a></div>
      </div>
    </section>

    <section className="flowStrip card">
      <FlowStep number="1" title="Seed rejected case" body="Record the rejection and baseline evidence." onClick={onOpenSeed}/>
      <span className="flowArrow">›</span>
      <FlowStep number="2" title="Submit retry" body="Rewording is ignored; evidence delta is checked." onClick={onOpenRetry}/>
      <span className="flowArrow">›</span>
      <FlowStep number="3" title="Authority resolves" body="Material evidence may receive a fresh decision." onClick={onOpenResolve}/>
    </section>

    <section className="overviewGrid">
      <div className="card infoCard">
        <span className="sectionEyebrow">What gets blocked</span>
        <h3>Same evidence, different wording.</h3>
        <p>Exact replay, reordering, duplicate items, and baseline-removal attempts do not buy a new semantic verdict.</p>
        <div className="outcomeList"><span>EXACT_REPLAY</span><span>BASELINE_REMOVAL_BLOCKED</span><span>ALREADY_ADJUDICATED</span></div>
      </div>
      <div className="card infoCard">
        <span className="sectionEyebrow">What can reopen</span>
        <h3>A genuinely new material delta.</h3>
        <p>GenLayer validators answer one narrow question: is the explicit new evidence material enough to reopen the recorded rejection?</p>
        <div className="outcomeList"><span>IMMATERIAL_DELTA</span><span className="material">MATERIAL_DELTA</span></div>
      </div>
      <div className="card infoCard runtimeQuick">
        <span className="sectionEyebrow">Runtime proof</span>
        <h3>Verified on StudioNet.</h3>
        <p>The final deployment exercised replay blocking, evidence binding, epoch reset, terminal acceptance, and authority-role guards.</p>
        <button className="textButton" onClick={onRuntimeCase}>Open verified demo case →</button>
      </div>
    </section>
  </>
}

function PageLayout({title, subtitle, children, aside}:{title:string;subtitle:string;children:ReactNode;aside:ReactNode}) {
  return <>
    <div className="pageHeading"><div><span className="kicker">MEANINGNONCE WORKSPACE</span><h1>{title}</h1><p>{subtitle}</p></div></div>
    <div className="pageGrid"><section className="card formCard">{children}</section><aside className="sideColumn">{aside}</aside></div>
  </>
}

function RuntimeBanner({notice, txHash, busy}:{notice:string;txHash:string;busy:boolean}) {
  return <div className={busy ? 'runtimeBanner busy' : 'runtimeBanner'}><span className="runtimePulse"/><b>{busy ? 'Working' : 'Runtime'}</b><p>{notice}</p>{txHash && <code>{short(txHash)}</code>}</div>
}

function CaseLoader({caseId,setCaseId,busy,onLoad}:{caseId:string;setCaseId:(v:string)=>void;busy:boolean;onLoad:()=>void}) {
  return <div className="caseLoader"><label><span>Case ID</span><input value={caseId} onChange={e=>setCaseId(e.target.value)} placeholder="Paste a finalized case ID"/></label><button className="secondaryButton compact" disabled={busy || !caseId} onClick={onLoad}>Load case</button></div>
}

function SideState({caseData, attemptData, account}:{caseData:CaseRecord|null;attemptData:AttemptRecord|null;account:string}) {
  const role = caseData && account ? (caseData.authority.toLowerCase() === account.toLowerCase() ? 'Decision authority' : 'Requester / viewer') : 'No role loaded';
  return <>
    <div className="card sideCard"><span className="sectionEyebrow">Current case</span>{caseData ? <><Pill value={caseData.status}/><div className="metricGrid"><Metric label="Epoch" value={String(caseData.epoch)}/><Metric label="Attempts" value={String(caseData.attempt_count)}/><Metric label="Blocked" value={String(caseData.blocked_count)}/><Metric label="Model calls" value={`${caseData.model_calls_this_epoch}/3`}/></div><p className="sideNote">Role: <b>{role}</b></p></> : <p className="emptyState">Load a case to see status, role, and retry budget.</p>}</div>
    <div className="card sideCard"><span className="sectionEyebrow">Latest attempt</span>{attemptData ? <><Pill value={attemptData.outcome}/><div className="metricGrid"><Metric label="Model called" value={attemptData.model_called ? 'Yes':'No'}/><Metric label="New evidence" value={String(attemptData.additions.length)}/></div></> : <p className="emptyState">No attempt loaded yet.</p>}</div>
  </>
}

function InspectorHelp({onRuntimeCase,onRoleCase}:{onRuntimeCase:()=>void;onRoleCase:()=>void}) {
  return <div className="card sideCard"><span className="sectionEyebrow">Verified examples</span><h3>Runtime cases</h3><button className="exampleLink" onClick={onRuntimeCase}>Main anti-verdict-shopping flow <span>→</span></button><button className="exampleLink" onClick={onRoleCase}>Authority role-guard case <span>→</span></button><p className="sideNote">Both case IDs come from the final StudioNet deployment.</p></div>
}

function RuntimeEvidence({onRuntimeCase,onRoleCase}:{onRuntimeCase:()=>void;onRoleCase:()=>void}) {
  const gates = [
    ['Exact replay', 'Reword + reorder + duplicate → EXACT_REPLAY; model_called=false.'],
    ['Baseline removal', 'Removing prior evidence → BASELINE_REMOVAL_BLOCKED; baseline unchanged.'],
    ['No semantic reroll', 'Same adjudicated evidence + new wording → ALREADY_ADJUDICATED; no new model call.'],
    ['Material reopen', 'Genuinely new material evidence → MATERIAL_DELTA → AWAITING_FRESH_DECISION.'],
    ['Evidence binding', 'Fresh decision with mismatched evidence rolls back.'],
    ['Epoch reset', 'Fresh REJECTED creates the full new baseline and resets the epoch ledger/budget.'],
    ['Terminal acceptance', 'Fresh ACCEPTED → CLOSED_ACCEPTED; later retry → CASE_NOT_RETRYABLE.'],
    ['Authority guard', 'Decision authority retry → AUTHORITY_CANNOT_SUBMIT_RETRY before attempt/model call.'],
  ];
  return <>
    <div className="pageHeading"><div><span className="kicker">STUDIONET PROOF</span><h1>Runtime evidence</h1><p>Behavioral proof from the final deployment. These are executed contract outcomes, not source-marker assertions.</p></div></div>
    <div className="evidenceGrid">
      <section className="card evidenceList">{gates.map(([title,body])=><div className="evidenceRow" key={title}><span className="checkIcon">✓</span><div><b>{title}</b><p>{body}</p></div></div>)}</section>
      <aside className="sideColumn">
        <div className="card sideCard"><span className="sectionEyebrow">Deployment</span><h3>0x1A811…4263</h3><p className="sideNote">MeaningNonce final StudioNet deployment.</p><a className="secondaryButton blockButton" href={`https://explorer-studio.genlayer.com/address/${DEFAULT_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Open Explorer ↗</a></div>
        <div className="card sideCard"><span className="sectionEyebrow">Cases</span><button className="exampleLink" onClick={onRuntimeCase}>Main runtime case <span>→</span></button><button className="exampleLink" onClick={onRoleCase}>Role-guard case <span>→</span></button></div>
      </aside>
    </div>
  </>
}

function SemanticBoundaryScan({phase,requestText,baseline,candidate,result,caseStatus,onInspect}:{phase:ScanPhase;requestText:string;baseline:string[];candidate:string[];result:AttemptRecord|null;caseStatus:CaseRecord['status']|null;onInspect:()=>void}) {
  const finalized = phase === 'finalized' && !!result;
  const material = finalized && result.outcome === 'MATERIAL_DELTA';
  const blocked = finalized && !material;
  const delta = finalized ? result.additions : [];
  const terminalIdle = phase === 'idle' && caseStatus === 'CLOSED_ACCEPTED';
  const pendingIdle = phase === 'idle' && caseStatus === 'AWAITING_FRESH_DECISION';
  const idleLabel = terminalIdle ? 'TERMINAL' : pendingIdle ? 'PENDING' : 'READY';
  const idleText = terminalIdle ? 'Case closed · no further retry can enter the gate.' : pendingIdle ? 'Case awaiting fresh decision · retry gate is paused.' : 'Run the gate to visualize the real contract path.';
  const resultText = !finalized ? 'Awaiting finalized contract result' : material ? 'Boundary opened · fresh decision required' : 'Boundary closed · retry does not buy a fresh verdict';
  return <section className={`semanticScan ${phase} ${material?'material':''} ${blocked?'blocked':''}`} aria-live="polite">
    <div className="scanTopline"><div><span className="sectionEyebrow">Signature effect</span><b>Semantic Boundary Scan</b></div><span className="scanTruth">Verdict appears only after finalized state verification</span></div>
    {phase === 'scanning' && <span className="scanBeam" aria-hidden="true"/>}
    <div className="scanStages">
      <div className={`scanStage wording ${phase!=='idle'?'excluded':''}`}>
        <div className="scanStageHead"><span>01</span><b>Request wording</b><em>AUDIT ONLY</em></div>
        <p>{requestText || 'No request wording entered.'}</p>
        <small>{phase==='idle' ? 'Stored for audit; excluded from the semantic gate.' : 'Excluded from the semantic decision boundary.'}</small>
      </div>
      <div className={`scanStage baseline ${phase!=='idle'?'locked':''}`}>
        <div className="scanStageHead"><span>02</span><b>Baseline</b><em>LOCKED</em></div>
        <div className="scanEvidenceItems">{baseline.length ? baseline.map((x,i)=><span key={`${x}-${i}`}>{x}</span>) : <i>Load a case to lock the recorded baseline.</i>}</div>
        <small>The contract will not let a retry silently shrink this baseline.</small>
      </div>
      <div className={`scanStage candidate ${phase==='scanning'?'active':''}`}>
        <div className="scanStageHead"><span>03</span><b>Candidate evidence</b><em>{finalized ? `${delta.length} NEW` : 'SCAN'}</em></div>
        <div className="scanEvidenceItems">{candidate.length ? candidate.map((x,i)=><span className={finalized && delta.includes(x)?'newDelta':''} key={`${x}-${i}`}>{x}</span>) : <i>Add the full candidate evidence set.</i>}</div>
        <small>{finalized ? (delta.length ? 'Finalized additions are highlighted.' : 'No finalized new-evidence delta.') : 'Candidate evidence is staged; no semantic verdict is inferred in the UI.'}</small>
      </div>
    </div>
    <div className={`scanVerdict ${finalized?'revealed':''}`}>
      <div className="scanVerdictIcon">{phase==='scanning'?'⌁':material?'↗':finalized?'⊘':'◇'}</div>
      <div><span>{phase==='scanning'?'CONSENSUS IN PROGRESS':finalized?result.outcome:idleLabel}</span><b>{phase==='idle'?idleText:resultText}</b>{finalized && <small>model_called={String(result.model_called)} · epoch={result.epoch} · additions={result.additions.length}</small>}</div>
      {finalized && <button className="secondaryButton compact" onClick={onInspect}>Inspect finalized attempt</button>}
    </div>
  </section>
}

function CaseDetail({caseData,onCopy}:{caseData:CaseRecord|null;onCopy:(v:string)=>void}) {
  return <div className="detailCard"><div className="detailHead"><span>Case</span>{caseData && <button onClick={()=>onCopy(caseData.case_id)}>Copy ID</button>}</div>{caseData ? <><div className="detailTitle"><Pill value={caseData.status}/><b>{caseData.case_ref}</b></div><dl className="detailList"><dt>Decision</dt><dd>{caseData.decision}</dd><dt>Authority</dt><dd>{short(caseData.authority)}</dd><dt>Epoch</dt><dd>{caseData.epoch}</dd><dt>Attempts</dt><dd>{caseData.attempt_count}</dd><dt>Blocked</dt><dd>{caseData.blocked_count}</dd><dt>Model calls</dt><dd>{caseData.model_calls_this_epoch}/3</dd><dt>Baseline items</dt><dd>{caseData.baseline_evidence.length}</dd></dl><div className="reasonBox"><span>Decision reason</span><p>{caseData.decision_reason}</p></div><div className="evidenceStack"><span>Baseline evidence</span>{caseData.baseline_evidence.map((x,i)=><div key={i}>{i+1}. {x}</div>)}</div></> : <p className="emptyState">No case loaded.</p>}</div>
}

function AttemptDetail({attemptData,onCopy}:{attemptData:AttemptRecord|null;onCopy:(v:string)=>void}) {
  return <div className="detailCard"><div className="detailHead"><span>Attempt</span>{attemptData && <button onClick={()=>onCopy(attemptData.attempt_id)}>Copy ID</button>}</div>{attemptData ? <><div className="detailTitle"><Pill value={attemptData.outcome}/><b>{short(attemptData.attempt_id)}</b></div><dl className="detailList"><dt>Epoch</dt><dd>{attemptData.epoch}</dd><dt>Requester</dt><dd>{short(attemptData.requester)}</dd><dt>Model called</dt><dd>{attemptData.model_called ? 'true':'false'}</dd><dt>New additions</dt><dd>{attemptData.additions.length}</dd>{attemptData.prior_semantic_outcome && <><dt>Prior semantic result</dt><dd>{attemptData.prior_semantic_outcome}</dd></>}</dl><div className="reasonBox"><span>Request wording · audit only</span><p>{attemptData.request_text}</p></div><div className="evidenceStack"><span>New evidence delta</span>{attemptData.additions.length ? attemptData.additions.map((x,i)=><div key={i}>+ {x}</div>) : <div>No new evidence.</div>}</div></> : <p className="emptyState">No attempt loaded.</p>}</div>
}

function FlowStep({number,title,body,onClick}:{number:string;title:string;body:string;onClick:()=>void}) { return <button className="flowStep" onClick={onClick}><span>{number}</span><div><b>{title}</b><p>{body}</p></div></button> }
function StepHint({number,title,body,done}:{number:string;title:string;body:string;done:boolean}) { return <div className={done?'stepHint done':'stepHint'}><span>{done?'✓':number}</span><div><b>{title}</b><p>{body}</p></div></div> }
function Field({label,hint,children}:{label:string;hint?:string;children:ReactNode}) { return <label className="field"><span className="fieldLabel">{label}{hint && <small>{hint}</small>}</span>{children}</label> }
function Pill({value}:{value:string}) { const hot = value.includes('MATERIAL') && !value.includes('IMMATERIAL'); const good=value.includes('ACCEPTED')||value==='LOCKED_REJECTED'; return <span className={`pill ${hot?'hot':''} ${good?'good':''}`}>{value}</span> }
function Metric({label,value}:{label:string;value:string}) { return <div className="metric"><span>{label}</span><b>{value}</b></div> }
function NavButton({active,icon,label,onClick}:{active:boolean;icon:string;label:string;onClick:()=>void}) { return <button className={active?'navButton active':'navButton'} onClick={onClick}><span>{icon}</span>{label}</button> }

export default App;
