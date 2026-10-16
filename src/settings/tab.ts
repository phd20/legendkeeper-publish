import { FuzzySuggestModal, Notice, PluginSettingTab, SecretComponent, Setting, type App } from "obsidian";
import { lkErrorInfo } from "../lk/api";
import { mintResourceId } from "../lk/ids";
import type LegendKeeperPublishPlugin from "../main";
import { confirmDialog } from "../review/dialogs";

interface ResourceChoice {
  id: string;
  name: string;
}

class ResourcePicker extends FuzzySuggestModal<ResourceChoice> {
  constructor(
    app: App,
    private readonly resourceChoices: ResourceChoice[],
    private readonly pickResource: (choice: ResourceChoice) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose the top-level page to publish under");
  }
  getItems(): ResourceChoice[] {
    return this.resourceChoices;
  }
  getItemText(item: ResourceChoice): string {
    return item.name;
  }
  onChooseItem(item: ResourceChoice): void {
    this.pickResource(item);
  }
}

export class LegendKeeperSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LegendKeeperPublishPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.data.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        "A LegendKeeper project API key (project settings, developers). Stored in Obsidian's secret storage and never written to the vault. " +
          "Secrets do not sync between devices, so enter it once on each device. Needs a paid LegendKeeper plan.",
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el).setValue(settings.secretName).onChange((name) => {
          settings.secretName = name ?? "";
          void this.plugin.saveSettings();
          this.display();
        }),
      );
    if (settings.secretName && !this.plugin.getApiKey()) {
      containerEl.createEl("p", { cls: "mod-warning", text: "API key not set on this device." });
    }

    new Setting(containerEl)
      .setName("Project")
      .setDesc(settings.projectId ? `Connected to "${settings.projectName}".` : "Not connected. Choose an API key, then connect.")
      .addButton((button) =>
        button.setButtonText(settings.projectId ? "Reconnect" : "Connect").onClick(() => void this.connect()),
      );

    new Setting(containerEl)
      .setName("Mount point")
      .setDesc(
        settings.mountId
          ? `Everything is published under "${settings.mountName}". The plugin never touches pages outside it.`
          : "The LegendKeeper page that all published notes are created under.",
      )
      .addButton((button) => button.setButtonText("Choose existing").onClick(() => void this.chooseMount()))
      .addButton((button) => button.setButtonText(`Create "${this.app.vault.getName()}"`).onClick(() => void this.createMount()));

    new Setting(containerEl)
      .setName("Exclusion property")
      .setDesc("A note whose frontmatter sets this property to false is not published. Every other markdown file is.")
      .addText((text) =>
        text.setValue(settings.excludeKey).onChange((value) => {
          settings.excludeKey = value.trim() || "publish";
          void this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Hidden property")
      .setDesc(
        "Frontmatter property that marks a page hidden from players in LegendKeeper. Publishing hidden pages needs an admin API key; " +
          "without one those pages fail and are never published visible.",
      )
      .addText((text) =>
        text.setValue(settings.hiddenKey).onChange((value) => {
          settings.hiddenKey = value.trim() || "lk-hidden";
          void this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Publish pages hidden by default")
      .setDesc("Notes without the hidden property are published hidden. Set the property to false on a note to publish that note visible. Needs an admin API key.")
      .addToggle((toggle) =>
        toggle.setValue(settings.hiddenByDefault).onChange((value) => {
          settings.hiddenByDefault = value;
          void this.plugin.saveSettings();
        }),
      );
  }

  private async connect(): Promise<void> {
    const api = this.plugin.makeApi();
    if (!api) {
      new Notice("Choose an API key first.");
      return;
    }
    try {
      const project = await api.project();
      await this.plugin.setTarget({ projectId: project.id, projectName: project.name, mountId: undefined, mountName: undefined });
      new Notice(`Connected to ${project.name}.`);
    } catch (error) {
      const info = lkErrorInfo(error);
      const meaning =
        info.status === 401
          ? "The API key is invalid or revoked."
          : info.status === 402
            ? "API keys need a paid LegendKeeper plan."
            : info.message;
      new Notice(`Could not connect: ${meaning}`);
    }
    this.display();
  }

  private async chooseMount(): Promise<void> {
    const api = this.plugin.makeApi();
    if (!api || !this.plugin.data.settings.projectId) {
      new Notice("Connect to a project first.");
      return;
    }
    try {
      const choices = await api.listTopLevelResources();
      new ResourcePicker(this.app, choices, (choice) => {
        void this.plugin.setTarget({ mountId: choice.id, mountName: choice.name }).then(() => this.display());
      }).open();
    } catch (error) {
      new Notice(`Could not list pages: ${lkErrorInfo(error).message}`);
    }
  }

  private async createMount(): Promise<void> {
    const api = this.plugin.makeApi();
    if (!api || !this.plugin.data.settings.projectId) {
      new Notice("Connect to a project first.");
      return;
    }
    const name = this.app.vault.getName();
    if (!(await this.confirmTargetChange({ mountId: "new" }))) return;
    try {
      const id = mintResourceId();
      await api.createResources([{ id, name }], `mount-${id}`);
      await this.plugin.setTarget({ mountId: id, mountName: name }, true);
      new Notice(`Created "${name}" in LegendKeeper.`);
    } catch (error) {
      new Notice(`Could not create the page: ${lkErrorInfo(error).message}`);
    }
    this.display();
  }

  /** Changing the target after publishing orphans tracked pages, so ask first. */
  private async confirmTargetChange(next: { mountId: string }): Promise<boolean> {
    if (!this.plugin.wouldOrphan(next)) return true;
    return confirmDialog(
      this.app,
      "Change mount point?",
      "Pages already published will no longer be tracked and the publish state will be reset. The pages stay in LegendKeeper.",
      "Change and reset",
    );
  }
}
