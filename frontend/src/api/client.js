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
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
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
    enable: (id, name)        => request('POST',   `/instances/${id}/confs/${encodeURIComponent(name)}/enable`),
    remove: (id, name)        => request('DELETE', `/instances/${id}/confs/${encodeURIComponent(name)}`),
  },
  nginx: {
    validate: (id) => request('POST', `/instances/${id}/validate`),
    reload:   (id) => request('POST', `/instances/${id}/reload`),
  },
};
