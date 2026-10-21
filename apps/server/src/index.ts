import { createTori } from './server.js';
const port = Number(process.env.PORT || 3000);
const server = await createTori({ production: process.argv.includes('--production') || process.env.NODE_ENV === 'production' });
server.http.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`\n  Tori is ready → http://localhost:${port}\n  Other devices: use this machine’s LAN address and port ${port}.\n`);
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return; closing = true;
  await server.close(); process.exit(0);
});
