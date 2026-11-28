import { ArrowRight, CheckCircle2, LoaderCircle, Search, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { api, onDataChanged, peek } from '../api';
import { decisionText, dismissDecision, hiddenFromQueue, useDecisions } from '../decisions';
import { useAuth } from '../auth';
import { ErrorNotice, StatusBadge } from '../components';
import { dateTime, money, stepLabel } from '../format';
import type { ActedRfa, ArchiveYear, Rfa } from '../types';
import { Empty, RfaTable } from './DashboardPage';

type ListMode = 'mine' | 'approvals' | 'done' | 'all';

const COPY: Record<ListMode, { eyebrow: string; title: string; text: string; empty: string; emptyText: string }> = {
  mine: { eyebrow: 'REQUEST REGISTER', title: 'My RFAs', text: 'The requests you filed. Search, filter, and follow each one from draft through closeout.', empty: 'No matching RFAs', emptyText: 'Try a different search or create a new Request for Approval.' },
  approvals: { eyebrow: 'APPROVAL QUEUE', title: 'For My Action', text: 'Requests currently assigned to you. Review every detail before deciding.', empty: 'No requests need your action', emptyText: 'Your queue is clear.' },
  done: { eyebrow: 'APPROVAL QUEUE', title: 'For My Action', text: 'Every request you approved, returned or disapproved, and where each one is now.', empty: 'Nothing here yet', emptyText: 'Requests you decide on will be listed here.' },
  all: { eyebrow: 'INSTITUTION REGISTER', title: 'All RFAs', text: 'Every submitted request across all departments. Drafts stay private to their requesters.', empty: 'No matching RFAs', emptyText: 'Try a different search or filter.' }
};

export function RfaListPage({ mode = 'mine' }: { mode?: ListMode }) {
  const { user } = useAuth();
  const approvalsOnly = mode === 'approvals';
  const approvedOnlyScope = mode === 'all' && user?.ALL_RFAS_SCOPE === 'approved';
  const copy = COPY[mode];
  const doneByMe = mode === 'done';
  const action = approvalsOnly ? 'rfa.forApproval' : doneByMe ? 'rfa.actedByMe' : mode === 'all' ? 'rfa.all' : 'rfa.list';
  const emptyFilters = approvalsOnly ? {} : { query: '', status: '', expenseClassification: '', fiscalYear: '' };
  // Show the list loaded earlier in this visit straight away; a fresh copy replaces it in the background.
  const [rfas, setRfas] = useState<Rfa[]>(() => peek<Rfa[]>(action, emptyFilters) ?? []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [expenseClassification, setExpenseClassification] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [archives, setArchives] = useState<ArchiveYear[]>(() => peek<ArchiveYear[]>('rfa.archives') ?? []);
  const [loading, setLoading] = useState(() => !peek<Rfa[]>(action, emptyFilters));
  const [error, setError] = useState('');
  const previousQuery = useRef(query);
  // When the list on screen was loaded, so an RFA decided after that stays hidden until a fresh copy arrives.
  const [loadedAt, setLoadedAt] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const decisions = useDecisions();

  // In For My Action, reload the queue after any saved change (such as a decision just recorded).
  useEffect(() => (approvalsOnly ? onDataChanged(() => setRefreshTick((tick) => tick + 1)) : undefined), [approvalsOnly]);

  useEffect(() => {
    let current = true;
    const delay = query === previousQuery.current ? 0 : 250;
    previousQuery.current = query;
    const payload = approvalsOnly ? {} : { query, status, expenseClassification, fiscalYear, ...(schoolYear ? { schoolYear } : {}) };
    const known = peek<Rfa[]>(action, payload);
    if (known) setRfas(known);
    setLoading(true);
    const timer = setTimeout(() => {
      const startedAt = Date.now();
      void api<Rfa[]>(action, payload)
        .then((next) => { if (current) { setRfas(next); setLoadedAt(startedAt); setError(''); } })
        .catch((caught: Error) => { if (current) setError(caught.message); })
        .finally(() => { if (current) setLoading(false); });
    }, delay);
    return () => { current = false; clearTimeout(timer); };
  }, [query, status, expenseClassification, fiscalYear, schoolYear, approvalsOnly, action, refreshTick]);

  // Past school years that were archived; loaded once and cached for the visit.
  useEffect(() => {
    if (approvalsOnly) return;
    let current = true;
    api<ArchiveYear[]>('rfa.archives').then((rows) => { if (current) setArchives(Array.isArray(rows) ? rows : []); }).catch(() => undefined);
    return () => { current = false; };
  }, [approvalsOnly]);

  const shown = approvalsOnly ? rfas.filter((rfa) => !hiddenFromQueue(rfa.RFA_ID, loadedAt)) : rfas;

  return <>
    <header className="page-header">
      <div>
        <span className="eyebrow orange">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{approvedOnlyScope ? 'Approved, in-implementation, and closed requests across all departments, for procurement.' : copy.text}</p>
      </div>
    </header>
    {(approvalsOnly || doneByMe) && user?.CAN_APPROVE_RFA && <nav className="queue-tabs" aria-label="For My Action">
      <NavLink to="/approvals" end>Waiting for me</NavLink>
      <NavLink to="/approvals/done">Done by me</NavLink>
    </nav>}
    <ErrorNotice message={error} />
    {approvalsOnly && <DecisionNotes items={decisions} />}
    {!approvalsOnly && <div className={`filters${archives.length ? ' with-year' : ''}`}>
      {archives.length > 0 && <label>
        <span className="sr-only">School year</span>
        <select value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} aria-label="School year">
          <option value="">Current school year</option>
          {archives.map((year) => <option key={year.schoolYear} value={String(year.schoolYear)}>{year.label}</option>)}
        </select>
      </label>}
      <label className="search-field">
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number, title, name, department…" aria-label="Search RFAs" />
      </label>
      <label>
        <span className="sr-only">Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['DRAFT','PENDING_RECOMMENDING_APPROVAL','PENDING_REVIEW','PENDING_AUTHORITY_APPROVAL','RETURNED','DISAPPROVED','APPROVED','IMPLEMENTATION','CLOSED','CANCELLED','EXCEPTION'].map((item) => <option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}
        </select>
      </label>
      <label>
        <span className="sr-only">Expense classification</span>
        <select value={expenseClassification} onChange={(e) => setExpenseClassification(e.target.value)}>
          <option value="">All types</option>
          <option value="OPEX">OPEX</option>
          <option value="CAPEX">CAPEX</option>
        </select>
      </label>
      <label>
        <span className="sr-only">Fiscal year</span>
        <input value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} placeholder="Year, e.g. 2026" inputMode="numeric" aria-label="Fiscal year" />
      </label>
    </div>}
    <section className={`panel flush${loading && shown.length && !approvalsOnly ? ' is-refreshing' : ''}`} aria-busy={loading}>
      {loading && !rfas.length
        ? <ListSkeleton />
        : shown.length
          ? doneByMe ? <DoneTable rfas={shown as ActedRfa[]} schoolYear={schoolYear} /> : <RfaTable rfas={shown} review={approvalsOnly} schoolYear={schoolYear} />
          : <Empty title={copy.empty} text={copy.emptyText} />}
    </section>
  </>;
}

