import { useEffect, useRef } from 'react';
import { monaco } from '../monacoSetup.js';

// A plain React wrapper around Monaco Editor, in place of the
// @monaco-editor/react package: create the editor when the component
// mounts, report changes, and clean it up when it unmounts.
//
// `value` is only used as the starting text. After that the editor owns the
// text and reports every change through onChange.
export default function CodeEditor({ value, onChange, language = 'nginx', height = '60vh' }) {
  const containerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language,
      theme: 'vs-dark',
      automaticLayout: true, // resize with the modal
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 4,
      renderLineHighlight: 'all',
    });
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });
    editor.focus();

    return () => {
      subscription.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
    };
    // Created once per mount on purpose: see the note on `value` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ height }} />;
}
