import { Router } from 'express';
import * as confFiles from '../lib/confFiles.js';
import * as docker from '../lib/docker.js';
import { validateHost, fileNameFor, renderHostConf, parseHostConf, AUTH_PROVIDERS } from '../lib/proxyHost.js';
import * as errorPages from '../lib/errorPages.js';
import * as templates from '../lib/templates.js';
import * as features from '../lib/features.js';
import * as status from '../lib/status.js';

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
// For active configs:
//   managed   made with the form and not changed by hand since, so the form
//             can edit it again
//   features  the sign-in (Authelia / Authentik) and error-page settings
//             (null: not available)
router.get('/:id/confs', async (req, res) => {
  const instance = getInstance(req.params.id);
  const confs = await confFiles.list(instance.confsPath);
  for (const conf of confs) {
    if (conf.isSample) continue;
    const content = await confFiles.read(instance.confsPath, conf.name);
    conf.managed = conf.name.endsWith('.subdomain.conf') && parseHostConf(content) !== null;
    conf.features = features.detect(content);
    // The form can write either provider's lines into its own hosts
    if (conf.managed) conf.features.authOptions = AUTH_PROVIDERS;
  }
  res.json(confs);
});

// PATCH /api/instances/:id/confs/:name/features — changes the sign-in
// and/or switches the error pages, e.g. { "auth": "authentik" } or
// { "errorPages": false }. Only those lines change; a failed nginx -t puts
// the file back as it was.
router.patch('/:id/confs/:name/features', async (req, res) => {
  const instance = getInstance(req.params.id);
  const name = req.params.name;
  if (templates.isTemplate(name)) {
    throw Object.assign(new Error('Templates are switched on with Activate'), { status: 400 });
  }
  const previous = await confFiles.read(instance.confsPath, name);
  const changes = { auth: req.body?.auth, errorPages: req.body?.errorPages };

  // Form-made hosts are rendered again, so the form can still edit them
  const host = parseHostConf(previous);
  let content;
  if (host && fileNameFor(host.subdomain) === name) {
    for (const key of Object.keys(changes)) {
      if (changes[key] !== undefined) host[key] = changes[key];
    }
    content = renderHostConf(validateHost(host));
  } else {
    content = features.apply(previous, changes);
  }

  if (content === previous) return res.json({ ok: true, name, unchanged: true });
  if (changes.errorPages && !(await errorPages.status(instance.confsPath)).upToDate) {
    await errorPages.install(instance.confsPath);
  }
  const result = await saveAndReload(instance, name, content, previous);
  res.status(result.status).json(result.body);
});

// GET /api/instances/:id/confs/:name
router.get('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  const content = await confFiles.read(instance.confsPath, req.params.name);
  res.json({ content });
});

// PUT /api/instances/:id/confs/:name — the editor (Advanced: edit file)
// Saves a file from the editor, then runs nginx -t. If the test fails the
// file is put back as it was (the editor keeps the new text to fix), so a
// broken file never stays on disk to break SWAG's next restart.
router.put('/:id/confs/:name', async (req, res) => {
  const instance = getInstance(req.params.id);
  const name = req.params.name;
  if (templates.isTemplate(name)) {
    throw Object.assign(new Error('Templates are read-only; activate one to get an editable copy'), { status: 400 });
  }
  if (typeof req.body?.content !== 'string') {
    throw Object.assign(new Error('content must be a string'), { status: 400 });
  }
  const previous = await confFiles.read(instance.confsPath, name);
  const result = await saveAndReload(instance, name, req.body.content, previous);
  res.status(result.status).json(result.body);
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

  // A host that uses the error pages needs them installed and up to date first
  if (host.errorPages && !(await errorPages.status(instance.confsPath)).upToDate) {
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

  if (host.errorPages && !(await errorPages.status(instance.confsPath)).upToDate) {
    await errorPages.install(instance.confsPath);
  }

  const result = await saveAndReload(instance, req.params.name, renderHostConf(host), previous);
  res.status(result.status).json({ ...result.body, updated: req.params.name });
});

// GET /api/instances/:id/status — nginx and PHP versions (checked against
// known security fixes), HTTP/2 and HTTP/3, and the certificate
router.get('/:id/status', async (req, res) => {
  const instance = getInstance(req.params.id);
  res.json(await status.collect((cmd) => docker.exec(instance.container, cmd)));
});

// POST /api/instances/:id/status/renew — runs SWAG's own renewal script now.
// Certbot only renews certificates that are due (under 30 days left), so
// this is safe to press any time. One run per instance at a time.
const renewing = new Set();
router.post('/:id/status/renew', async (req, res) => {
  const instance = getInstance(req.params.id);
  if (renewing.has(instance.id)) {
    throw Object.assign(new Error('A renewal is already running for this instance'), { status: 409 });
  }
  renewing.add(instance.id);
  try {
    const r = await docker.exec(instance.container, [status.RENEW_SCRIPT]);
    res.status(r.exitCode === 0 ? 200 : 502).json({
      ok: r.exitCode === 0,
      output: (r.stdout + r.stderr).trim().slice(-20000),
    });
  } finally {
    renewing.delete(instance.id);
  }
});

// GET /api/instances/:id/templates/:name — what the activation form can
// fill in for a .conf.sample template, with the template's own values
router.get('/:id/templates/:name', async (req, res) => {
  const { info, content } = await loadTemplate(req);
  res.json({ name: req.params.name, target: templates.targetName(req.params.name), content, ...info, features: features.detect(content) });
});

// POST /api/instances/:id/templates/:name/preview — the file activation
// would create, without writing anything
router.post('/:id/templates/:name/preview', async (req, res) => {
  const { info, content } = await loadTemplate(req);
  const values = templates.validate(info, req.body);
  res.json({ name: templates.targetName(req.params.name, values), content: renderTemplate(content, info, values, req.body) });
});

// POST /api/instances/:id/templates/:name/activate — creates the active
// config from the template and the form values, then runs nginx -t (a failed
// test removes the new file again) and reloads
router.post('/:id/templates/:name/activate', async (req, res) => {
  const { instance, info, content } = await loadTemplate(req);
  const values = templates.validate(info, req.body);
  const name = templates.targetName(req.params.name, values);
  const output = renderTemplate(content, info, values, req.body);
  if (features.detect(output).errorPages && !(await errorPages.status(instance.confsPath)).upToDate) {
    await errorPages.install(instance.confsPath);
  }
  const result = await saveAndReload(instance, name, output);
  res.status(result.status).json({ ...result.body, created: name });
});

// The template with the form values and the sign-in / error-page settings
// applied (settings the template has no place for are left out)
function renderTemplate(content, info, values, body = {}) {
  const filled = templates.apply(content, info, values);
  const available = features.detect(filled);
  const changes = {};
  for (const key of ['auth', 'errorPages']) {
    if (body[key] !== undefined && available[key] !== null) changes[key] = body[key];
  }
  return features.apply(filled, changes);
}

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
