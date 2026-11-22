// Build the public allowlisted dist/ root before opening the local server.
await import('./build.mjs');
const {startBrainServer}=await import('../server/brain-api.mjs');
await startBrainServer();
