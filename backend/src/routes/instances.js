import { Router } from 'express';
import * as confFiles from '../lib/confFiles.js';
import * as docker from '../lib/docker.js';

const router = Router();

// Instance definitions are derived entirely from environment variables.
// No hostnames, container names, IPs, or paths are hardcoded here.
const instances = {
  external: {
    id: 'external',
    label: 'swag-external',
    container: process.env.SWAG_EXTERNAL_CONTAINER,
    confsPath: process.env.SWAG_EXTERNAL_CONFS_PATH,
  },
  internal: {
    id: 'internal',
    label: 'swag-internal',
    container: process.env.SWAG_INTERNAL_CONTAINER,
    confsPath: process.env.SWAG_INTERNAL_CONFS_PATH,
  },
};

function getInstance(id) {
  const instance = instances[id];
  if (!instance) throw Object.assign(new Error(`Unknown instance: ${id}`), { status: 404 });
  if (!instance.container || !instance.confsPath) {
    throw Object.assign(
      new Error(`Instance "${id}" is not configured — check environment variables`),
      { status: 503 }
    );
  }
  return instance;
}

// GET /api/instances
router.get('/', (_req, res) => {
  res.json(Object.values(instances).map(({ id, label }) => ({ id, label })));
});

// GET /api/instances/:id/confs
router.get('/:id/confs', async (req, res) => {
  const instance = getInstance(req.params.id);
  res.json(await confFiles.list(instance.confsPath));
});

// GET /api/instances/:id/confs/:name
router.get('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  const content = await confFiles.read(instance.confsPath, req.params.name);
  res.json({ content });
});

// PUT /api/instances/:id/confs/:name
router.put('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  await confFiles.write(instance.confsPath, req.params.name, req.body.content);
  res.json({ ok: true });
});

// POST /api/instances/:id/confs/:name/enable  — activate a .conf.sample
router.post('/:id/confs/:name/enable', async (req, res) => {
  const instance = getInstance(req.params.id);
  const created = await confFiles.enableSample(instance.confsPath, req.params.name);
  res.json({ ok: true, created });
});

// DELETE /api/instances/:id/confs/:name
router.delete('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  await confFiles.remove(instance.confsPath, req.params.name);
  res.json({ ok: true });
});

// POST /api/instances/:id/validate — runs nginx -t, returns pass/fail + output
router.post('/:id/validate', async (req, res) => {
  const instance = getInstance(req.params.id);
  res.json(await docker.nginxValidate(instance.container));
});

// POST /api/instances/:id/reload — validates then reloads; blocked if nginx -t fails
router.post('/:id/reload', async (req, res) => {
  const instance = getInstance(req.params.id);
  const validation = await docker.nginxValidate(instance.container);
  if (!validation.ok) {
    return res.status(422).json({
      error: 'Reload blocked: nginx -t failed',
      ...validation,
    });
  }
  res.json(await docker.nginxReload(instance.container));
});

export default router;
