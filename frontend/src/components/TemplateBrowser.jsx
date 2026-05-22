export default function TemplateBrowser({ templates, onActivate, onPreview }) {
  if (templates.length === 0) {
    return (
      <p className="text-gray-600 text-sm mt-6 text-center">
        No .conf.sample templates found in this instance's proxy-confs directory.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded border border-gray-800 divide-y divide-gray-800">
      {templates.map(t => (
        <div
          key={t.name}
          className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 transition-colors"
        >
          <span className="font-mono text-sm text-gray-400">{t.name}</span>
          <div className="flex gap-2">
            <button
              onClick={() => onPreview(t.name)}
              className="px-3 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
            >
              Preview
            </button>
            <button
              onClick={() => onActivate(t.name)}
              className="px-3 py-1 rounded text-xs bg-green-950 hover:bg-green-900 text-green-300 transition-colors border border-green-900"
            >
              Activate
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
