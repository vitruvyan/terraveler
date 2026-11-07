/** Presentation derived from records, never an inferred project/draft link. */
export type DeskSubmission = {
  id: number; type: string; target_voyage: string | null; status: string;
  carta_version: string; created_at: string; payload: any;
  contributor: { handle: string; rank: string } | null;
  audit: { actor: string; action: string; verdict: string | null; findings: any; created_at: string }[];
  reviews: { reviewer: { handle: string; rank: string } | null; verdict: string; findings: any; created_at: string }[];
  escalated: boolean;
};
export const INTENT_TYPES = new Set(['idea', 'content-suggestion', 'feature-suggestion']);
export function submissionTitle(s: Pick<DeskSubmission, 'id'|'payload'|'target_voyage'|'type'>): string {
  const candidates = [s.payload?.title, s.payload?.meta?.title, s.payload?.meta?.voyage_title, s.payload?.voyage?.title, s.target_voyage];
  return candidates.find(v => typeof v === 'string' && v.trim()) ?? `Untitled ${s.type} #${s.id}`;
}
export function publicationRecord(s: DeskSubmission) {
  return [...s.audit].reverse().find(a => ['publish', 'publish-forced'].includes(a.action));
}
export function humanAuthorization(s: DeskSubmission) {
  const latest = [...s.audit].reverse().find(a => a.action === 'verdict');
  return latest?.actor === 'editor-in-chief' && latest.verdict === 'approve' ? latest : undefined;
}
export function submissionNextStep(s: DeskSubmission): string {
  if (publicationRecord(s)) return publicationRecord(s)?.action === 'publish-forced' ? 'Forced publication recorded — deployment not verified here' : 'Publication recorded — deployment not verified here';
  if (s.status === 'approved') {
    if (INTENT_TYPES.has(s.type)) return 'Idea approved — follow the work in Content';
    return humanAuthorization(s) ? 'Authorized by you — awaiting the Publisher' : 'Approved by an agent — human authorization not recorded';
  }
  if (s.status === 'changes-requested') return 'Author must address the requested changes';
  if (['rejected','curator-rejected'].includes(s.status)) return 'Rejected — inspect the recorded reasons';
  if (s.status === 'appealed') return 'Your decision on the appeal is required';
  if (INTENT_TYPES.has(s.type)) return 'Your decision on the proposal is required';
  const refutes = s.reviews.filter(r => r.verdict === 'refute').length;
  if (s.reviews.length < 2 || refutes) return `Agent review: ${s.reviews.length} recorded, ${refutes} refuting — dossier needs attention`;
  return 'Agent reviews recorded — awaiting your authorization';
}
export function mayRule(s: DeskSubmission): boolean {
  return ['submitted','peer-review','human-review','changes-requested','appealed'].includes(s.status)
    || (s.status === 'approved' && !INTENT_TYPES.has(s.type) && !humanAuthorization(s) && !publicationRecord(s));
}

export function decisionQueues(groups: { needs_verdict: DeskSubmission[]; peer_review: DeskSubmission[]; history: DeskSubmission[] }) {
  const awaiting = groups.history.filter(s => s.status === 'approved' && !INTENT_TYPES.has(s.type) && mayRule(s));
  return { ...groups, needs_verdict: [...groups.needs_verdict, ...awaiting], history: groups.history.filter(s => !awaiting.includes(s)) };
}
export function appealReason(s: DeskSubmission): string {
  const row = [...s.audit].reverse().find(a => a.action === 'appeal');
  const first = Array.isArray(row?.findings) ? row.findings[0] : null;
  return Array.isArray(first) ? String(first[2] ?? 'Grounds not recorded') : 'Grounds not found in the record. Inspect the audit trail.';
}
