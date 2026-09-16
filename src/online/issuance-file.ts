/**
 * The one durable managed-ISSUANCE operation, as a JSON file next to the
 * key store. `issueManagedIdentity` needs exactly this: load, create-once,
 * persist. `entryBytes` is the log entry's exact bytes, so it is stored
 * base64url and restored as the same bytes.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  fromBase64Url,
  toBase64Url,
  type ManagedIssuanceCoordination,
  type ManagedIssuanceState,
} from '@identity-digital/dnsid';

type Stored = Omit<ManagedIssuanceState, 'entryBytes'> & { entryBytes?: string };

function load(path: string): ManagedIssuanceState | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const stored = JSON.parse(raw) as Stored;
  return {
    ...stored,
    entryBytes: stored.entryBytes ? fromBase64Url(stored.entryBytes) : undefined,
  };
}

// 'wx' creates the file and fails if it exists. 'w' replaces it through a
// rename, so a crash mid-write leaves the previous state intact.
function write(path: string, state: ManagedIssuanceState, flag: 'w' | 'wx'): void {
  const stored: Stored = {
    ...state,
    entryBytes: state.entryBytes ? toBase64Url(state.entryBytes) : undefined,
  };
  const json = JSON.stringify(stored, null, 2);
  mkdirSync(dirname(path), { recursive: true });

  if (flag === 'wx') {
    writeFileSync(path, json, { flag, mode: 0o600 });
    return;
  }

  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, json, { mode: 0o600 });
  renameSync(tmp, path);
}

export function issuanceFile(path: string): ManagedIssuanceCoordination {
  return {
    loadIssuance: async () => load(path),
    createIssuance: async (intent) => {
      try {
        write(path, intent, 'wx');
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return load(path);
      }
    },
    persistIssuance: async (state) => write(path, state, 'w'),
    activateAcceptedIssuance: async () => {},
  };
}