const MY_ACTION_LABELS: Record<string, string> = { APPROVED: 'Approved', RETURNED: 'Returned', DISAPPROVED: 'Disapproved' };

/** "Done by me": what this approver decided, when, and where each request is now. */
function DoneTable({ rfas, schoolYear }: { rfas: ActedRfa[]; schoolYear: string }) {
  return <div className="table-wrap">
    <table>
      <thead><tr><th>RFA Number</th><th>Request</th><th>Department</th><th>Requested Amount</th><th>Your decision</th><th>Now</th><th aria-label="Action" /></tr></thead>
      <tbody>{rfas.map((rfa) => <tr key={rfa.RFA_ID}>
        <td data-label="RFA Number"><b>{rfa.RFA_NUMBER}</b></td>
        <td data-label="Request"><span className="cell-primary">{rfa.REQUEST_TITLE}</span><small>{rfa.REQUESTED_BY}</small></td>
        <td data-label="Department">{rfa.DEPARTMENT_NAME}</td>
        <td data-label="Requested Amount">{money(rfa.REQUESTED_AMOUNT ? rfa.REQUESTED_AMOUNT / 100 : rfa.BUDGET_ALLOCATION)}</td>
        <td data-label="Your decision">
          <span className={`my-decision ${rfa.MY_ACTION.toLowerCase()}`}>{MY_ACTION_LABELS[rfa.MY_ACTION] ?? rfa.MY_ACTION}</span>
          <small>{dateTime(rfa.MY_ACTION_AT)} · {stepLabel(rfa.MY_STEP)}</small>
        </td>
        <td data-label="Now"><StatusBadge status={rfa.STATUS} /></td>
        <td><Link className="row-link" to={`/rfa/${rfa.RFA_ID}${schoolYear ? `?sy=${schoolYear}` : ''}`}>View <ArrowRight size={14} /></Link></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** What happened to the decisions just made: saving, done, or what went wrong. */
function DecisionNotes({ items }: { items: ReturnType<typeof useDecisions> }) {
  // Finished notes clear themselves after a few seconds; failures stay until dismissed or reopened.
  useEffect(() => {
    const done = items.filter((item) => item.state === 'done');
    if (!done.length) return undefined;
    const timer = window.setTimeout(() => done.forEach((item) => dismissDecision(item.rfaId)), 6000);
    return () => window.clearTimeout(timer);
  }, [items]);
  if (!items.length) return null;
  return <div className="decision-notes">
    {items.map((item) => <div key={item.rfaId} className={`notice decision-note ${item.state}`} role={item.state === 'failed' ? 'alert' : 'status'}>
      {item.state === 'saving' ? <LoaderCircle size={18} className="spin" /> : item.state === 'done' ? <CheckCircle2 size={18} /> : null}
      <span>{decisionText(item)}</span>
      {item.state === 'failed' && <Link className="row-link" to={`/rfa/${item.rfaId}`}>Open it again</Link>}
      {item.state !== 'saving' && <button className="icon-button" onClick={() => dismissDecision(item.rfaId)} aria-label="Dismiss"><X size={16} /></button>}
    </div>)}
  </div>;
}

function ListSkeleton() {
  return <div aria-label="Loading RFAs" role="status">
    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton-row">
      <div className="skeleton skeleton-cell" style={{ width: 96 }} />
      <div className="skeleton skeleton-cell" style={{ flex: 1 }} />
      <div className="skeleton skeleton-cell" style={{ width: 110 }} />
      <div className="skeleton skeleton-cell" style={{ width: 80 }} />
    </div>)}
  </div>;
}
