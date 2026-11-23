import { randomUUID } from 'node:crypto';

/** Localhost-only World clock with independent bounded per-world workers. */
export function createWorldAutonomyScheduler({ store, now = () => Date.now(), intervalMs = 5000,
  maxWorlds = 8, maxActors = 3, onError = () => {} } = {}) {
  if (!store || !Number.isSafeInteger(intervalMs) || intervalMs < 1000 ||
      !Number.isSafeInteger(maxWorlds) || maxWorlds < 1 ||
      !Number.isSafeInteger(maxActors) || maxActors < 1 || maxActors > 4)
    throw new Error('Invalid autonomous scheduler configuration');

  let scanning = false, timer = null, cursor = 0;
  // This is process-local. WorldStore serializes each world's writes and
  // checks its durable revision; inFlight prevents duplicate scheduler turns.
  const inFlight = new Set();

  function report(result, worldId, error, fallback) {
    const incident = { world_id: worldId, code: String(error?.code || fallback).slice(0, 80) };
    result.errors.push(incident);
    // Logging/reporting must not knock out another world's scheduler work.
    try { onError(incident); } catch { /* noncritical observer failure */ }
  }

  async function processWorld({ entry, snapshot, minutes }, result) {
    try {
      if (snapshot.world.brainEnabled === true) {
        // Native cognition is opt-in. Missing providers fail closed; ordinary
        // routines may not impersonate a previously enabled Character Brain.
        const reconciled = await store.reconcile(entry.id);
        const stepped = await store.autonomousTick(entry.id, {
          operation_id: 'autonomy:' + randomUUID(),
          expected_revision: reconciled.revision, expected_hash: reconciled.hash,
          minutes, max_actors: maxActors,
        });
        result.processed++;
        result.decisions += stepped.decisions.length;
        await store.reconcile(entry.id);
      } else {
        await store.mutate(entry.id, {
          operation_id: 'world-clock:' + randomUUID(),
          expected_revision: snapshot.revision, expected_hash: snapshot.hash,
          type: 'advance', args: { minutes },
        });
        result.processed++;
      }
    } catch (error) {
      report(result, entry.id, error, 'AUTONOMY_TICK_FAILED');
    } finally {
      // A hung provider occupies only its own slot, never the scan lock.
      inFlight.delete(entry.id);
    }
  }

  async function tickOnce() {
    if (scanning) return { skipped: 'scan-in-progress', processed: 0, decisions: 0, errors: [] };
    scanning = true;
    const result = { processed: 0, decisions: 0, errors: [] };
    const selected = [];
    try {
      const worlds = (await store.list()).sort((a, b) => a.id.localeCompare(b.id));
      // Bound live scheduler workers globally, not just launches per scan.
      const slots = Math.max(0, maxWorlds - inFlight.size);
      let scanned = 0;
      if (worlds.length && slots) {
        for (let offset = 0; offset < worlds.length && selected.length < slots; offset++) {
          const entry = worlds[(cursor + offset) % worlds.length];
          scanned++;
          if (inFlight.has(entry.id)) continue;
          try {
            const snapshot = await store.get(entry.id);
            if (snapshot.world.paused) continue;
            // The same wall-time gap cannot be counted a second time once
            // WorldStore has committed its updated savedAt clock anchor.
            const elapsed = Math.max(0, Math.floor((now() - snapshot.world.savedAt) / 1000));
            const minutes = Math.min(120, elapsed * snapshot.world.speed);
            if (minutes < 5) continue;
            inFlight.add(entry.id); // Reserve before releasing the scan lock.
            selected.push({ entry, snapshot, minutes });
          } catch (error) {
            report(result, entry.id, error, 'AUTONOMY_WORLD_READ_FAILED');
          }
        }
        cursor = (cursor + scanned) % worlds.length;
      }
    } catch (error) {
      report(result, null, error, 'AUTONOMY_SCAN_FAILED');
    } finally {
      // Do not await Native providers while holding this global scan lock.
      scanning = false;
    }

    // Concurrent scans can now launch work for *other* worlds. Each world has
    // at most one in-flight task; total unfinished tasks never exceeds slots.
    await Promise.all(selected.map(item => processWorld(item, result)));
    return result;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { void tickOnce(); }, intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { tickOnce, start, stop, get running() { return Boolean(timer); },
    get activeWorlds() { return inFlight.size; } };
}
