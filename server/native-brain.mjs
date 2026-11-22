import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMIT = 200;
const string = (value, limit = 240) => String(value ?? '').slice(0, limit);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const fail = (code, message) => Object.assign(new Error(message), { code });

export async function loadNativeRuntime(root = process.env.WRITE_ROOT || resolve('vendor/wRITE')) {
  const base = join(resolve(root), 'server', 'src');
  const [session, loop, state] = await Promise.all([
    import(pathToFileURL(join(base, 'world-simulation-session-service.mjs')).href),
    import(pathToFileURL(join(base, 'world-simulation-loop-service.mjs')).href),
    import(pathToFileURL(join(base, 'world-simulation-state-service.mjs')).href),
  ]);
  const required = {
    beginWorldSimulationSession: session.beginWorldSimulationSession,
    runWorldSimulationTurn: loop.runWorldSimulationTurn,
    createWorldSimulationCharacterRuntimeManager: loop.createWorldSimulationCharacterRuntimeManager,
    getWorldSimulationState: state.getWorldSimulationState,
    getWorldSimulationHistory: state.getWorldSimulationHistory,
    commitWorldSimulationTurn: state.commitWorldSimulationTurn,
  };
  if (Object.values(required).some(fn => typeof fn !== 'function')) {
    throw fail('NATIVE_RUNTIME_INCOMPATIBLE', 'wRITE Native Loop 入口缺失。');
  }
  return required;
}

export function validateNativeRequest(input) {
  const error = () => { throw fail('INVALID_BRAIN_REQUEST', '角色腦請求格式或長度不正確。'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) error();
  if (!/^[\w-]{8,128}$/.test(input.world_id ?? '') || !/^[\w-]{1,80}$/.test(input.actor_id ?? '')) error();
  if (!Number.isSafeInteger(input.world_minute) || input.world_minute < 0 || input.world_minute > 100_000_000) error();
  const o = input.observer;
  if (!o || typeof o !== 'object' || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 100 || typeof o.place !== 'string' || o.place.length > 100) error();
  for (const prop of ['nearby', 'visible_traces', 'known', 'uncertain']) {
    if (!Array.isArray(o[prop]) || o[prop].length > 20 || o[prop].some(x => typeof x !== 'string' || x.length > 240)) error();
  }
  if (!Array.isArray(input.actions) || input.actions.length > 24) error();
  const used = new Set();
  for (const a of input.actions) {
    if (!a || typeof a.action_id !== 'string' || !/^[a-z0-9:_-]{1,100}$/.test(a.action_id) || typeof a.intent !== 'string' || !a.intent.trim() || a.intent.length > 240 || used.has(a.action_id)) error();
    used.add(a.action_id);
  }
  if (o.energy != null && (!Number.isFinite(o.energy) || o.energy < 0 || o.energy > 100)) error();
  if (o.social != null && (!Number.isFinite(o.social) || o.social < 0 || o.social > 100)) error();
  return input;
}

// The Native engine holds its committed subjective history; this input is an
// externally supplied, locally bounded observation, NOT the full Mi world.
export function nativeWorldProjection(input, prior = {}) {
  validateNativeRequest(input);
  const actor = `${input.observer.name} (${input.actor_id})`;
  const eventId = `mi_evt_${digest({ world: input.world_id, actor: input.actor_id, minute: input.world_minute, observer: input.observer, actions: input.actions }).slice(0, 24)}`;
  const sceneId = 'mi_observation_scene';
  const observer = input.observer;
  const visual = [
    `目前所在：${string(observer.place, 100)}`,
    ...observer.nearby.map(name => `看見：${name}`),
    ...observer.visible_traces.map(t => `現場跡象：${t}`),
  ];
  const old = prior && typeof prior === 'object' ? clone(prior) : {};
  const simulationTime = new Date(Date.UTC(2026, 0, 1, 8, 0) + input.world_minute * 60_000).toISOString();
  return {
    ...old,
    simulation_time: simulationTime,
    event_queue: [{ event_id: eventId, type: 'beika_character_opportunity', scene_id: sceneId, participants: [actor] }],
    scenes: {
      [sceneId]: {
        scene_id: sceneId, simulation_time: simulationTime,
        // Coordinates are an engine-local neutral reference point, not an
        // assertion of real Mi map geometry or through-wall visibility.
        entity_positions: { [actor]: { x: 0, y: 0 } },
        observable_by: { [actor]: { visual, audible: [], other_senses: [] } },
      },
    },
    characters: {
      ...(old.characters || {}),
      [actor]: {
        ...(old.characters?.[actor] || {}),
        known: observer.known,
        guessed: observer.uncertain,
        current_goal: old.characters?.[actor]?.current_goal || '依自己掌握的資訊安排下一步',
        needs: { energy: observer.energy ?? null, social: observer.social ?? null },
      },
    },
    available_actions: {
      [actor]: input.actions.map(a => ({ action_id: a.action_id, intent: a.intent })),
    },
    memories: old.memories || {},
  };
}

async function readIndex(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data?.version === 1 && data.worlds && typeof data.worlds === 'object' ? data : { version: 1, worlds: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, worlds: {} };
    throw error;
  }
}
async function saveIndex(file, payload) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

