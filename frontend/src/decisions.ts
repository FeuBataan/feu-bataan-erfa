import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Approve / Return / Disapprove save in the background, so the approver goes straight back
 * to For My Action while eRFA records the decision. The queue hides that RFA at once and
 * shows a short note while it saves, then when it is done (or what went wrong).
 */

export type DecisionAction = 'approve' | 'return' | 'disapprove';
export type Decision = {
  rfaId: string;
  label: string; // RFA number, or the title for an unnumbered RFA
  action: DecisionAction;
  remarks: string;
  state: 'saving' | 'done' | 'failed';
  error?: string;
  finishedAt?: number;
};

let decisions: Decision[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function put(next: Decision) {
  decisions = [...decisions.filter((item) => item.rfaId !== next.rfaId), next];
  emit();
}

/** Start saving a decision; resolves when the server has recorded it (rejects if it failed). */
export function startDecision(rfaId: string, label: string, action: DecisionAction, remarks: string): Promise<void> {
  put({ rfaId, label, action, remarks, state: 'saving' });
  return api(`rfa.${action}`, { rfaId, remarks }).then(
    () => { put({ rfaId, label, action, remarks, state: 'done', finishedAt: Date.now() }); },
    (caught: unknown) => {
      put({ rfaId, label, action, remarks, state: 'failed', error: caught instanceof Error ? caught.message : 'The decision could not be saved.', finishedAt: Date.now() });
      throw caught;
    }
  );
}

/** Be told when a decision starts, finishes or fails. */
export function onDecisionsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function dismissDecision(rfaId: string) {
  decisions = decisions.filter((item) => item.rfaId !== rfaId);
  emit();
}

/** A decision on this RFA that failed, so its page can offer to try again with the same remarks. */
export function failedDecision(rfaId: string): Decision | undefined {
  return decisions.find((item) => item.rfaId === rfaId && item.state === 'failed');
}

/**
 * Whether a queue loaded at `loadedAt` may still list an RFA the approver has just decided:
 * while it saves, and if it finished after that list was loaded.
 */
export function hiddenFromQueue(rfaId: string, loadedAt: number): boolean {
  const item = decisions.find((entry) => entry.rfaId === rfaId);
  if (!item) return false;
  if (item.state === 'saving') return true;
  return item.state === 'done' && (item.finishedAt ?? 0) > loadedAt;
}

export function useDecisions(): Decision[] {
  const [items, setItems] = useState(decisions);
  useEffect(() => {
    const update = () => setItems(decisions);
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);
  return items;
}

export function decisionText(item: Decision): string {
  const verb = { approve: ['Recording your approval of', 'Approved'], return: ['Returning', 'Returned'], disapprove: ['Recording the disapproval of', 'Disapproved'] }[item.action];
  if (item.state === 'saving') return `${verb[0]} ${item.label}…`;
  if (item.state === 'done') return item.action === 'return' ? `${item.label} was returned to the requester.` : `${verb[1]} ${item.label}.`;
  return `${item.label} was not ${item.action === 'approve' ? 'approved' : item.action === 'return' ? 'returned' : 'disapproved'}: ${item.error}`;
}
