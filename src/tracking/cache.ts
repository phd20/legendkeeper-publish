/** Remembers one computed value per key and reuses it while its signature is unchanged. */
export class SignatureCache<T> {
  private readonly store = new Map<string, { signature: string; value: T }>();

  get(key: string, signature: string): T | undefined {
    const hit = this.store.get(key);
    return hit && hit.signature === signature ? hit.value : undefined;
  }

  set(key: string, signature: string, value: T): void {
    this.store.set(key, { signature, value });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Signature for a converted note: changes whenever the file, the settings, or any resolved link target changes. */
export function conversionSignature(parts: {
  mtime: number;
  size: number;
  settingsHash: string;
  linkTargetsHash: string;
}): string {
  return `${parts.mtime}:${parts.size}:${parts.settingsHash}:${parts.linkTargetsHash}`;
}
