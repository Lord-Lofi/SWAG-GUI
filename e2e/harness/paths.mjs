// Where the harness builds its throwaway SWAG-like folder. Shared by the
// harness and the tests, which check the files the GUI writes.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = join(tmpdir(), 'swag-gui-e2e');
export const CONFS = join(ROOT, 'config', 'nginx', 'proxy-confs');
