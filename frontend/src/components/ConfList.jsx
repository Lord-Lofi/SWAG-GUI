// Active configs. Each row has switches for Authelia and the friendly error
// pages; a switch is greyed out when the file has no place for it.
const SWITCHES = [
  { key: 'authelia', label: 'Authelia', none: 'This config has no Authelia include lines' },
  { key: 'errorPages', label: 'Error pages', none: 'Subfolder configs use the error pages of the site they belong to' },
];

function Switch({ label, state, title, onChange }) {
  const disabled = state === null || state === undefined;
  const on = state === true;
  return (
    <button
      role="switch"
      aria-checked={state === 'mixed' ? 'mixed' : on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className="flex items-center gap-1.5 text-xs text-gray-400 disabled:opacity-30 enabled:hover:text-gray-200"
    >
      <span className={`relative inline-block w-7 h-4 rounded-full transition-colors ${on ? 'bg-blue-600' : state === 'mixed' ? 'bg-amber-700' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : state === 'mixed' ? 'left-2' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export default function ConfList({ confs, onEdit, onDelete, onToggle }) {
  if (confs.length === 0) {
    return (
      <p className="text-gray-600 text-sm mt-6 text-center">
        No active configs found. Use the Templates tab to activate one.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-gray-800 divide-y divide-gray-800">
      {confs.map(conf => (
        <div
          key={conf.name}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-gray-900 transition-colors"
        >
          <span className="font-mono text-sm text-gray-200">
            {conf.name}
            {conf.managed && (
              <span title="Made with the form; Edit opens the form" className="ml-2 font-sans text-[10px] uppercase tracking-wide text-blue-300/70">form</span>
            )}
          </span>
          <div className="flex items-center gap-4">
            {SWITCHES.map(({ key, label, none }) => {
              const state = conf.features?.[key];
              const title = state === null ? none
                : state === 'mixed' ? `${label}: only some lines are switched on. Click to switch all on.`
                : `${label}: ${state ? 'on' : 'off'}. Click to switch ${state ? 'off' : 'on'}.`;
              return (
                <Switch key={key} label={label} state={state} title={title} onChange={(value) => onToggle(conf.name, key, value)} />
              );
            })}
            <div className="flex gap-2">
              <button
                onClick={() => onEdit(conf.name)}
                className="px-3 py-1 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete ${conf.name}?\n\nThis cannot be undone.`)) {
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
  );
}
