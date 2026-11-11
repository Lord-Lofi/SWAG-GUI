import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import instancesRouter from './routes/instances.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { requireSameOrigin } from './middleware/sameOrigin.js';
import { breakGlassAuth, loadBreakGlassCredential } from './middleware/breakGlassAuth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '../../frontend/dist');

// Builds one copy of the app. The break-glass port gets its own copy with a
// password check in front, because it bypasses SWAG and Authelia.
function buildApp({ auth } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  if (auth) app.use(auth);

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireSameOrigin);
  app.use('/api/instances', instancesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built React frontend
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => res.sendFile(join(distPath, 'index.html')));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const BREAKGLASS_PORT = parseInt(process.env.BREAKGLASS_PORT ?? '0', 10);

createServer(buildApp()).listen(PORT, '0.0.0.0', () =>
  console.log(`[server] Listening on :${PORT}`)
);

if (BREAKGLASS_PORT > 0) {
  const credential = loadBreakGlassCredential(process.env);
  if (credential) {
    createServer(buildApp({ auth: breakGlassAuth(credential) })).listen(
      BREAKGLASS_PORT,
      '0.0.0.0',
      () => console.log(`[server] Break-glass listening on :${BREAKGLASS_PORT} (password required)`)
    );
  } else {
    console.error(
      '[server] Break-glass NOT started: BREAKGLASS_PORT is set but BREAKGLASS_PASSWORD_HASH ' +
        'is missing or invalid. Generate one with: npm run hash-password'
    );
  }
}
