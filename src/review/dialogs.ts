import { Modal, type App } from "obsidian";
import type { RunSummary } from "../publish/executor";

/** A two-button question; resolves true when the user accepts. */
export function confirmDialog(app: App, title: string, message: string, accept: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new (class extends Modal {
      onOpen(): void {
        this.contentEl.createEl("h2", { text: title });
        this.contentEl.createEl("p", { text: message });
        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        buttons.createEl("button", { cls: "mod-warning", text: accept }).addEventListener("click", () => {
          answered = true;
          resolve(true);
          this.close();
        });
        buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
      }
      onClose(): void {
        this.contentEl.empty();
        if (!answered) resolve(false);
      }
    })(app);
    modal.open();
  });
}

/** Asked when a LegendKeeper resource to delete still has children the plugin does not manage. */
export async function askCascade(app: App, name: string): Promise<"cascade" | "skip"> {
  const cascade = await confirmDialog(
    app,
    "Delete page with children?",
    `"${name}" has pages in LegendKeeper that this plugin did not publish. Moving it to the trash also trashes those pages.`,
    "Trash with children",
  );
  return cascade ? "cascade" : "skip";
}

/** What happened in a publish run. */
export class SummaryModal extends Modal {
  constructor(
    app: App,
    private readonly runSummary: RunSummary,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const s = this.runSummary;
    contentEl.createEl("h2", { text: s.cancelled ? "Publish cancelled" : "Publish finished" });
    contentEl.createEl("p", {
      text: `${s.published.length} published, ${s.deleted.length} moved to trash, ${s.skipped.length} skipped, ${s.failed.length} failed.`,
    });
    if (s.cancelled) contentEl.createEl("p", { text: "Items that did not run will appear in the next review." });

    if (s.failed.length > 0) {
      contentEl.createEl("h3", { text: "Failed" });
      const list = contentEl.createEl("ul");
      for (const failure of s.failed) {
        const detail = [failure.code, failure.requestId ? `request ${failure.requestId}` : ""].filter(Boolean).join(", ");
        list.createEl("li", { text: `${failure.key}: ${failure.message}${detail ? ` (${detail})` : ""}` });
      }
      contentEl.createEl("p", { cls: "setting-item-description", text: "Failed items appear again in the next review." });
    }
    if (s.skipped.length > 0) {
      contentEl.createEl("h3", { text: "Skipped" });
      const list = contentEl.createEl("ul");
      for (const skip of s.skipped) list.createEl("li", { text: `${skip.key}: ${skip.reason}` });
    }
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { cls: "mod-cta", text: "Close" }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
