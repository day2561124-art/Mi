// Map only server-settled Mi actions to wRITE Phase76A/76B. The bridge never
// asserts that an action was performed from a proposed intent alone, nor does
// it write directly to upstream memory or Current Mind.
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });
export const MI_PHASE76_KIND = 'post_outcome_action_experience';

const outcomeNarrative = Object.freeze({
  observed: ['我在原地持續觀察了一段時間。', 'observed'],
  arrived: ['我已抵達原本要去的地點。', 'arrived'],
  investigated: ['我已實際查看那項線索。', 'investigated'],
  not_confirmed: ['這次調查仍沒有足夠證據確認線索。', 'not_confirmed'],
  interrupted: ['原本的行動遭到中斷，結果尚未完成。', 'interrupted'],
});

export function phase76Available(upstream) {
  return typeof upstream?.projectWorldSimulationPostOutcomeSubjectivePerception === 'function'
    && typeof upstream?.bridgeWorldSimulationPostOutcomeSubjectiveExperienceToMemory === 'function';
}

export function createMiPhase76Receipt({ feedback, selection, upstream }) {
  if (!phase76Available(upstream)) return null;
  if (feedback?.source !== 'mi_server_verified' ||
      !/^[a-f0-9]{64}$/.test(feedback.decision_id ?? '') ||
      selection?.actor_id !== feedback.actor_id ||
      selection?.action_id !== feedback.action_id ||
      !selection.actor_name || !selection.intent ||
      !outcomeNarrative[feedback.kind]) {
    throw failure('MI_PHASE76_SOURCE_INVALID', 'Phase76 只接受已核實且可追溯的角色行動結果。');
  }
  const character = `${selection.actor_name} (${selection.actor_id})`;
  const turnId = `mi_settled_${hash({ decision: feedback.decision_id, minute: feedback.world_minute, kind: feedback.kind }).slice(0, 24)}`;
  const selected = [{
    character, action_id: feedback.action_id, intent: selection.intent,
    selection: 'candidate_action_intent',
  }];
  // The output label and hidden reasons are never forwarded as perceived
  // success, and interrupted journeys are not falsely claimed as performed.
  const [perceived_result, perceived_status] = outcomeNarrative[feedback.kind];
  const outcome = {
    actor: character,
    action_id: feedback.action_id,
    character_experience: {
      ...(feedback.kind === 'interrupted' ? {} : { performed: true }),
      perceived_result,
      perceived_status,
    },
  };
  const projection = upstream.projectWorldSimulationPostOutcomeSubjectivePerception({
    turn_id: turnId, selected_action_intents: selected,
    action_outcomes: [outcome], state_transitions: [],
  });
  const bridge = upstream.bridgeWorldSimulationPostOutcomeSubjectiveExperienceToMemory({
    turn_id: turnId,
    selected_action_intents: selected,
    post_outcome_subjective_perception_projection: projection,
  });
  if (bridge.memory_formation_packets?.length !== 1 ||
      bridge.memory_formation_packets[0].character !== character ||
      bridge.memory_formation_packets[0].perception.other_senses?.length !== 1) {
    throw failure('MI_PHASE76_BRIDGE_INVALID', 'Phase76 無法確認角色專屬經驗來源。');
  }
  // Store provenance for crash/restart replay; not the raw server World or
  // subjective content authored by an untrusted browser client.
  return { turn_id: turnId, selected_action_intents: selected,
    post_outcome_subjective_perception_projection: projection };
}

export function readMiPhase76Observations(receipt, upstream, expectedCharacter) {
  if (!phase76Available(upstream) || !receipt) return [];
  const bridge = upstream.bridgeWorldSimulationPostOutcomeSubjectiveExperienceToMemory({
    turn_id: receipt.turn_id,
    selected_action_intents: receipt.selected_action_intents,
    post_outcome_subjective_perception_projection: receipt.post_outcome_subjective_perception_projection,
  });
  if (bridge.memory_formation_packets.length !== 1 ||
      bridge.memory_formation_packets[0].character !== expectedCharacter) {
    throw failure('MI_PHASE76_ROLE_MISMATCH', '角色不能取得其他人的行動經驗。');
  }
  const result = bridge.memory_formation_packets[0].perception.other_senses;
  if (result.length !== 1 || result[0]?.kind !== MI_PHASE76_KIND) {
    throw failure('MI_PHASE76_BRIDGE_INVALID', '主觀經驗缺少正式來源。');
  }
  return structuredClone(result);
}
