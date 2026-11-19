import { ArrowLeft, Check, Download, Edit3, Eye, FileText, LoaderCircle, Printer, RotateCcw, Send, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, peek } from '../api';
import { AttachmentViewer, fetchAttachment, saveBlob, viewKind } from './AttachmentViewer';
import { dismissDecision, failedDecision, startDecision } from '../decisions';
import { useAuth } from '../auth';
import { Dialog, ErrorNotice, Spinner, StatusBadge, SuccessNotice } from '../components';
import { date, dateTime, displayName, expenseClassificationLabel, money, rfaNumberLabel, schoolYearLabel, stepLabel } from '../format';
import type { Approval, ApprovalStep, Attachment, Audit, Rfa, RfaDetail } from '../types';

const legacySteps: ApprovalStep[] = ['PREPARED_BY', 'RECOMMENDING_APPROVAL', 'REVIEWED_AND_NOTED', 'APPROVED_BY'];
const legacyAssignmentSteps: ApprovalStep[] = ['PREPARED_BY', 'RECOMMENDING_APPROVAL', 'REVIEWED_BY', 'NOTED_BY', 'APPROVED_BY'];
const standardSteps: ApprovalStep[] = ['PREPARED_BY', 'REVIEWED_BY', 'NOTED_BY', 'APPROVED_BY'];
const officialSteps: ApprovalStep[] = ['PREPARED_BY', 'RECOMMENDING_APPROVAL', 'REVIEWED_AND_NOTED', 'APPROVED_BY'];
// A PDF is offered only once an RFA is final: approved (and after) or cancelled.
const pdfStatuses = new Set(['APPROVED', 'IMPLEMENTATION', 'CLOSED', 'CANCELLED']);

