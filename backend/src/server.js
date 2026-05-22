import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import instancesRouter from './routes/instances.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

app.use('/api/instances', instancesRouter);

// Serve built React frontend
const distPath = join(__dirname, '../../frontend/dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const BREAKGLASS_PORT = parseInt(process.env.BREAKGLASS_PORT ?? '0', 10);

createServer(app).listen(PORT, '0.0.0.0', () =>
  console.log(`[server] Listening on :${PORT}`)
);

if (BREAKGLASS_PORT > 0) {
  createServer(app).listen(BREAKGLASS_PORT, '0.0.0.0', () =>
    console.log(`[server] Break-glass listening on :${BREAKGLASS_PORT}`)
  );
}
