// Active configs. Each row has a sign-in choice (Authelia, Authentik or
// none) and an error-pages switch, greyed out when the file has no place
// for them. Hosts made with
// the form have Edit, which reopens the form; "Edit file" is the advanced
// option for changing any file by hand. "History" lists earlier versions,
// and deleted files with history are listed at the bottom to restore.
const PROVIDER_NAMES = { authelia: 'Authelia', authentik: 'Authentik' };

// Sign-in for one config. Only offers the providers the file has lines for.
function SignIn({ features, onChange }) {
  const state = features?.auth;
  if (state === null || state === undefined) {
    return <span title="This config has no Authelia or Authentik include lines" className="text-xs text-gray-600 w-32">No sign-in lines</span>;
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      Sign-in
      <select
        value={state}
        onChange={(e) => onChange(e.target.value)}
        title={state === 'mixed' ? 'Only some sign-in lines are switched on. Pick one to fix it.' : 'Which sign-in is required for this config'}
        className={`rounded-sm bg-gray-950 border px-1.5 py-0.5 text-xs ${state === 'mixed' ? 'border-amber-700 text-amber-300' : 'border-gray-700 text-gray-200'}`}
      >
        {state === 'mixed' && <option value="mixed" disabled>Mixed</option>}
        {features.authOptions.map((p) => <option key={p} value={p}>{PROVIDER_NAMES[p]}</option>)}
        <option value="none">None</option>
      </select>
    </label>
  );
}

function Switch({ label, state, title, onChange }) {
  const disabled = state === null || state === undefined;
  const on = state === true;
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className="flex items-center gap-1.5 text-xs text-gray-400 disabled:opacity-30 enabled:hover:text-gray-200"
    >
      <span className={`relative inline-block w-7 h-4 rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export default function ConfList({ confs, withHistory = new Set(), deleted = [], onEdit, onEditFile, onDelete, onSetting, onHistory }) {
  const deletedList = deleted.length > 0 && (
    <section className="mt-6">
      <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Deleted files</h3>
      <ul className="rounded-sm border border-gray-800 divide-y divide-gray-800">
        {deleted.map((f) => (
          <li key={f.name} data-deleted={f.name} className="flex items-center justify-between px-4 py-2">
            <span className="font-mono text-sm text-gray-500">{f.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-[11px] text-gray-600">deleted {new Date(f.latest.time).toLocaleString()}</span>
              <button
                onClick={() => onHistory(f.name, false)}
                className="px-3 py-1 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
              >
                View / restore
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  if (confs.length === 0) {
    return (
      <>
        <p className="text-gray-600 text-sm mt-6 text-center">
          No active configs found. Use the Templates tab to activate one.
        </p>
        {deletedList}
      </>
    );
  }

  return (
    <>
    <div className="mt-2 rounded-sm border border-gray-800 divide-y divide-gray-800">
      {confs.map(conf => (
        <div
          key={conf.name}
          data-conf={conf.name}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-gray-900 transition-colors"
        >
          <span className="font-mono text-sm text-gray-200">
            {conf.name}
            {conf.managed && (
              <span title="Made with the form; Edit opens the form" className="ml-2 font-sans text-[10px] uppercase tracking-wide text-blue-300/70">form</span>
            )}
          </span>
          <div className="flex items-center gap-4">
            <SignIn features={conf.features} onChange={(value) => onSetting(conf.name, 'auth', value)} />
            <Switch
              label="Error pages"
              state={conf.features?.errorPages}
              title={conf.features?.errorPages === null
                ? 'Subfolder configs use the error pages of the site they belong to'
                : `Error pages: ${conf.features?.errorPages ? 'on' : 'off'}. Click to switch ${conf.features?.errorPages ? 'off' : 'on'}.`}
              onChange={(value) => onSetting(conf.name, 'errorPages', value)}
            />
            <div className="flex items-center gap-2">
              {/* Advanced: the file itself, in the editor */}
              <button
                onClick={() => onEditFile(conf.name)}
                title={conf.managed
                  ? 'Advanced: edit the file by hand. After that, Edit (the form) no longer works for it.'
                  : 'Advanced: edit the file by hand'}
                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300 underline-offset-2 hover:underline"
              >
                Edit file
              </button>
              {withHistory.has(conf.name) && (
                <button
                  onClick={() => onHistory(conf.name)}
                  title="Earlier versions of this file: compare and restore"
                  className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300 underline-offset-2 hover:underline"
                >
                  History
                </button>
              )}
              {conf.managed && (
                <button
                  onClick={() => onEdit(conf.name)}
                  className="px-3 py-1 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => {
                  if (window.confirm(`Delete ${conf.name}?\n\nYou can bring it back later from "Deleted files" at the bottom of this list.`)) {
                    onDelete(conf.name);
                  }
                }}
                className="px-3 py-1 rounded-sm text-xs bg-red-950 hover:bg-red-900 text-red-300 transition-colors border border-red-900"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
    {deletedList}
    </>
  );
}
