import { createHash } from 'node:crypto';

// Receipt identities are reproducible on either side of the Mi World / Native
// boundary. This is an integrity/audit correlation token, NOT a signature or
// proof of client identity. Only the server-authoritative World may originate it.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assert = condition => { if (!condition) throw Object.assign(new Error('Invalid cross-system receipt evidence'), { code: 'MI_RECEIPT_INVALID' }); };
export const MI_RECEIPT_VERSION = 1;

export function expectedMiAcknowledgement(feedback, source = 'mi_server_verified') {
  assert(feedback && typeof feedback === 'object' && !Array.isArray(feedback));
  assert(typeof feedback.world_id === 'string' && /^(srv_)?[\w-]{8,128}$/.test(feedback.world_id));
  assert(typeof feedback.actor_id === 'string' && /^[\w-]{1,80}$/.test(feedback.actor_id));
  assert(typeof feedback.decision_id === 'string' && /^[a-f0-9]{64}$/.test(feedback.decision_id));
  assert(typeof feedback.action_id === 'string' && feedback.action_id.length > 0 && feedback.action_id.length <= 100);
  assert(['observed', 'arrived', 'investigated', 'not_confirmed', 'interrupted'].includes(feedback.kind));
  assert(typeof feedback.place_id === 'string' && /^[a-z0-9_-]{1,80}$/.test(feedback.place_id));
  assert(Number.isSafeInteger(feedback.world_minute) && feedback.world_minute >= 0);
  assert(source === 'mi_server_verified' || source === 'mi_client_reported');
  return {
    version: MI_RECEIPT_VERSION,
    receipt_id: `mi_receipt_${hash([feedback.world_id, feedback.decision_id]).slice(0, 32)}`,
    evidence_hash: hash([feedback.world_id, feedback.actor_id, feedback.decision_id,
      feedback.action_id, feedback.kind, feedback.place_id, feedback.world_minute, source]),
    source,
  };
}

export function verifyMiAcknowledgement(feedback, actual, source = 'mi_server_verified') {
  const expected = expectedMiAcknowledgement(feedback, source);
  if (!actual || expected.version !== actual.version || expected.receipt_id !== actual.receipt_id ||
      expected.evidence_hash !== actual.evidence_hash || expected.source !== actual.source) {
    throw Object.assign(new Error('Native acknowledgement does not match the World committed evidence'), {
      code: 'MI_RECEIPT_MISMATCH',
    });
  }
  return expected;
}
