import { Router } from 'express';
import * as confFiles from '../lib/confFiles.js';
import * as docker from '../lib/docker.js';
import { validateHost, fileNameFor, renderHostConf, parseHostConf } from '../lib/proxyHost.js';
import * as errorPages from '../lib/errorPages.js';
import * as templates from '../lib/templates.js';

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

// Writes a config and keeps it only if nginx accepts it.
//
// `previous` is the file's old content, or undefined for a new file. If
// nginx -t fails, a new file is removed and a changed file gets its old
// content back, so a bad change never stays behind. If it passes, nginx is
// reloaded.
async function saveAndReload(instance, name, content, previous) {
  if (previous === undefined) {
    await confFiles.create(instance.confsPath, name, content);
  } else {
    await confFiles.write(instance.confsPath, name, content);
  }

  const validation = await docker.nginxValidate(instance.container);
  if (!validation.ok) {
    if (previous === undefined) {
      await confFiles.remove(instance.confsPath, name);
    } else {
      await confFiles.write(instance.confsPath, name, previous);
    }
    const undone = previous === undefined ? 'was removed again' : 'was put back as it was';
    return { status: 422, body: { error: `nginx -t failed, so ${name} ${undone}`, ...validation } };
  }

  const reload = await docker.nginxReload(instance.container);
  return {
    status: previous === undefined ? 201 : 200,
    body: { ok: reload.ok, name, output: reload.output },
  };
}

// GET /api/instances
router.get('/', (_req, res) => {
  res.json(Object.values(instances).map(({ id, label }) => ({ id, label })));
});

// GET /api/instances/:id/confs
// "managed" marks hosts made with the form and not changed by hand since:
// those can be edited with the form again.
router.get('/:id/confs', async (req, res) => {
  const instance = getInstance(req.params.id);
  const confs = await confFiles.list(instance.confsPath);
  for (const conf of confs) {
    conf.managed = conf.name.endsWith('.subdomain.conf')
      && parseHostConf(await confFiles.read(instance.confsPath, conf.name)) !== null;
  }
  res.json(confs);
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

// DELETE /api/instances/:id/confs/:name
router.delete('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  await confFiles.remove(instance.confsPath, req.params.name);
  res.json({ ok: true });
});

// POST /api/instances/:id/hosts/preview — shows the config a new host would
// get, without writing anything
router.post('/:id/hosts/preview', async (req, res) => {
  getInstance(req.params.id);
  const host = validateHost(req.body);
  res.json({ name: fileNameFor(host.subdomain), content: renderHostConf(host) });
});

// POST /api/instances/:id/hosts — creates <subdomain>.subdomain.conf, then
// runs nginx -t. If the test fails the new file is removed again, so a bad
// host never stays behind. If it passes, nginx is reloaded.
router.post('/:id/hosts', async (req, res) => {
  const instance = getInstance(req.params.id);
  const host = validateHost(req.body);
  const name = fileNameFor(host.subdomain);

  // A host that uses the error pages needs them installed first
  if (host.errorPages && !(await errorPages.status(instance.confsPath)).installed) {
    await errorPages.install(instance.confsPath);
  }

  const result = await saveAndReload(instance, name, renderHostConf(host));
  res.status(result.status).json({ ...result.body, created: name });
});

// Reads a host made with the form, or refuses if it was changed by hand
async function loadManagedHost(instance, name) {
  const content = await confFiles.read(instance.confsPath, name);
  const host = parseHostConf(content);
  if (!host || fileNameFor(host.subdomain) !== name) {
    throw Object.assign(
      new Error(`${name} was not made with the form, or was changed by hand. Edit it in the editor instead.`),
      { status: 409 }
    );
  }
  return { host, content };
}

// GET /api/instances/:id/hosts/:name — the form values of an existing host
router.get('/:id/hosts/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  const { host } = await loadManagedHost(instance, req.params.name);
  res.json({ name: req.params.name, host });
});

// PUT /api/instances/:id/hosts/:name — saves form changes to an existing
// host. The subdomain can't change (that would be a different file). If
// nginx -t fails, the file gets its old content back.
router.put('/:id/hosts/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  const { content: previous } = await loadManagedHost(instance, req.params.name);
  const host = validateHost(req.body);
  if (fileNameFor(host.subdomain) !== req.params.name) {
    throw Object.assign(new Error('subdomain: the subdomain of an existing host can\'t be changed'), { status: 400, field: 'subdomain' });
  }

  if (host.errorPages && !(await errorPages.status(instance.confsPath)).installed) {
    await errorPages.install(instance.confsPath);
  }

  const result = await saveAndReload(instance, req.params.name, renderHostConf(host), previous);
  res.status(result.status).json({ ...result.body, updated: req.params.name });
});

// GET /api/instances/:id/templates/:name — what the activation form can
// fill in for a .conf.sample template, with the template's own values
router.get('/:id/templates/:name', async (req, res) => {
  const { info, content } = await loadTemplate(req);
  res.json({ name: req.params.name, target: templates.targetName(req.params.name), content, ...info });
});

// POST /api/instances/:id/templates/:name/preview — the file activation
// would create, without writing anything
router.post('/:id/templates/:name/preview', async (req, res) => {
  const { info, content } = await loadTemplate(req);
  const values = templates.validate(info, req.body);
  res.json({ name: templates.targetName(req.params.name, values), content: templates.apply(content, info, values) });
});

// POST /api/instances/:id/templates/:name/activate — creates the active
// config from the template and the form values, then runs nginx -t (a failed
// test removes the new file again) and reloads
router.post('/:id/templates/:name/activate', async (req, res) => {
  const { instance, info, content } = await loadTemplate(req);
  const values = templates.validate(info, req.body);
  const name = templates.targetName(req.params.name, values);
  const result = await saveAndReload(instance, name, templates.apply(content, info, values));
  res.status(result.status).json({ ...result.body, created: name });
});

async function loadTemplate(req) {
  const instance = getInstance(req.params.id);
  if (!templates.isTemplate(req.params.name)) {
    throw Object.assign(new Error('Not a .conf.sample template'), { status: 400 });
  }
  const content = await confFiles.read(instance.confsPath, req.params.name);
  return { instance, content, info: templates.describe(content, req.params.name) };
}

// GET /api/instances/:id/errorpages — are the error pages installed and current?
router.get('/:id/errorpages', async (req, res) => {
  const instance = getInstance(req.params.id);
  res.json(await errorPages.status(instance.confsPath));
});

// POST /api/instances/:id/errorpages — install or update the error pages,
// then check nginx still accepts its configuration
router.post('/:id/errorpages', async (req, res) => {
  const instance = getInstance(req.params.id);
  const result = await errorPages.install(instance.confsPath);
  const validation = await docker.nginxValidate(instance.container);
  res.status(validation.ok ? 200 : 422).json({ ...result, ...validation });
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
