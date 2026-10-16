import { Modal, type App } from "obsidian";
import type { Warning } from "../convert/types";
import type { PlanItem } from "../tracking/planner";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  defaultSelection,
  groupOf,
  isLocked,
  selectedRun,
  setChecked,
  setGroup,
  type Group,
} from "./selection";

export interface ReviewResult {
  items: PlanItem[];
  overwrite: Set<string>;
}

function describe(item: PlanItem): string {
  if (item.type === "moved" && item.previousKey) return `${item.previousKey} → ${item.key}`;
  return item.key;
}

const GROUP_HINT: Partial<Record<Group, string>> = {
  required: "New folders that selected notes need. They are created automatically.",
  edited: "These pages were edited in LegendKeeper after you last published. Publishing overwrites those edits.",
  deleted: "Moves the page to the LegendKeeper trash, where it can be restored.",
};

/** Lists pending changes by group and lets the user choose what to publish. */
export class ReviewModal extends Modal {
  private checkedKeys: Set<string>;
  private submitted = false;

  constructor(
    app: App,
    private readonly planItems: PlanItem[],
    private readonly itemWarnings: Map<string, Warning[]>,
    private readonly precheckSkipped: boolean,
    private readonly onSubmit: (result: ReviewResult) => void,
    private readonly onCancel: () => void,
  ) {
    super(app);
    this.checkedKeys = defaultSelection(planItems);
  }

  onOpen(): void {
    this.modalEl.addClass("lk-publish-review");
    this.safeRender();
  }

  private safeRender(): void {
    try {
      this.render();
    } catch (error) {
      console.error("LegendKeeper Publish: review failed to render", error);
      this.contentEl.createEl("pre", {
        cls: "mod-warning",
        text: `Could not draw the review: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.onCancel();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Publish to LegendKeeper" });

    if (this.planItems.length === 0) {
      contentEl.createEl("p", { text: "Everything is up to date." });
      return;
    }
    if (this.precheckSkipped) {
      contentEl.createEl("p", {
        cls: "mod-warning",
        text: "Too many changes to check for edits made in LegendKeeper. Publishing stops on any page that changed there.",
      });
    }

    for (const group of GROUP_ORDER) {
      const items = this.planItems.filter((i) => groupOf(i) === group);
      if (items.length === 0) continue;
      this.renderGroup(group, items);
    }

    const run = selectedRun(this.planItems, this.checkedKeys);
    const footer = contentEl.createDiv({ cls: "modal-button-container" });
    const publish = footer.createEl("button", { cls: "mod-cta", text: `Publish ${run.items.length} item${run.items.length === 1 ? "" : "s"}` });
    publish.disabled = run.items.length === 0;
    publish.addEventListener("click", () => {
      this.submitted = true;
      this.close();
      this.onSubmit(run);
    });
    footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }

  private renderGroup(group: Group, items: PlanItem[]): void {
    const section = this.contentEl.createDiv({ cls: "lk-group" });
    const header = section.createDiv({ cls: "lk-group-header" });
    header.createEl("h3", { text: `${GROUP_LABEL[group]} (${items.length})` });
    if (group !== "required") {
      const buttons = header.createDiv({ cls: "lk-group-buttons" });
      buttons.createEl("button", { text: "All" }).addEventListener("click", () => this.update(setGroup(this.planItems, this.checkedKeys, group, true)));
      buttons.createEl("button", { text: "None" }).addEventListener("click", () => this.update(setGroup(this.planItems, this.checkedKeys, group, false)));
    }
    const hint = GROUP_HINT[group];
    if (hint) section.createEl("p", { cls: "setting-item-description", text: hint });

    for (const item of items) {
      const row = section.createDiv({ cls: "lk-row" });
      const locked = isLocked(item, this.planItems, this.checkedKeys);
      const label = row.createEl("label");
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = this.checkedKeys.has(item.key);
      const fixed = locked || group === "required";
      box.disabled = fixed;
      if (fixed) row.addClass("is-locked");
      box.addEventListener("change", () => this.update(setChecked(this.planItems, this.checkedKeys, item.key, box.checked)));
      label.createSpan({ text: ` ${describe(item)}` });
      if (item.probable) label.createSpan({ cls: "lk-badge", text: " (looks like a rename)" });
      if (fixed) label.createSpan({ cls: "lk-badge", text: " (added automatically)" });

      const noteFile = item.kind === "note" ? this.app.vault.getFileByPath(item.key) : null;
      if (noteFile) {
        row.createEl("a", { text: "Open", cls: "lk-open" }).addEventListener("click", (event) => {
          event.preventDefault();
          void this.app.workspace.getLeaf(true).openFile(noteFile);
        });
      }
      const itemWarnings = this.itemWarnings.get(item.key);
      if (itemWarnings?.length) {
        const details = row.createEl("details");
        details.createEl("summary", { text: `${itemWarnings.length} warning${itemWarnings.length === 1 ? "" : "s"}` });
        const list = details.createEl("ul");
        for (const warning of itemWarnings) list.createEl("li", { text: warning.message });
      }
    }
  }

  private update(selection: Set<string>): void {
    this.checkedKeys = selection;
    this.safeRender();
  }
}
