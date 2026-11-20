async function request(method, path, body) {
  // X-SWAG-GUI marks requests as coming from this app. The server rejects
  // changes without it, which blocks cross-site request forgery (CSRF).
  const headers = { 'X-SWAG-GUI': '1' };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    // Keep the server's details (e.g. nginx -t output, which field was wrong)
    throw Object.assign(new Error(data.error ?? `Request failed: ${res.status}`), { data });
  }
  return data;
}

export const api = {
  instances: {
    list: () => request('GET', '/instances'),
  },
  confs: {
    list:   (id)              => request('GET',    `/instances/${id}/confs`),
    read:   (id, name)        => request('GET',    `/instances/${id}/confs/${encodeURIComponent(name)}`),
    write:  (id, name, content) => request('PUT',  `/instances/${id}/confs/${encodeURIComponent(name)}`, { content }),
    remove: (id, name)        => request('DELETE', `/instances/${id}/confs/${encodeURIComponent(name)}`),
    setFeatures: (id, name, changes) => request('PATCH', `/instances/${id}/confs/${encodeURIComponent(name)}/features`, changes),
  },
  hosts: {
    preview: (id, host) => request('POST', `/instances/${id}/hosts/preview`, host),
    create:  (id, host) => request('POST', `/instances/${id}/hosts`, host),
    get:     (id, name) => request('GET',  `/instances/${id}/hosts/${encodeURIComponent(name)}`),
    update:  (id, name, host) => request('PUT', `/instances/${id}/hosts/${encodeURIComponent(name)}`, host),
  },
  templates: {
    get:      (id, name)         => request('GET',  `/instances/${id}/templates/${encodeURIComponent(name)}`),
    preview:  (id, name, values) => request('POST', `/instances/${id}/templates/${encodeURIComponent(name)}/preview`, values),
    activate: (id, name, values) => request('POST', `/instances/${id}/templates/${encodeURIComponent(name)}/activate`, values),
  },
  status: {
    get:   (id) => request('GET',  `/instances/${id}/status`),
    renew: (id) => request('POST', `/instances/${id}/status/renew`),
  },
  errorPages: {
    status:  (id) => request('GET',  `/instances/${id}/errorpages`),
    install: (id) => request('POST', `/instances/${id}/errorpages`),
  },
  nginx: {
    validate: (id) => request('POST', `/instances/${id}/validate`),
    reload:   (id) => request('POST', `/instances/${id}/reload`),
  },
};
