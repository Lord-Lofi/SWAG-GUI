import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const EMPTY = { subdomain: '', upstreamApp: '', upstreamPort: '', upstreamProto: 'http', authelia: true, errorPages: true };

// Form for a new proxy host. Shows the exact .conf that will be written
// (rendered by the server, so preview and result can never differ) and
// creates it only after nginx -t passes.
export default function AddHostModal({ instanceId, instanceLabel, onCreated, onClose }) {
  const [form, setForm]         = useState(EMPTY);
  const [preview, setPreview]   = useState(null);
  const [problem, setProblem]   = useState(null);
  const [creating, setCreating] = useState(false);

  const set = (field) => (e) =>
    setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Re-render the preview shortly after typing stops
  useEffect(() => {
    if (!form.subdomain || !form.upstreamApp || !form.upstreamPort) {
      setPreview(null);
      setProblem(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setPreview(await api.hosts.preview(instanceId, form));
        setProblem(null);
      } catch (err) {
        setPreview(null);
        setProblem(err.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form, instanceId]);

  async function handleCreate() {
    setCreating(true);
    setProblem(null);
    try {
      const result = await api.hosts.create(instanceId, form);
      onCreated(result);
    } catch (err) {
      const output = err.data?.output ? `\n\n${err.data.output}` : '';
      setProblem(`${err.message}${output}`);
    } finally {
      setCreating(false);
    }
  }

  const input = 'w-full rounded-sm bg-gray-950 border border-gray-700 px-3 py-1.5 text-sm text-gray-100 font-mono focus:outline-hidden focus:border-blue-500';
  const label = 'block text-xs text-gray-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-6">
      <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-4xl flex flex-col max-h-[90vh] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <span className="text-sm text-gray-300">
            Add proxy host <span className="text-gray-500">on {instanceLabel}</span>
          </span>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center">✕</button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 p-4 overflow-auto">
          <div className="md:w-72 shrink-0 flex flex-col gap-3">
            <div>
              <label className={label} htmlFor="subdomain">Subdomain</label>
              <input id="subdomain" className={input} placeholder="plex" value={form.subdomain} onChange={set('subdomain')} autoFocus />
              <p className="text-[11px] text-gray-600 mt-1">Serves <span className="font-mono">{form.subdomain.trim().toLowerCase() || 'name'}.yourdomain</span></p>
            </div>
            <div>
              <label className={label} htmlFor="upstreamApp">Upstream container or host</label>
              <input id="upstreamApp" className={input} placeholder="plex" value={form.upstreamApp} onChange={set('upstreamApp')} />
            </div>
            <div className="flex gap-2">
              <div className="w-24">
                <label className={label} htmlFor="upstreamProto">Protocol</label>
                <select id="upstreamProto" className={input} value={form.upstreamProto} onChange={set('upstreamProto')}>
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </div>
              <div className="flex-1">
                <label className={label} htmlFor="upstreamPort">Port</label>
                <input id="upstreamPort" className={input} placeholder="32400" inputMode="numeric" value={form.upstreamPort} onChange={set('upstreamPort')} />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-300 mt-1">
              <input type="checkbox" className="mt-1" checked={form.authelia} onChange={set('authelia')} />
              <span>
                Require Authelia sign-in
                <span className="block text-[11px] text-gray-600">Turn off only for apps with their own login (e.g. Plex).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" className="mt-1" checked={form.errorPages} onChange={set('errorPages')} />
              <span>
                Use friendly error pages
                <span className="block text-[11px] text-gray-600">Shown when the service is down or access is denied. Installed automatically if needed.</span>
              </span>
            </label>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <p className={label}>{preview ? `Preview: ${preview.name}` : 'Preview'}</p>
            <pre className="flex-1 min-h-64 rounded-sm bg-gray-950 border border-gray-800 p-3 text-xs text-gray-300 font-mono overflow-auto whitespace-pre">
              {preview?.content ?? 'Fill in subdomain, upstream and port to see the config.'}
            </pre>
          </div>
        </div>

        {problem && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-sm text-xs font-mono whitespace-pre-wrap bg-red-950 text-red-300 border border-red-800">
            {problem}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 shrink-0">
          <p className="text-xs text-gray-600">
            Runs <span className="font-mono">nginx -t</span> after writing. If it fails, the new file is removed and nothing reloads.
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-1.5 rounded-sm text-sm bg-gray-800 hover:bg-gray-700 text-gray-300">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!preview || creating}
              className="px-4 py-1.5 rounded-sm text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
            >
              {creating ? 'Creating…' : 'Create & Reload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
