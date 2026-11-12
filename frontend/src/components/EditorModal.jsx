import { useState } from 'react';
import Editor from '@monaco-editor/react';

export default function EditorModal({ name, content, onSave, onClose }) {
  const [value, setValue]   = useState(content);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(name, value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-6">
      <div className="bg-gray-900 rounded-lg border border-gray-700 w-full max-w-4xl flex flex-col max-h-[90vh] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <span className="font-mono text-sm text-gray-300">{name}</span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none w-6 h-6 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Monaco editor */}
        <div className="flex-1 min-h-0">
          <Editor
            height="60vh"
            defaultLanguage="nginx"
            value={value}
            onChange={v => setValue(v ?? '')}
            theme="vs-dark"
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 4,
              renderLineHighlight: 'all',
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 shrink-0">
          <p className="text-xs text-gray-600">
            Saving will run <span className="font-mono">nginx -t</span> before reload.
            If validation fails, the reload is blocked and your file is preserved.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-sm text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded-sm text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save & Reload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
