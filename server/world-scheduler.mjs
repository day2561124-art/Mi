import { randomUUID } from 'node:crypto';

/** Localhost-only World clock with optional Native decisions and explicit stop(). */
export function createWorldAutonomyScheduler({ store, now = () => Date.now(), intervalMs = 5000,
  maxWorlds = 8, maxActors = 3, onError = () => {} } = {}) {
  if (!store || !Number.isSafeInteger(intervalMs) || intervalMs < 1000)
    throw new Error('Invalid autonomous scheduler configuration');
  let busy = false, timer = null, cursor = 0;
  async function tickOnce() {
    if (busy) return { skipped: 'busy', processed: 0, errors: [] };
    busy = true;
    const result = { processed: 0, decisions: 0, errors: [] };
    try {
      const worlds = (await store.list()).sort((a, b) => a.id.localeCompare(b.id));
      const selected = [];
      let scanned = 0;
      if (worlds.length) {
        for (let offset = 0; offset < worlds.length && selected.length < maxWorlds; offset++) {
          const entry = worlds[(cursor + offset) % worlds.length];
          scanned++;
          try {
            const snapshot = await store.get(entry.id);
            if (!snapshot.world.paused)
              selected.push({ entry, snapshot });
          } catch (error) {
            const incident = { world_id: entry.id, code: String(error?.code || 'AUTONOMY_WORLD_READ_FAILED') };
            result.errors.push(incident); onError(incident);
          }
        }
        cursor = (cursor + scanned) % worlds.length;
      }
      // Separate World queues let other worlds keep progressing even if one
      // Native provider is slow. All worlds are bounded by maxWorlds.
      await Promise.all(selected.map(async ({ entry, snapshot }) => {
        try {
          // Align with the existing 1 real-second = 1 simulated-minute pace.
          // Offline gaps are deliberately capped; this is not unbounded backfill.
          const elapsed = Math.max(0, Math.floor((now() - snapshot.world.savedAt) / 1000));
          const minutes = Math.min(120, elapsed * snapshot.world.speed);
          if (minutes < 5) return;
          if (snapshot.world.brainEnabled === true) {
            // Native cognition is opt-in. If its provider is unavailable,
            // autonomousTick fails closed instead of silently using rules.
            const reconciled = await store.reconcile(entry.id);
            const stepped = await store.autonomousTick(entry.id, {
              operation_id: `autonomy:${randomUUID()}`,
              expected_revision: reconciled.revision, expected_hash: reconciled.hash,
              minutes, max_actors: maxActors,
            });
            result.processed++;
            result.decisions += stepped.decisions.length;
            await store.reconcile(entry.id);
          } else {
            // The World clock and ordinary NPC routine do not need a Brain.
            // The server commits time exactly once; browsers only poll it.
            await store.mutate(entry.id, {
              operation_id: `world-clock:${randomUUID()}`,
              expected_revision: snapshot.revision, expected_hash: snapshot.hash,
              type: 'advance', args: { minutes },
            });
            result.processed++;
          }
        } catch (error) {
          const incident = { world_id: entry.id, code: String(error?.code || 'AUTONOMY_TICK_FAILED') };
          result.errors.push(incident);
          onError(incident);
        }
      }));
    } catch (error) {
      const incident = { world_id: null, code: String(error?.code || 'AUTONOMY_SCAN_FAILED') };
      result.errors.push(incident); onError(incident);
    } finally { busy = false; }
    return result;
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { void tickOnce(); }, intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { tickOnce, start, stop, get running() { return Boolean(timer); } };
}
