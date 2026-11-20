import { useEffect, useRef } from 'react';
import { monaco } from '../monacoSetup.js';

// Read-only side-by-side comparison of two texts in Monaco: an earlier
// version on the left, the current file on the right.
export default function DiffView({ original, modified, height = '55vh' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      originalEditable: false,
      theme: 'vs-dark',
      automaticLayout: true,
      renderSideBySide: true,
      fontSize: 12,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
    });
    const left = monaco.editor.createModel(original, 'nginx');
    const right = monaco.editor.createModel(modified, 'nginx');
    editor.setModel({ original: left, modified: right });
    return () => {
      editor.dispose();
      left.dispose();
      right.dispose();
    };
  }, [original, modified]);

  return <div ref={containerRef} style={{ height }} />;
}