/** Print to PDF with the RFA number as the suggested file name. */
function savePdf(rfa: Rfa) {
  const previous = document.title;
  document.title = [rfaNumberLabel(rfa.RFA_NUMBER), rfa.REQUEST_TITLE].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ');
  const restore = () => { document.title = previous; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}

export function RfaDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const schoolYear = Number(searchParams.get('sy') || 0);
  // A copy loaded in the background (hovering its link, or earlier this visit) shows at once.
  const [detail, setDetail] = useState<RfaDetail | null>(() => peek<RfaDetail>('rfa.detail', schoolYear ? { rfaId: id, schoolYear } : { rfaId: id }) ?? null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<'approve'|'return'|'disapprove'|null>(null);
  const [remarks, setRemarks] = useState('');
  const [working, setWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    void api<RfaDetail>('rfa.detail', schoolYear ? { rfaId: id, schoolYear } : { rfaId: id })
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, schoolYear]);

  useEffect(load, [load]);

  // A decision saves in the background: the approver goes straight back to For My Action,
  // which shows it being recorded. If it fails, this page offers it again with the remarks kept.
  function decide() {
    if (!dialog || !detail) return;
    const action = dialog;
    const label = detail.rfa.RFA_NUMBER ? rfaNumberLabel(detail.rfa.RFA_NUMBER) : (detail.rfa.REQUEST_TITLE || 'the RFA');
    setDialog(null);
    void startDecision(id, label, action, remarks).catch(() => undefined);
    setRemarks('');
    navigate('/approvals');
  }

  useEffect(() => {
    const failed = failedDecision(id);
    if (!failed) return;
    setError(`Your decision was not saved: ${failed.error ?? 'please try again.'}`);
    setRemarks(failed.remarks);
    dismissDecision(id);
  }, [id]);

  async function transition(action: 'implementation'|'close') {
    setWorking(true);
    try { await api(`rfa.${action}`, { rfaId: id }); setSuccess(action === 'close' ? 'RFA closed.' : 'RFA moved to implementation.'); load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The action failed.'); }
    finally { setWorking(false); }
  }

  // Administrators only: permanently remove this RFA (used to clear test requests).
  async function deleteThis() {
    setWorking(true);
    setError('');
    setPending('Deleting the RFA…');
    try {
      await api('admin.rfa.delete', { rfaId: id });
      setDeleting(false);
      navigate(-1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The RFA could not be deleted.'); }
    finally { setWorking(false); setPending(''); }
  }

  // PDFs and pictures open in eRFA's viewer; other files (Word) download.
  async function openAttachment(attachment: Attachment) {
    if (viewKind(attachment) !== 'other') { setViewing(attachment); return; }
    try { const file = await fetchAttachment(attachment); saveBlob(file.blob, file.fileName); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Attachment download failed.'); }
  }

  if (loading && !detail) return <Spinner label="Loading RFA" />;
  if (!detail) return <><ErrorNotice message={error || 'RFA was not found.'} /><button className="button secondary" onClick={() => navigate('/rfas')}>Back to My RFAs</button></>;

  const { rfa, approvals, attachments, audit, permissions, financial, notedByNotApplicable, approvedByOrder = {} } = detail;
  const deleteWord = rfa.RFA_NUMBER ? String(rfa.RFA_NUMBER) : 'DELETE';
  const approvedByWaitingMap = rfa.CURRENT_STEP === 'APPROVED_BY' ? approvedByWaiting(rfa, approvals, approvedByOrder) : new Map<string, string>();
  const isLegacyAssignment = rfa.CURRENT_MATRIX_ID === 'RFA_ASSIGNMENTS_V1';
  const isOfficialWorkflow = rfa.CURRENT_MATRIX_ID === 'RFA_FIXED_V3' || approvals.some((a) => a.STEP === 'REVIEWED_AND_NOTED');
  const isFixedWorkflow = rfa.CURRENT_MATRIX_ID === 'RFA_FIXED_V2';
  const hasInvolved = Boolean(rfa.INVOLVED_DEPARTMENT_ID) || Boolean(rfa.INVOLVED_DEPARTMENT_NAME) || approvals.some((a) => a.STEP === 'INVOLVED_DEPARTMENT_HEAD');
  const standardStepsWithInvolved: ApprovalStep[] = hasInvolved
    ? ['PREPARED_BY', 'REVIEWED_BY', 'NOTED_BY', 'INVOLVED_DEPARTMENT_HEAD', 'APPROVED_BY']
    : standardSteps;
  const usesAssignmentWorkflow = isLegacyAssignment || approvals.some((approval) => approval.STEP === 'RECOMMENDING_APPROVAL' && rfa.CURRENT_MATRIX_ID === 'RFA_ASSIGNMENTS_V1');
  const steps: ApprovalStep[] = isOfficialWorkflow ? officialSteps : isFixedWorkflow ? standardStepsWithInvolved : usesAssignmentWorkflow ? legacyAssignmentSteps : legacySteps;

  return <>
    <div className="screen-only">
      <Link className="back-link" to="/rfas"><ArrowLeft size={16} /> Back to RFAs</Link>
      {detail.archived && <div className="notice archived-notice" role="status">Archived record · {detail.archived.label}. This RFA is kept for reference and can no longer be changed.</div>}
      <header className="detail-header">
        <div>
          <span className="eyebrow orange">{rfaNumberLabel(rfa.RFA_NUMBER)}</span>
          <h1>{rfa.REQUEST_TITLE || 'Untitled draft'}</h1>
          <div className="detail-meta">
            <StatusBadge status={rfa.STATUS} />
            <span>Filed {date(rfa.DATE_FILED)}</span>
            <span>Updated {dateTime(rfa.UPDATED_AT)}</span>
          </div>
        </div>
        <div className="header-actions">
          {pdfStatuses.has(rfa.STATUS) && <button className="button secondary" onClick={() => savePdf(rfa)}><Printer size={16} /> Download PDF</button>}
          {permissions.canEdit && <Link className="button secondary" to={`/rfa/${rfa.RFA_ID}/edit`}><Edit3 size={16} /> Edit</Link>}
          {user?.IS_ADMIN && !detail.archived && <button className="button danger-outline" disabled={working} onClick={() => { setDeleteConfirm(''); setDeleting(true); }}><Trash2 size={16} /> Delete</button>}
        </div>
      </header>
      <ErrorNotice message={error} />
      <SuccessNotice message={success} />
      {pending && <div className="notice saving" role="status"><LoaderCircle size={18} className="spin" />{pending}</div>}
      {permissions.canDecide && !working && <div className="action-banner">
        <div className="action-banner-left">
          <b>ACTION REQUIRED — This request is awaiting your review</b>
          <span>Review the details and attachments, then approve, return, or disapprove.</span>
        </div>
        <div className="action-banner-actions">
          <button className="button danger-outline" onClick={() => setDialog('disapprove')}><XCircle size={15} /> Disapprove</button>
          <button className="button secondary" onClick={() => setDialog('return')}><RotateCcw size={15} /> Return</button>
          <button className="button primary" onClick={() => setDialog('approve')}><Check size={15} /> Approve</button>
        </div>
      </div>}
    </div>

    <article className={`rfa-document${pdfStatuses.has(rfa.STATUS) ? '' : ' not-final'}${rfa.STATUS === 'CANCELLED' ? ' is-cancelled' : ''}`}>
      {rfa.STATUS === 'CANCELLED' && <div className="print-cancelled" aria-hidden="true">CANCELLED</div>}
      <header className="print-brand">
        <img src={`${import.meta.env.BASE_URL}school-logo.svg`} alt="FEU Bataan Campus" />
        <div>
          <b>REQUEST FOR APPROVAL (RFA) FORM</b>
          <span>{rfaNumberLabel(rfa.RFA_NUMBER)}</span>
        </div>
      </header>

      <section className="request-grid">
        <Fact label="Date Filed" value={date(rfa.DATE_FILED)} />
        <Fact label="Requesting Department" value={rfa.DEPARTMENT_NAME} />
        <Fact label="Requested By" value={rfa.REQUESTED_BY} />
        <Fact label="Position" value={rfa.POSITION} />
        <Fact label="Project / Activity / Request Title" value={rfa.REQUEST_TITLE} wide />
      </section>

      <DocumentSection title="Purpose and Justification"><p>{rfa.PURPOSE || '—'}</p></DocumentSection>

      <DocumentSection title="Expense Information">
        <section className="request-grid two">
          <Fact label="School Year" value={schoolYearLabel(financial?.fiscalYear || rfa.FISCAL_YEAR || '')} />
          <Fact label="Expense Classification" value={expenseClassificationLabel(rfa.EXPENSE_CLASSIFICATION || financial?.expenseClassification)} />
          <Fact label="Requested Amount" value={money(financial?.requestedAmount ?? (rfa.REQUESTED_AMOUNT ? rfa.REQUESTED_AMOUNT / 100 : rfa.BUDGET_ALLOCATION))} />
          {/* No longer asked on the form; shown only for older RFAs that were marked as a purchase request. */}
          {(rfa.PURCHASE_REQUEST || financial?.purchaseRequest) && <Fact label="Purchase Request" value="Yes" />}
          <Fact label="Target Date" value={date(rfa.TARGET_DATE)} />
          {(rfa.INVOLVED_DEPARTMENT_NAME || financial?.involvedDepartmentName) && <Fact label="Involved Department(s)" value={rfa.INVOLVED_DEPARTMENT_NAME || financial?.involvedDepartmentName || ''} />}
          {financial?.approvedAmount ? <Fact label="Approved Amount" value={money(financial.approvedAmount)} /> : null}
          {(rfa.RECOMMENDING_ALTERNATE_NAME || financial?.recommendingAlternateName) && <Fact label="Recommending Approver (chosen by requester)" value={rfa.RECOMMENDING_ALTERNATE_NAME || financial?.recommendingAlternateName || ''} />}
          {financial?.categoryName ? <Fact label="Historical Expense Category" value={financial.categoryName} /> : null}
        </section>
      </DocumentSection>

      {/* Older RFAs kept a separate Justification; new ones write it in Purpose and Justification. */}
      {rfa.JUSTIFICATION ? <DocumentSection title="Justification"><p>{rfa.JUSTIFICATION}</p></DocumentSection> : null}

      <DocumentSection title="Picture / Letter Attachment">
        <div className="attachments">
          {attachments.length ? attachments.map((attachment) => <button key={attachment.ATTACHMENT_ID} onClick={() => void openAttachment(attachment)} title={viewKind(attachment) === 'other' ? 'Download' : 'View'}>
            <FileText />
            <span>
              <b>{attachment.FILE_NAME}</b>
              <small>{(Number(attachment.SIZE_BYTES) / 1024 / 1024).toFixed(2)} MB · uploaded {dateTime(attachment.UPLOADED_AT)}</small>
            </span>
            {viewKind(attachment) === 'other' ? <Download aria-label="Download" /> : <span className="attachment-view"><Eye size={16} /> View</span>}
          </button>) : <p>No attachment submitted.</p>}
        </div>
      </DocumentSection>

      <section className="workflow-section">
        <header>
          <span className="eyebrow">APPROVAL WORKFLOW</span>
          <StatusBadge status={rfa.STATUS} />
        </header>
        <div className="workflow-steps">
          {steps.map((step, index) => <WorkflowStep key={step} step={step} index={index} rfa={rfa} approvals={approvals} current={rfa.CURRENT_STEP === step && rfa.STATUS.startsWith('PENDING_')} notApplicable={step === 'NOTED_BY' && notedByNotApplicable} />)}
        </div>
      </section>

      <section className="approval-signatures">
        <h2>Approval Signatures</h2>
        <div>{steps.map((step) => <ApprovalSignature key={step} step={step} rfa={rfa} approvals={approvals} current={rfa.CURRENT_STEP === step} notApplicable={step === 'NOTED_BY' && notedByNotApplicable} approvedByOrder={approvedByOrder} />)}</div>
      </section>

      <DocumentSection title="Approval History">
        <HistoryTable approvals={approvals} status={rfa.STATUS} waiting={approvedByWaitingMap} rfaId={rfa.RFA_ID} />
      </DocumentSection>

      <section className="audit-section screen-only">
        <h2>Audit History</h2>
        {visibleAudit(audit).length ? <ol>{[...visibleAudit(audit)].reverse().map((entry) => <li key={entry.LOG_ID}>
          <span>{dateTime(entry.TIMESTAMP)}</span>
          <div>
            <b>{auditLabel(entry.ACTION)}</b>
            <p>{entry.ACTOR_NAME}{auditRemarks(entry) ? ` — ${auditRemarks(entry)}` : ''}</p>
          </div>
        </li>)}</ol> : <p>No audit entries.</p>}
      </section>

      <footer className="print-footer">
        <span>Effectivity 070626</span>
        <span>Generated electronically from eRFA · {new Date().toLocaleString('en-PH')}</span>
      </footer>
    </article>

    <section className={`decision-bar screen-only ${permissions.canDecide ? 'sticky' : ''}`}>
      {permissions.canDecide && !working && <>
        <div>
          <span className="eyebrow orange">ACTION REQUIRED</span>
          <b>Review the complete RFA and attachments before acting.</b>
        </div>
        <div>
          <button className="button danger-outline" onClick={() => setDialog('disapprove')}><XCircle size={15} /> Disapprove</button>
          <button className="button secondary" onClick={() => setDialog('return')}><RotateCcw size={15} /> Return</button>
          <button className="button primary" onClick={() => setDialog('approve')}><Check size={15} /> Approve</button>
        </div>
      </>}
      {!permissions.canDecide && permissions.canImplement && <>
        <div>
          <span className="eyebrow orange">FINAL APPROVAL CONFIRMED</span>
          <b>Final approval is complete. Begin implementation when ready.</b>
        </div>
        <button className="button primary" disabled={working} onClick={() => void transition('implementation')}><Send size={15} /> Start Implementation</button>
      </>}
      {!permissions.canDecide && permissions.canClose && rfa.STATUS === 'IMPLEMENTATION' && <>
        <div>
          <span className="eyebrow orange">IMPLEMENTATION</span>
          <b>File the completed RFA for audit when implementation is finished.</b>
        </div>
        <button className="button primary" disabled={working} onClick={() => void transition('close')}><Check size={15} /> Close RFA</button>
      </>}
      {!permissions.canDecide && !permissions.canImplement && !permissions.canClose && <div>
        <span className="eyebrow">STATUS</span><b>{rfa.STATUS.replaceAll('_',' ')} — No action available for your role at this stage.</b>
      </div>}
    </section>

    {dialog && <Dialog
      title={dialog === 'approve' ? 'Confirm electronic approval' : dialog === 'return' ? 'Return RFA for revision' : 'Disapprove RFA'}
      onClose={() => setDialog(null)}>
      <div className="dialog-body">
        <div><p>{dialog === 'approve'
          ? 'Your identity, approval step, timestamp, and remarks will be recorded permanently.'
          : 'Provide a clear reason so the requester understands what is required.'}</p>
        <label className="field">
          <span>Remarks {dialog !== 'approve' && <b>*</b>}</span>
          <textarea rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} autoFocus />
        </label>
        <div className="dialog-actions">
          <button className="button ghost" onClick={() => setDialog(null)}>Cancel</button>
          <button className={`button ${dialog === 'disapprove' ? 'danger' : 'primary'}`}
            disabled={working || (dialog !== 'approve' && remarks.trim().length < 3)}
            onClick={decide}>
            {dialog === 'approve' ? 'Confirm Approval' : dialog === 'return' ? 'Return to Requester' : 'Confirm Disapproval'}
          </button>
        </div>
      </div></div>
    </Dialog>}

    {viewing && <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />}

    {deleting && <Dialog title="Delete this RFA permanently?" onClose={() => setDeleting(false)}>
      <div className="dialog-body"><div>
        <p>This removes <b>{rfaNumberLabel(rfa.RFA_NUMBER)}</b> “{rfa.REQUEST_TITLE || 'Untitled draft'}” for everyone: its approvals, history and email records. Attachments go to the Drive trash. This cannot be undone in eRFA.</p>
        <p className="muted">Use this only for test or mistaken requests.</p>
        <label className="field">
          <span>Type <b>{deleteWord}</b> to confirm</span>
          <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoFocus autoComplete="off" />
        </label>
        <div className="dialog-actions">
          <button className="button ghost" onClick={() => setDeleting(false)}>Keep it</button>
          <button className="button danger" disabled={working || deleteConfirm.trim().toUpperCase() !== deleteWord.toUpperCase()} onClick={() => void deleteThis()}><Trash2 size={15} /> Delete RFA</button>
        </div>
      </div></div>
    </Dialog>}
  </>;
}

// Plain-language history on the RFA page. Purely technical entries are kept in
// Administration > Logs but not shown here.
const HIDDEN_AUDIT = new Set(['OPTIONAL_APPROVERS_SELECTED', 'OPTIONAL_APPROVERS_RESOLVED', 'FINANCIAL_RFA_SUBMITTED', 'APPROVAL_REQUESTED', 'NOTED_BY_SELECTION', 'ACCESS_DENIED']);
const AUDIT_LABELS: Record<string, string> = {
  RFA_CREATED: 'Draft created', RFA_UPDATED: 'Draft updated', RFA_SUBMITTED: 'Submitted', RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved', RETURNED: 'Returned for revision', DISAPPROVED: 'Disapproved', FINAL_APPROVED: 'Fully approved',
  EMAIL_SENT: 'Email sent', EMAIL_FAILED: 'Email could not be sent', APPROVER_REASSIGNED: 'Approval handed over',
  ATTACHMENT_UPLOADED: 'Attachment added', IMPLEMENTATION: 'Implementation started', CLOSED: 'Closed', CANCELLED: 'Cancelled',
  ACTUAL_EXPENSE_RECORDED: 'Actual expense recorded', WORKFLOW_EXCEPTION: 'Needs administrator attention', APPROVER_SKIPPED: 'Approver skipped', STAGE_SKIPPED: 'Step skipped'
};
const EMAIL_KINDS: Record<string, string> = {
  APPROVAL_REQUIRED: 'approval request', APPROVAL_REMINDER: 'reminder', RFA_SUBMITTED: 'submission confirmation', RFA_RESUBMITTED: 'resubmission confirmation',
  RFA_RETURNED: 'returned notice', RFA_DISAPPROVED: 'disapproval notice', RFA_APPROVED: 'approval notice', RFA_CLOSED: 'closing notice', WORKFLOW_EXCEPTION: 'administrator alert'
};
function visibleAudit(entries: Audit[]): Audit[] { return entries.filter((entry) => !HIDDEN_AUDIT.has(entry.ACTION)); }
function auditLabel(action: string): string { return AUDIT_LABELS[action] ?? action.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
function auditRemarks(entry: Audit): string {
  if (entry.ACTION === 'EMAIL_SENT' || entry.ACTION === 'EMAIL_FAILED') return EMAIL_KINDS[entry.REMARKS] ?? entry.REMARKS;
  return entry.REMARKS;
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'wide' : ''}><span>{label}</span><b>{value || '—'}</b></div>;
}

function DocumentSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="document-section"><h2>{title}</h2>{children}</section>;
}

function currentSubmissionActions(rfa: Rfa, step: ApprovalStep, approvals: Approval[]): Approval[] {
  const submittedAt = Date.parse(rfa.SUBMITTED_AT);
  return approvals.filter((item) => item.STEP === step && item.ACTION && (!Number.isFinite(submittedAt) || Date.parse(item.TIMESTAMP) >= submittedAt));
}

function assignmentRows(step: ApprovalStep, approvals: Approval[]): Approval[] {
  return approvals.filter((item) => item.STEP === step && !item.ACTION);
}

function WorkflowStep({ step, index, rfa, approvals, current, notApplicable }: { step: ApprovalStep; index: number; rfa: Rfa; approvals: Approval[]; current: boolean; notApplicable: boolean }) {
  const assigned = assignmentRows(step, approvals);
  const approvedUsers = new Set(currentSubmissionActions(rfa, step, approvals).filter((item) => item.ACTION === 'APPROVED').map((item) => item.APPROVER_USER_ID));
  const completed = assigned.length ? assigned.every((item) => approvedUsers.has(item.APPROVER_USER_ID)) : approvedUsers.size > 0;
  const exception = approvals.some((item) => item.STEP === step && ['RETURNED','DISAPPROVED','EXCEPTION'].includes(item.ACTION));
  return <div className={`${completed ? 'completed' : ''} ${current ? 'current' : ''} ${exception ? 'exception' : ''} ${notApplicable ? 'skipped' : ''}`}>
    <span>{completed ? <Check size={14} /> : index + 1}</span>
    <b>{stepLabel(step)}</b>
    <small>{notApplicable ? 'N/A' : completed ? 'Complete' : current ? 'Awaiting action' : exception ? 'Action recorded' : 'Pending'}</small>
  </div>;
}

const WAITING_FOR_TIER = ['Waiting for Finance approval', 'Waiting for VP approval'];

/**
 * Approved By emails go out in order (Finance official, then the VPs, then the President).
 * Returns, per approver user ID, the waiting label for officials not yet emailed.
 */
function approvedByWaiting(rfa: Rfa, approvals: Approval[], order: Record<string, number> = {}): Map<string, string> {
  const waiting = new Map<string, string>();
  const approved = new Set(currentSubmissionActions(rfa, 'APPROVED_BY', approvals).filter((item) => item.ACTION === 'APPROVED').map((item) => item.APPROVER_USER_ID));
  const pending = assignmentRows('APPROVED_BY', approvals).filter((row) => !approved.has(row.APPROVER_USER_ID) && row.APPROVER_USER_ID in order);
  if (!pending.length) return waiting;
  const firstTier = Math.min(...pending.map((row) => order[row.APPROVER_USER_ID]));
  for (const row of pending) if (order[row.APPROVER_USER_ID] > firstTier) waiting.set(row.APPROVER_USER_ID, WAITING_FOR_TIER[firstTier] ?? 'Waiting for prior approver');
  return waiting;
}

function ApprovalSignature({ step, rfa, approvals, current, notApplicable, approvedByOrder = {} }: { step: ApprovalStep; rfa: Rfa; approvals: Approval[]; current: boolean; notApplicable: boolean; approvedByOrder?: Record<string, number> }) {
  const assigned = assignmentRows(step, approvals);
  if (step === 'APPROVED_BY') assigned.sort((a, b) => (approvedByOrder[a.APPROVER_USER_ID] ?? 1) - (approvedByOrder[b.APPROVER_USER_ID] ?? 1));
  const waiting = step === 'APPROVED_BY' ? approvedByWaiting(rfa, approvals, approvedByOrder) : new Map<string, string>();
  const actions = new Map(currentSubmissionActions(rfa, step, approvals).map((item) => [item.APPROVER_USER_ID, item]));
  const fallback = [...currentSubmissionActions(rfa, step, approvals)].reverse()[0];
  return <div>
    <b>{stepLabel(step).toUpperCase()}</b>
    {notApplicable ? <strong>N/A</strong> : assigned.length > 0 ? <ul className="signature-assignees">
      {assigned.map((employee) => {
        const action = actions.get(employee.APPROVER_USER_ID);
        return <li key={employee.APPROVAL_ID}><strong>{displayName(employee.APPROVER_NAME)}</strong><span>{action ? `${actionLabel(step, action.ACTION)} · ${dateTime(action.TIMESTAMP)}` : current ? (waiting.get(employee.APPROVER_USER_ID) ?? 'Awaiting action') : 'Waiting for prior stage'}</span></li>;
      })}
    </ul> : fallback
      ? <><strong>{fallback.ACTION === 'APPROVED' ? `${step === 'PREPARED_BY' ? 'Sent' : 'Approved'} electronically by ${displayName(fallback.APPROVER_NAME)}` : `${actionLabel(step, fallback.ACTION)} by ${displayName(fallback.APPROVER_NAME)}`}</strong><span>{dateTime(fallback.TIMESTAMP)}</span></>
      : <strong>Pending electronic approval</strong>}
  </div>;
}

const HISTORY_STEP_ORDER = ['PREPARED_BY', 'RECOMMENDING_APPROVAL', 'REVIEWED_AND_NOTED', 'REVIEWED_BY', 'NOTED_BY', 'INVOLVED_DEPARTMENT_HEAD', 'APPROVED_BY'];
const ACTION_LABELS: Record<string, string> = { APPROVED: 'Approved', RETURNED: 'Returned', DISAPPROVED: 'Disapproved', CANCELLED: 'Cancelled' };

/** The requester's own Prepared By row is stored as APPROVED but means the RFA was sent, not self-approved. */
function actionLabel(step: string, action: string): string {
  if (step === 'PREPARED_BY' && action === 'APPROVED') return 'Sent';
  return ACTION_LABELS[action] ?? action;
}

function sameApprover(a: Approval, b: Approval): boolean {
  if (a.APPROVER_USER_ID && b.APPROVER_USER_ID) return a.APPROVER_USER_ID === b.APPROVER_USER_ID;
  return Boolean(a.APPROVER_EMAIL) && a.APPROVER_EMAIL.toLowerCase() === (b.APPROVER_EMAIL || '').toLowerCase();
}

function HistoryTable({ approvals, status, waiting = new Map<string, string>(), rfaId = '' }: { approvals: Approval[]; status: string; waiting?: Map<string, string>; rfaId?: string }) {
  const { user } = useAuth();
  const canHandOver = Boolean(user?.IS_ADMIN) && Boolean(rfaId);
  const awaiting = status === 'SUBMITTED' || status.startsWith('PENDING_');
  // An assignment row (no action yet) is hidden once that approver has acted on the same step.
  const rows = approvals
    .filter((row) => row.ACTION || !approvals.some((other) => other.ACTION && other.STEP === row.STEP && sameApprover(other, row) && other.TIMESTAMP >= row.TIMESTAMP))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byStep = (HISTORY_STEP_ORDER.indexOf(a.row.STEP) + 1 || 99) - (HISTORY_STEP_ORDER.indexOf(b.row.STEP) + 1 || 99);
      return byStep || (a.row.STEP === 'APPROVED_BY' && !a.row.ACTION && !b.row.ACTION ? Number(waiting.has(a.row.APPROVER_USER_ID)) - Number(waiting.has(b.row.APPROVER_USER_ID)) : 0) || String(a.row.TIMESTAMP).localeCompare(String(b.row.TIMESTAMP)) || a.index - b.index;
    })
    .map(({ row }) => row);
  return rows.length ? <div className="table-wrap">
    <table>
      <thead><tr><th>Step</th><th>Approver</th><th>Action</th><th>Remarks</th><th>Date and Time</th></tr></thead>
      <tbody>{rows.map((approval) => {
        const acted = Boolean(approval.ACTION);
        const sent = approval.STEP === 'PREPARED_BY' && approval.ACTION === 'APPROVED';
        const waitingLabel = !acted && awaiting && approval.STEP === 'APPROVED_BY' ? waiting.get(approval.APPROVER_USER_ID) : undefined;
        const label = acted ? actionLabel(approval.STEP, approval.ACTION) : waitingLabel ?? (awaiting ? 'Pending' : 'Not reached');
        return <tr key={approval.APPROVAL_ID}>
          <td data-label="Step">{stepLabel(approval.STEP)}</td>
          <td data-label="Approver">{approval.APPROVER_NAME ? displayName(approval.APPROVER_NAME) : 'System'}{canHandOver && !acted && awaiting && approval.APPROVER_USER_ID && <Link className="handover-link" to={`/admin?tab=users&handover=${encodeURIComponent(approval.APPROVER_USER_ID)}&rfa=${encodeURIComponent(rfaId)}`}>Hand over</Link>}</td>
          <td data-label="Action"><span className={`history-action history-action-${sent ? 'sent' : acted ? approval.ACTION.toLowerCase() : waitingLabel ? 'idle' : awaiting ? 'pending' : 'idle'}`}>{label}</span></td>
          <td data-label="Remarks">{String(approval.REMARKS || '').replace(/ \(#[^)]+\)$/, '') || '—'}</td>
          <td data-label={acted ? 'Date and Time' : 'Assigned'}>{acted ? dateTime(approval.TIMESTAMP) : <span className="history-muted">Assigned {dateTime(approval.TIMESTAMP)}</span>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div> : <p>No approval actions recorded.</p>;
}
