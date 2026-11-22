// Bounded Phase63C resolver for Mi's own previously encoded, server-verified
// action records. It selects an existing subjective memory reference only.
// wRITE remains the sole authority for retrieval materialization and Current Mind.
export const MI_VERIFIED_RECORD_CUE = '米花伺服器已保存並核對的歷史行動紀錄';

const noProcess = () => ({ process_occurred: false });
const boundedString = value => typeof value === 'string' && value.length <= 2000 ? value : null;

export function createMiMemoryRetrievalResolver({ onResolution } = {}) {
  return async function resolveMiMemory(input = {}) {
    const candidates = input.candidate_memory_records;
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 256) return noProcess();
    // The cue is the character's own continuing goal to assess the next step.
    // Not every memory is spontaneously recalled, and raw scene/world state is
    // never exposed to this resolver.
    const state = input.character_state ?? {};
    const goal = boundedString(state.current_goal) ?? '';
    if (!goal.includes('下一步') && !goal.includes('回想') && !goal.includes('查證')) return noProcess();
    const visible = JSON.stringify(input.perception?.observed ?? []);
    // When already looking at the same personal record, that is perception,
    // not a claim that a memory retrieval just occurred.
    if (visible.includes(MI_VERIFIED_RECORD_CUE)) return noProcess();

    const relevant = candidates.filter(record =>
      record && typeof record === 'object' &&
      /^memory_[a-f0-9]{24}$/.test(record.memory_id ?? '') &&
      boundedString(record.content)?.includes(MI_VERIFIED_RECORD_CUE) &&
      record.source?.kind === 'direct_perception' &&
      record.engine_persisted_trace === true &&
      record.suppressed !== true && record.accessible !== false
    );
    if (!relevant.length) return noProcess();
    const chosen = relevant.sort((a,b) =>
      String(b.encoded_at ?? '').localeCompare(String(a.encoded_at ?? '')) ||
      a.memory_id.localeCompare(b.memory_id))[0];
    const resolution = {
      process_occurred: true,
      initiation: { mode: 'deliberate', trigger_origin: 'self_generated' },
      retrieval_task: { mode: 'cued_recall' },
      target: { kind: 'memory_ref', memory_id: chosen.memory_id },
      contacted_candidate_refs: [chosen.memory_id],
      recovered_selections: [{
        source_memory_ref: chosen.memory_id,
        selector: { kind: 'whole_content' },
        content_kind: 'detail',
        target_relation: 'target_related',
      }],
    };
    if (typeof onResolution === 'function') onResolution({
      character: input.character, candidate_count: candidates.length,
      selected_memory_id: chosen.memory_id,
    });
    return resolution;
  };
}
