import { Notice, Plugin, TFile, debounce, requestUrl } from "obsidian";
import type { Warning } from "./convert/types";
import type { LkApi } from "./lk/api";
import { API_ORIGIN, createLkApi } from "./lk/client";
import { requestUrlFetch, type RequestUrlFn } from "./lk/fetch";
import { Pacer, pacedFetch } from "./lk/pacer";
import { askCascade, confirmDialog, SummaryModal } from "./review/dialogs";
import { ReviewModal, type ReviewResult } from "./review/modal";
import { filterToNote } from "./review/selection";
import { executePublish } from "./publish/executor";
import { PublishService } from "./publish/service";
import { loadPluginData, setupMessage, setupProblems, targetChanged, type PluginData, type PluginSettings } from "./settings/data";
import { LegendKeeperSettingTab } from "./settings/tab";
import { estimateUnpublished } from "./tracking/estimate";
import type { PlanItem } from "./tracking/planner";
import { emptyManifest, rekeyManifest } from "./tracking/manifest";

export default class LegendKeeperPublishPlugin extends Plugin {
  data!: PluginData;
  private service!: PublishService;
  private statusEl!: HTMLElement;
  private publishing = false;
  private readonly requestUrlFn = requestUrl as unknown as RequestUrlFn;

  private readonly scheduleSave = debounce(() => void this.persist(), 1000, true);
  private readonly scheduleStatus = debounce(() => this.refreshStatus(), 2000, true);

