export default function ConfList({ confs, onEdit, onDelete }) {
  if (confs.length === 0) {
    return (
      <p className="text-gray-600 text-sm mt-6 text-center">
        No active configs found. Use the Templates tab to activate one.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded border border-gray-800 divide-y divide-gray-800">
      {confs.map(conf => (
        <div
          key={conf.name}
          className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 transition-colors"
        >
          <span className="font-mono text-sm text-gray-200">{conf.name}</span>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(conf.name)}
              className="px-3 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete ${conf.name}?\n\nThis cannot be undone.`)) {
                  onDelete(conf.name);
                }
              }}
              className="px-3 py-1 rounded text-xs bg-red-950 hover:bg-red-900 text-red-300 transition-colors border border-red-900"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
