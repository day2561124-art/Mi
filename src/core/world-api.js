/** Browser transport for the optional single-user, localhost Node World authority. */
async function request(path, method = 'GET', payload) {
 const response = await fetch(`/api/worlds${path}`, {
  method, cache: 'no-store',
  ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
 });
 let data = null;
 try { data = await response.json(); } catch { /* Handle missing or invalid response below. */ }
 if (!response.ok || !data) {
  const error = new Error(data?.message || `伺服器世界請求失敗（${response.status}）`);
  error.code = data?.error || 'WORLD_SERVER_UNAVAILABLE';
  error.status = response.status;
  throw error;
 }
 return data;
}
export const worldAPI = {
 list: async () => (await request('')).worlds,
 create: (name, custom) => request('', 'POST', { name, custom }),
 migrate: world => request('/migrate', 'POST', { world }),
 get: id => request(`/${encodeURIComponent(id)}`),
 command: (id, current, type, args = {}) => request(`/${encodeURIComponent(id)}/commands`, 'POST', {
  operation_id: crypto.randomUUID(), expected_revision: current.revision, expected_hash: current.hash, type, args,
 }),
 decide: (id, current, actor_id) => request(`/${encodeURIComponent(id)}/brain-turn`, 'POST', {
  operation_id: crypto.randomUUID(), expected_revision: current.revision, expected_hash: current.hash, actor_id,
 }),
 reconcile: id => request(`/${encodeURIComponent(id)}/reconcile`, 'POST', {}),
};
