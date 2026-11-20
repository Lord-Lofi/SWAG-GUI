import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import DiffView from './DiffView.jsx';

const ACTION_LABELS = {
  edit: 'Edited in the editor',
  form: 'Changed with the form',
  setting: 'Sign-in or error-page setting',
  delete: 'Deleted',
  restore: 'Restored an earlier version',
  rename: 'Renamed',
};

// Earlier versions of one file. Pick one to compare it with the file as it
// is now, then restore it if you want it back. A restore goes through
// nginx -t like any change, and the current content is kept in the history
// too, so a restore can be undone the same way.
//
// Loaded only when opened (it brings in Monaco's diff view).
export default function HistoryModal({ instanceId, name, exists, onRestored, onClose }) {
  const [versions, setVersions]   = useState(null);
  const [selected, setSelected]   = useState(null);
  const [old, setOld]             = useState(null);
  const [current, setCurrent]     = useState(null);
  const [problem, setProblem]     = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    api.history.versions(instanceId, name)
      .then((list) => {
        setVersions(list);
        setSelected(list[0]?.id ?? null);
      })
      .catch((err) => setProblem(err.message));
    if (exists) {
      api.confs.read(instanceId, name).then((r) => setCurrent(r.content)).catch((err) => setProblem(err.message));
    } else {
      setCurrent('');
    }
  }, [instanceId, name, exists]);

  useEffect(() => {
    if (!selected) return;
    setOld(null);
    api.history.read(instanceId, name, selected).then((r) => setOld(r.content)).catch((err) => setProblem(err.message));
  }, [instanceId, name, selected]);

  async function handleRestore() {
    setRestoring(true);
    setProblem(null);
    try {
      onRestored(await api.history.restore(instanceId, name, selected));
    } catch (err) {
      setProblem(`${err.message}${err.data?.output ? `\n\n${err.data.output}` : ''}`);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-6">
      <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-6xl flex flex-col max-h-[92vh] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <span className="text-sm text-gray-300">
            History of <span className="font-mono">{name}</span>
            {!exists && <span className="ml-2 text-xs text-amber-300">deleted</span>}
          </span>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center">✕</button>
        </div>

        <div className="flex flex-col md:flex-row gap-3 p-3 min-h-0 overflow-hidden">
          <ol className="md:w-64 shrink-0 overflow-auto max-h-[55vh] rounded-sm border border-gray-800 divide-y divide-gray-800" aria-label="Versions">
            {versions?.length === 0 && <li className="p-3 text-xs text-gray-500">No earlier versions.</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setSelected(v.id)}
                  className={`w-full text-left px-3 py-2 text-xs ${selected === v.id ? 'bg-blue-950 text-blue-200' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  <span className="block">{new Date(v.time).toLocaleString()}</span>
                  <span className="block text-[11px] text-gray-500">Before: {ACTION_LABELS[v.action] ?? v.action}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-gray-500 mb-1 flex justify-between">
              <span>Selected earlier version</span>
              <span>{exists ? 'Current file' : 'The file no longer exists'}</span>
            </p>
            {old !== null && current !== null ? (
              <DiffView original={old} modified={current} />
            ) : (
              <p className="text-sm text-gray-500 p-3">{versions?.length === 0 ? '' : 'Loading…'}</p>
            )}
          </div>
        </div>

        {problem && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-sm text-xs font-mono whitespace-pre-wrap bg-red-950 text-red-300 border border-red-800">
            {problem}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 shrink-0">
          <p className="text-xs text-gray-600">
            Each entry is the file as it was <em>before</em> that change. Restoring runs <span className="font-mono">nginx -t</span> first and keeps the current version in the history.
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-1.5 rounded-sm text-sm bg-gray-800 hover:bg-gray-700 text-gray-300">Close</button>
            <button
              onClick={handleRestore}
              disabled={!selected || old === null || restoring || old === current}
              className="px-4 py-1.5 rounded-sm text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
            >
              {restoring ? 'Restoring…' : exists ? 'Restore this version' : 'Restore file'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
