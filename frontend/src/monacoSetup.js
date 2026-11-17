// Sets up Monaco Editor, bundled with the app instead of loaded from a CDN.
//
// Monaco comes straight from the monaco-editor npm package; there is no
// wrapper library in between. Its dependencies are covered by
// package-lock.json, npm audit and Dependabot, and the editor works without
// internet access (for example on the break-glass port).
//
// Uses Monaco's slim entry point with all editor features but no language
// packs. Monaco has no nginx language, so a small one is defined below.
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
// "?worker" tells Vite to bundle Monaco's background worker as its own file.
// Without this, the worker fails to load and the editor runs slower on the
// page's main thread.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

// Syntax highlighting for nginx configs: comments, $variables, strings,
// numbers and sizes, and the directive name at the start of each statement.
monaco.languages.register({ id: 'nginx' });
monaco.languages.setLanguageConfiguration('nginx', {
  comments: { lineComment: '#' },
  brackets: [['{', '}']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});
monaco.languages.setMonarchTokensProvider('nginx', {
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, 'variable'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/[{};]/, 'delimiter'],
      [/\b\d+[kKmMgGsShHdD]?\b/, 'number'],
      // The first word of a statement is the directive (e.g. proxy_pass)
      [/(^\s*|[{;]\s*)([A-Za-z_][A-Za-z0-9_]*)/, ['', 'keyword']],
      [/[^\s{};"'#$]+/, ''],
    ],
  },
});

export { monaco };
