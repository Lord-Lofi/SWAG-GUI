// linuxserver.io's .conf.sample templates. "Activate…" opens a form for the
// template's container name, port and subdomain, with a preview.
export default function TemplateBrowser({ templates, activeNames, onActivate }) {
  if (templates.length === 0) {
    return (
      <p className="text-gray-600 text-sm mt-6 text-center">
        No .conf.sample templates found in this instance's proxy-confs directory.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-gray-800 divide-y divide-gray-800">
      {templates.map(t => {
        const [app, kind] = t.name.split('.');
        const active = activeNames.has(t.name.replace(/\.sample$/, ''));
        return (
          <div
            key={t.name}
            data-template={t.name}
            className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 transition-colors"
          >
            <div className="min-w-0">
              <span className="text-sm text-gray-200">{app}</span>
              <span className="ml-2 text-[11px] text-gray-500">{kind}</span>
              <span className="block font-mono text-[11px] text-gray-600 truncate">{t.name}</span>
            </div>
            {active ? (
              <span className="text-xs text-gray-500">Already active</span>
            ) : (
              <button
                onClick={() => onActivate(t.name)}
                className="px-3 py-1 rounded-sm text-xs bg-green-950 hover:bg-green-900 text-green-300 transition-colors border border-green-900"
              >
                Activate…
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
