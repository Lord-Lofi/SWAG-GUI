import { useState, useEffect, useCallback } from 'react';
import InstanceSwitcher from './components/InstanceSwitcher.jsx';
import ConfList from './components/ConfList.jsx';
import TemplateBrowser from './components/TemplateBrowser.jsx';
import EditorModal from './components/EditorModal.jsx';
import AddHostModal from './components/AddHostModal.jsx';
import ActivateTemplateModal from './components/ActivateTemplateModal.jsx';
import { api } from './api/client.js';

export default function App() {
  const [instances, setInstances]       = useState([]);
  const [activeInstance, setActive]     = useState(null);
  const [confs, setConfs]               = useState([]);
  const [view, setView]                 = useState('confs');
  const [editTarget, setEditTarget]     = useState(null);
  const [status, setStatus]             = useState(null);
  const [loading, setLoading]           = useState(false);
  const [addingHost, setAddingHost]     = useState(false);
  const [activating, setActivating]     = useState(null);

  useEffect(() => {
    api.instances.list().then(data => {
      setInstances(data);
      if (data.length > 0) setActive(data[0].id);
    });
  }, []);

  const refreshConfs = useCallback(async () => {
    if (!activeInstance) return;
    setLoading(true);
    try {
      setConfs(await api.confs.list(activeInstance));
    } finally {
      setLoading(false);
    }
  }, [activeInstance]);

  useEffect(() => { refreshConfs(); }, [refreshConfs]);

  async function handleEdit(name) {
    const { content } = await api.confs.read(activeInstance, name);
    setEditTarget({ name, content });
  }

  async function handleSave(name, content) {
    setStatus({ type: 'info', message: 'Writing file...' });
    await api.confs.write(activeInstance, name, content);

    setStatus({ type: 'info', message: 'Validating (nginx -t)...' });
    const validation = await api.nginx.validate(activeInstance);

    if (!validation.ok) {
      setStatus({ type: 'error', message: `nginx -t failed — reload blocked:\n\n${validation.output}` });
      return;
    }

    await api.nginx.reload(activeInstance);
    setStatus({ type: 'success', message: `Saved and reloaded. nginx -t: OK` });
    setEditTarget(null);
    refreshConfs();
  }

  function handleActivated(result) {
    setActivating(null);
    setStatus({
      type: result.ok ? 'success' : 'error',
      message: result.ok
        ? `Activated ${result.created} and reloaded nginx.`
        : `Activated ${result.created}, but the reload failed:\n\n${result.output}`,
    });
    setView('confs');
    refreshConfs();
  }

  async function handleDelete(name) {
    await api.confs.remove(activeInstance, name);
    setStatus({ type: 'success', message: `Removed: ${name}` });
    refreshConfs();
  }

  function handleHostCreated(result) {
    setAddingHost(false);
    setStatus({
      type: result.ok ? 'success' : 'error',
      message: result.ok
        ? `Created ${result.created} and reloaded nginx.`
        : `Created ${result.created}, but the reload failed:\n\n${result.output}`,
    });
    refreshConfs();
  }

  async function handleErrorPages() {
    setStatus({ type: 'info', message: 'Installing error pages...' });
    try {
      const r = await api.errorPages.install(activeInstance);
      setStatus({
        type: 'success',
        message: 'Error pages installed and up to date; nginx -t passed.\n\n' +
          'New hosts include them automatically. For an existing config, add this line inside its server block:\n' +
          `    ${r.includeLine}`,
      });
    } catch (err) {
      setStatus({ type: 'error', message: `${err.message}${err.data?.output ? `\n\n${err.data.output}` : ''}` });
    }
    refreshConfs();
  }

  async function handleValidate() {
    setStatus({ type: 'info', message: 'Running nginx -t...' });
    const result = await api.nginx.validate(activeInstance);
    setStatus({
      type: result.ok ? 'success' : 'error',
      message: result.output || (result.ok ? 'Configuration is valid.' : 'Validation failed.'),
    });
  }

  async function handleReload() {
    setStatus({ type: 'info', message: 'Validating before reload...' });
    const result = await api.nginx.reload(activeInstance);
    setStatus({
      type: result.ok ? 'success' : 'error',
      message: result.ok ? 'Reloaded successfully.' : `Reload failed:\n\n${result.output}`,
    });
  }

  const statusColors = {
    error:   'bg-red-950 text-red-300 border-red-800',
    success: 'bg-green-950 text-green-300 border-green-800',
    info:    'bg-blue-950 text-blue-300 border-blue-800',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white tracking-tight">SWAG Config</h1>
          <p className="text-xs text-gray-500 mt-0.5">nginx proxy configuration manager</p>
        </div>
        <InstanceSwitcher instances={instances} active={activeInstance} onChange={setActive} />
      </header>

      {/* Status bar */}
      {status && (
        <div className={`px-6 py-2 text-xs font-mono whitespace-pre-wrap border-b ${statusColors[status.type]}`}>
          {status.message}
          <button
            onClick={() => setStatus(null)}
            className="float-right opacity-50 hover:opacity-100 ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation + actions */}
      <div className="flex items-center gap-1 px-6 pt-4 pb-2 border-b border-gray-800">
        {['confs', 'templates'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              view === v
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {v === 'confs' ? 'Active Configs' : 'Templates'}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setAddingHost(true)}
            disabled={!activeInstance}
            className="px-3 py-1.5 rounded-sm text-xs bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-40"
          >
            + Add host
          </button>
          <button
            onClick={handleErrorPages}
            disabled={!activeInstance}
            title="Install or update the friendly 403 / 404 / 5xx pages on this instance"
            className="px-3 py-1.5 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700 disabled:opacity-40"
          >
            Error pages
          </button>
          <button
            onClick={handleValidate}
            className="px-3 py-1.5 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
          >
            Validate
          </button>
          <button
            onClick={handleReload}
            className="px-3 py-1.5 rounded-sm text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors"
          >
            Reload nginx
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 px-6 py-4">
        {loading ? (
          <p className="text-gray-600 text-sm mt-4">Loading...</p>
        ) : view === 'confs' ? (
          <ConfList
            confs={confs.filter(c => !c.isSample)}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ) : (
          <TemplateBrowser
            templates={confs.filter(c => c.isSample)}
            activeNames={new Set(confs.filter(c => !c.isSample).map(c => c.name))}
            onActivate={setActivating}
          />
        )}
      </main>

      {addingHost && (
        <AddHostModal
          instanceId={activeInstance}
          instanceLabel={instances.find(i => i.id === activeInstance)?.label ?? activeInstance}
          onCreated={handleHostCreated}
          onClose={() => setAddingHost(false)}
        />
      )}

      {activating && (
        <ActivateTemplateModal
          instanceId={activeInstance}
          instanceLabel={instances.find(i => i.id === activeInstance)?.label ?? activeInstance}
          template={activating}
          onActivated={handleActivated}
          onClose={() => setActivating(null)}
        />
      )}

      {editTarget && (
        <EditorModal
          name={editTarget.name}
          content={editTarget.content}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