/** One serial native turn per server process; wRITE owns its own durable history. */
export function createNativeBrainBridge({ upstream, decider, sessionOptions = {}, indexFile = resolve('.beika-private/brain-native-index.json') }) {
  for (const name of ['beginWorldSimulationSession', 'runWorldSimulationTurn', 'createWorldSimulationCharacterRuntimeManager', 'getWorldSimulationState', 'getWorldSimulationHistory', 'commitWorldSimulationTurn']) {
    if (typeof upstream?.[name] !== 'function') throw fail('NATIVE_RUNTIME_INCOMPATIBLE', `缺少上游入口 ${name}`);
  }
  let lock = Promise.resolve();
  let indexPromise = readIndex(indexFile);
  const runtimeManager = upstream.createWorldSimulationCharacterRuntimeManager({
    identityResolver: async character => ({
      entity_id: `beika_${digest(character).slice(0, 32)}`,
      canonical_name: character,
      identity_source: 'beika_stable_actor_identity',
      formal: true,
    }),
  });
  async function run(input) {
    validateNativeRequest(input);
    if (typeof decider !== 'function') throw fail('BRAIN_SELECTOR_NOT_CONFIGURED', '尚未設定 Character Brain 決策提供者。');
    if (!input.actions.length) return { status: 'no_candidate', action_id: null };
    const index = await indexPromise;
    const fingerprint = digest(input);
    const entry = index.worlds[input.world_id];
    if (entry?.fingerprint === fingerprint && entry?.last_response) return clone(entry.last_response);
    if (entry && input.world_minute < entry.last_world_minute) {
      throw fail('NATIVE_WORLD_TIME_REWIND', '世界時間倒退，拒絕寫入既有角色記憶。');
    }
    let sessionId = entry?.session_id;
    let snapshot;
    if (!sessionId) {
      const state = nativeWorldProjection(input);
      const session = await upstream.beginWorldSimulationSession({
        simulation_label: 'beika-native-world',
        seed: input.world_id,
        rules: { event_driven: true, persistent_causality: true },
        initial_world_state: state,
      }, sessionOptions);
      sessionId = session.world_simulation_session_id;
      index.worlds[input.world_id] = { session_id: sessionId, last_world_minute: -1 };
      // Do not lose an initialized session when the process exits before the turn.
      await saveIndex(indexFile, index);
      snapshot = await upstream.getWorldSimulationState(sessionId, sessionOptions);
    } else {
      snapshot = await upstream.getWorldSimulationState(sessionId, sessionOptions);
    }
    const projected = nativeWorldProjection(input, snapshot.state);
    const eventId = projected.event_queue[0].event_id;
    const priorHistory = await upstream.getWorldSimulationHistory(sessionId, sessionOptions);
    const previous = (priorHistory.turns || []).find(t => t?.event?.event_id === eventId && (t?.selected_action_intents || []).length > 0);
    if (previous) {
      const picked = previous.selected_action_intents?.find(x => x.character === `${input.observer.name} (${input.actor_id})`);
      const actionId = picked?.selection === 'reject_all' ? null : (picked?.action_id ?? null);
      const response = { action_id: actionId, status: actionId ? 'selected' : 'rejected', actor_id: input.actor_id, world_minute: input.world_minute, mode: 'native_turn', committed: true, recovered: true };
      index.worlds[input.world_id] = { session_id: sessionId, last_world_minute: input.world_minute, fingerprint, last_response: response };
      await saveIndex(indexFile, index);
      return response;
    }
    // Admit a new Mi observation by World-owned CAS, without giving any
    // unobserved world truth to the Character Brain.
    if (snapshot.state.event_queue?.[0]?.event_id !== eventId) {
      await upstream.commitWorldSimulationTurn(sessionId, {
        expected_revision: snapshot.revision,
        expected_state_hash: snapshot.state_hash,
        turn_id: `mi_sync_${snapshot.revision}_${eventId}`,
        event: { type: 'beika_external_observation', event_id: `mi_sync_${eventId}` },
        next_world_state: projected,
        state_transitions: [],
        action_outcomes: [],
        knowledge_transitions: [],
      }, sessionOptions);
    }
    const offered = new Set(input.actions.map(a => a.action_id));
    const selections = [];
    const outcome = await upstream.runWorldSimulationTurn({ world_simulation_session_id: sessionId, event_id: eventId }, {
      ...sessionOptions,
      characterRuntimeManager: runtimeManager,
      characterBrain: async packet => {
        // The upstream Native cognition (with its own committed memory and
        // experience reentry) builds this packet. An external provider only
        // selects, never edits World/Body truth.
        const result = await decider(packet);
        const id = typeof result === 'string' ? result : result?.action_id;
        if (id === 'reject_all') { selections.push(null); return 'reject_all'; }
        if (!offered.has(id) || !packet.candidate_action_intents?.some(c => c.action_id === id)) {
          throw fail('BRAIN_ACTION_NOT_ALLOWED', '角色選擇了不存在或不可執行的候選行動。');
        }
        selections.push(id);
        return { action_id: id };
      },
      causalAdjudicator: async ({ world_state, event }) => {
        const next = clone(world_state);
        next.event_queue = [];
        // The browser's Mi World still adjudicates movement, investigation,
        // and success. This turn commits an intent only, NEVER fake success.
        return {
          causal_resolution_id: `mi_intent_${event.event_id}`,
          next_world_state: next,
          state_transitions: [], action_outcomes: [], knowledge_transitions: [], scheduled_events: [],
        };
      },
    });
    if (!outcome?.committed) throw fail('NATIVE_TURN_UNCOMMITTED', '上游 Native World 回合未完成提交。');
    const actionId = selections[0] ?? null;
    const response = { action_id: actionId, status: actionId ? 'selected' : 'rejected', actor_id: input.actor_id, world_minute: input.world_minute, mode: 'native_turn', committed: true };
    index.worlds[input.world_id] = { session_id: sessionId, last_world_minute: input.world_minute, fingerprint, last_response: response };
    await saveIndex(indexFile, index);
    return response;
  }
  return {
    decide(input) {
      const current = lock.catch(() => {}).then(() => run(input));
      lock = current.catch(() => {});
      return current;
    },
    status: () => ({ upstream: 'wRITE', connected: true, decision_provider: typeof decider === 'function', mode: 'native_turn', durable_session_index: true, authoritative_mi_execution: false }),
  };
}
