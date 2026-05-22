async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
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
