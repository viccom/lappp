import { isAbsolute, resolve } from 'node:path';

export function resolveRequiredDataDir(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('LAP_SMOKE_DATA_DIR is required; set it to an isolated smoke data directory');
  }
  const dataDir = value.trim();
  if (!isAbsolute(dataDir)) {
    throw new Error('LAP_SMOKE_DATA_DIR must be an absolute path');
  }
  return resolve(dataDir);
}
