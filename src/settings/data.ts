import { emptyManifest, loadManifest, type Manifest } from "../tracking/manifest";

export interface PluginSettings {
  /** Name of the SecretStorage entry holding the API key. */
  secretName: string;
  projectId: string;
  projectName: string;
  mountId: string;
  mountName: string;
  /** Frontmatter key; a note with this key set to false is not published. */
  excludeKey: string;
  /** Frontmatter key that marks a page hidden (GM-only) in LegendKeeper. */
  hiddenKey: string;
  hiddenByDefault: boolean;
}

export interface PluginData {
  settings: PluginSettings;
  manifest: Manifest;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  secretName: "",
  projectId: "",
  projectName: "",
  mountId: "",
  mountName: "",
  excludeKey: "publish",
  hiddenKey: "lk-hidden",
  hiddenByDefault: false,
};

export function loadPluginData(raw: unknown): PluginData {
  const data = (raw && typeof raw === "object" ? raw : {}) as { settings?: Partial<PluginSettings>; manifest?: unknown };
  const stored = data.settings ?? {};
  const settings: PluginSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>) {
    const value = stored[key];
    if (typeof value === typeof DEFAULT_SETTINGS[key]) (settings[key] as unknown) = value;
  }
  // An empty key would make the feature unusable; fall back to the default.
  if (!settings.excludeKey.trim()) settings.excludeKey = DEFAULT_SETTINGS.excludeKey;
  if (!settings.hiddenKey.trim()) settings.hiddenKey = DEFAULT_SETTINGS.hiddenKey;
  return { settings, manifest: data.manifest ? loadManifest(data.manifest) : emptyManifest(settings.projectId, settings.mountId) };
}

export type SetupProblem = "key" | "project" | "mount";

/** What is still missing before publishing is allowed; empty means ready. */
export function setupProblems(settings: PluginSettings, apiKey: string | null): SetupProblem[] {
  const problems: SetupProblem[] = [];
  if (!settings.secretName || !apiKey) problems.push("key");
  if (!settings.projectId) problems.push("project");
  if (!settings.mountId) problems.push("mount");
  return problems;
}

export function setupMessage(problems: SetupProblem[]): string {
  const parts: Record<SetupProblem, string> = {
    key: "an API key (not set on this device)",
    project: "a connected project",
    mount: "a mount point",
  };
  return `LegendKeeper Publish needs ${problems.map((p) => parts[p]).join(", ")}. Open the plugin settings to finish setup.`;
}

/** Settings that change what gets converted; part of the conversion cache signature. */
export function conversionSettingsKey(settings: PluginSettings): string {
  return JSON.stringify([settings.hiddenKey, settings.hiddenByDefault, settings.mountId]);
}

/** True when changing the target should warn that tracked resources would be orphaned. */
export function targetChanged(
  manifest: Manifest,
  next: { projectId: string; mountId: string },
): boolean {
  if (Object.keys(manifest.entries).length === 0) return false;
  return manifest.projectId !== next.projectId || manifest.mountId !== next.mountId;
}
