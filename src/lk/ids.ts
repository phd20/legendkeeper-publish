import { init } from "@paralleldrive/cuid2";

const createId24 = init({ length: 24 });

/** LegendKeeper accepts client-chosen ids of 8 or 24 characters: a lowercase letter then lowercase letters or digits. */
const VALID_ID = /^(?:[a-z][a-z0-9]{7}|[a-z][a-z0-9]{23})$/;

export function mintResourceId(): string {
  return createId24();
}

export function isValidResourceId(id: string): boolean {
  return VALID_ID.test(id);
}

export interface IdScope {
  projectId: string;
  mountId: string;
  vaultName: string;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A resource id derived from where a note is published (project, mount point, vault) and its path, so a
 * plugin that has lost its publish record can find the pages it created earlier instead of duplicating them.
 * `attempt` yields the next candidate when an earlier one is taken by a trashed page.
 */
export async function deriveResourceId(scope: IdScope, key: string, attempt = 0): Promise<string> {
  const input = [scope.projectId, scope.mountId, scope.vaultName, key, String(attempt)].join("\u0000");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  let id = LETTERS[digest[0] % LETTERS.length];
  for (let i = 1; i < 24; i++) id += ALNUM[digest[i] % ALNUM.length];
  return id;
}
