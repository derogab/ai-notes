import {App, PluginSettingTab, Setting} from "obsidian";
import AiNotesPlugin from "./main";

export interface AiNotesSettings {
	recordingsFolder: string;
	whisperEndpointUrl: string;
	whisperModel: string;
	whisperApiKey: string;
	llmEndpointUrl: string;
	llmApiKey: string;
	llmModel: string;
}

export const DEFAULT_SETTINGS: AiNotesSettings = {
	recordingsFolder: "recordings",
	whisperEndpointUrl: "http://localhost:8080",
	whisperModel: "whisper-1",
	whisperApiKey: "",
	llmEndpointUrl: "http://localhost:11434/v1",
	llmApiKey: "",
	llmModel: "llama3",
};

export class AiNotesSettingTab extends PluginSettingTab {
	plugin: AiNotesPlugin;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, plugin: AiNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
			this.plugin.saveSettings().catch(() => {});
		}
	}

	private debouncedSave() {
		if (this.saveTimeout) clearTimeout(this.saveTimeout);
		this.saveTimeout = setTimeout(() => {
			this.saveTimeout = null;
			this.plugin.saveSettings().catch(() => {});
		}, 500);
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Recordings folder")
			.setDesc("Vault folder where audio recordings are saved.")
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder("recordings")
				.setValue(this.plugin.settings.recordingsFolder)
				.onChange((value) => {
					this.plugin.settings.recordingsFolder = value;
					this.debouncedSave();
				}));

		let whisperModelSetting: Setting;
		let whisperApiKeySetting: Setting;

		new Setting(containerEl)
			.setName("Whisper endpoint URL")
			.setDesc("whisper.cpp server (e.g. http://{host:port}) or OpenAI-compatible (e.g. http://{host:port}/v1).")
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder("http://localhost:8080")
				.setValue(this.plugin.settings.whisperEndpointUrl)
				.onChange((value) => {
					this.plugin.settings.whisperEndpointUrl = value;
					this.debouncedSave();
					const isOpenAI = value.includes('/v1');
					whisperModelSetting.settingEl.toggle(isOpenAI);
					whisperApiKeySetting.settingEl.toggle(isOpenAI);
				}));

		whisperModelSetting = new Setting(containerEl)
			.setName("Whisper model")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Model name for OpenAI-compatible endpoints.")
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder("whisper-1")
				.setValue(this.plugin.settings.whisperModel)
				.onChange((value) => {
					this.plugin.settings.whisperModel = value;
					this.debouncedSave();
				}));

		whisperApiKeySetting = new Setting(containerEl)
			.setName("Whisper API key")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Optional API key for the Whisper endpoint (OpenAI-compatible).")
			.addText(text => {
				text.inputEl.type = "password";
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.whisperApiKey)
					.onChange((value) => {
						this.plugin.settings.whisperApiKey = value;
						this.debouncedSave();
					});
			});

		const isOpenAI = this.plugin.settings.whisperEndpointUrl.includes('/v1');
		whisperModelSetting.settingEl.toggle(isOpenAI);
		whisperApiKeySetting.settingEl.toggle(isOpenAI);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("LLM endpoint URL")
			.setDesc("OpenAI-compatible API base URL (e.g. http://{host:port}/v1).")
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder("http://localhost:11434/v1")
				.setValue(this.plugin.settings.llmEndpointUrl)
				.onChange((value) => {
					this.plugin.settings.llmEndpointUrl = value;
					this.debouncedSave();
				}));

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("LLM API key")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Optional API key for the LLM endpoint.")
			.addText(text => {
				text.inputEl.type = "password";
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.llmApiKey)
					.onChange((value) => {
						this.plugin.settings.llmApiKey = value;
						this.debouncedSave();
					});
			});

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("LLM model")
			.setDesc("Model name to use for enrichment.")
			.addText(text => text
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				.setPlaceholder("llama3")
				.setValue(this.plugin.settings.llmModel)
				.onChange((value) => {
					this.plugin.settings.llmModel = value;
					this.debouncedSave();
				}));
	}
}
