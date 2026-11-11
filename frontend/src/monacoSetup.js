// Bundle Monaco Editor with the app instead of loading it from a CDN.
//
// By default @monaco-editor/react downloads Monaco from cdn.jsdelivr.net at
// runtime. Using the npm copy means no third-party code is loaded into this
// admin panel, the editor works without internet access (for example on the
// break-glass port), and Monaco's dependencies are covered by
// package-lock.json, npm audit and Dependabot.
//
// Uses Monaco's slim entry point with all editor features but no language
// packs: Monaco has no nginx language, so configs are edited as plain text.
import { loader } from '@monaco-editor/react';
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

loader.config({ monaco });