  async onload(): Promise<void> {
    this.data = loadPluginData(await this.loadData());
    this.service = new PublishService(this.app, () => this.data);

    this.addSettingTab(new LegendKeeperSettingTab(this.app, this));
    this.addRibbonIcon("upload-cloud", "Publish changes to LegendKeeper", () => void this.publish());
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.statusEl.addEventListener("click", () => void this.publish());

    this.addCommand({ id: "publish-changes", name: "Publish changes…", callback: () => void this.publish() });
    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note…",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.publish(file);
        return true;
      },
    });
    this.addCommand({ id: "reset-publish-state", name: "Reset publish state", callback: () => void this.resetState() });

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", () => this.scheduleStatus()));
      this.registerEvent(this.app.vault.on("modify", () => this.scheduleStatus()));
      this.registerEvent(this.app.vault.on("delete", () => this.scheduleStatus()));
      this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleStatus()));
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          // Keep LegendKeeper identity across renames and moves, for notes and whole folders.
          this.data.manifest = rekeyManifest(this.data.manifest, oldPath, file.path);
          this.scheduleSave();
          this.scheduleStatus();
        }),
      );
      this.refreshStatus();
    });
  }

  onunload(): void {
    void this.persist();
  }

  // ───────────────────────── persistence ─────────────────────────

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.data.settings, manifest: this.data.manifest });
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    this.refreshStatus();
  }

  getApiKey(): string | null {
    const name = this.data.settings.secretName;
    return name ? this.app.secretStorage.getSecret(name) : null;
  }

  /** A client for the configured key, paced under LegendKeeper's rate limits. */
  makeApi(onWait?: (ms: number, reason: "throttle" | "retry-after") => void): LkApi | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;
    const pacer = new Pacer({ writesPerMinute: 110, requestsPerMinute: 280, onWait });
    return createLkApi({
      apiKey,
      fetch: pacedFetch(requestUrlFetch(this.requestUrlFn), pacer, (url) => url.startsWith(API_ORIGIN)),
    });
  }

  /** Update the connected project and/or mount point; resets the manifest when tracked pages would be orphaned. */
  async setTarget(change: Partial<Pick<PluginSettings, "projectId" | "projectName" | "mountId" | "mountName">>, confirmed = false): Promise<void> {
    const settings = this.data.settings;
    const next = {
      projectId: change.projectId ?? settings.projectId,
      mountId: "mountId" in change ? (change.mountId ?? "") : settings.mountId,
    };
    if (!confirmed && this.wouldOrphan(next)) {
      const ok = await confirmDialog(
        this.app,
        "Change publish target?",
        "Pages already published will no longer be tracked and the publish state will be reset. The pages stay in LegendKeeper.",
        "Change and reset",
      );
      if (!ok) return;
    }
    const orphaned = targetChanged(this.data.manifest, next);
    Object.assign(settings, change);
    if ("mountId" in change && change.mountId === undefined) {
      settings.mountId = "";
      settings.mountName = "";
    }
    if (orphaned) this.data.manifest = emptyManifest(settings.projectId, settings.mountId);
    else {
      this.data.manifest.projectId = settings.projectId;
      this.data.manifest.mountId = settings.mountId;
    }
    await this.saveSettings();
  }

  wouldOrphan(next: { projectId?: string; mountId?: string }): boolean {
    const { settings, manifest } = this.data;
    return targetChanged(manifest, { projectId: next.projectId ?? settings.projectId, mountId: next.mountId ?? settings.mountId });
  }

  private async resetState(): Promise<void> {
    const ok = await confirmDialog(
      this.app,
      "Reset publish state?",
      "The plugin forgets which notes it published, so the next review lists everything as new. Nothing in LegendKeeper is changed.",
      "Reset",
    );
    if (!ok) return;
    this.data.manifest = emptyManifest(this.data.settings.projectId, this.data.settings.mountId);
    await this.saveSettings();
    new Notice("Publish state reset.");
  }

  // ───────────────────────── status bar ─────────────────────────

  private refreshStatus(): void {
    if (!this.statusEl) return;
    const problems = setupProblems(this.data.settings, this.getApiKey());
    if (problems.length > 0) {
      this.statusEl.setText("LK: set up");
      return;
    }
    const count = estimateUnpublished(this.service.listNotes(), this.data.manifest);
    this.statusEl.setText(count === 0 ? "LK: up to date" : `LK: ${count} unpublished`);
  }

  // ───────────────────────── publish ─────────────────────────

  private async publish(onlyFile?: TFile): Promise<void> {
    if (this.publishing) {
      new Notice("A publish is already running.");
      return;
    }
    const problems = setupProblems(this.data.settings, this.getApiKey());
    if (problems.length > 0) {
      new Notice(setupMessage(problems));
      return;
    }

    this.publishing = true;
    const notice = new Notice("Checking for changes…", 0);
    const controller = new AbortController();
    try {
      const api = this.makeApi((ms, reason) =>
        notice.setMessage(reason === "retry-after" ? `Rate limited, resuming in ${Math.ceil(ms / 1000)}s…` : "Pacing requests…"),
      );
      if (!api) return;
      const review = await this.service.buildReview(api, {
        signal: controller.signal,
        onProgress: (done, total) => notice.setMessage(`Checking for changes… ${done}/${total}`),
      });
      notice.hide();

      let items = review.items;
      if (onlyFile) {
        const key = this.service.keyForPath(onlyFile.path);
        items = key ? filterToNote(items, key) : [];
        if (!key) new Notice("This note is excluded from publishing.");
      }
      if (items.length === 0 && !onlyFile) {
        new Notice("Everything is up to date.");
        return;
      }
      const result = await this.askReview(items, review.warnings, review.precheckSkipped);
      if (result) await this.run(result, api);
    } catch (error) {
      new Notice(`Publish failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      notice.hide();
      this.publishing = false;
      this.refreshStatus();
    }
  }

  private askReview(items: PlanItem[], warnings: Map<string, Warning[]>, precheckSkipped: boolean): Promise<ReviewResult | null> {
    return new Promise((resolve) => {
      new ReviewModal(this.app, items, warnings, precheckSkipped, (result) => resolve(result), () => resolve(null)).open();
    });
  }

  private async run(selection: ReviewResult, api: LkApi): Promise<void> {
    if (selection.items.length === 0) return;
    const controller = new AbortController();
    const notice = new Notice("", 0);
    notice.messageEl.empty();
    const text = notice.messageEl.createSpan({ text: `Publishing 0/${selection.items.length}…` });
    notice.messageEl.createEl("button", { text: "Cancel" }).addEventListener("click", () => controller.abort());

    try {
      const summary = await executePublish(selection.items, {
        api,
        manifest: this.data.manifest,
        vaultName: this.app.vault.getName(),
        convert: (request) => this.service.convertTarget(request),
        readAsset: (hash) => this.service.readAsset(hash),
        saveManifest: async (flush) => {
          if (flush) await this.persist();
          else this.scheduleSave();
        },
        confirmCascade: (item) => askCascade(this.app, item.name),
        onProgress: (done, total, label) => text.setText(`Publishing ${done}/${total}… ${label}`),
        signal: controller.signal,
        overwrite: selection.overwrite,
      });
      new SummaryModal(this.app, summary).open();
    } finally {
      notice.hide();
    }
  }
}
