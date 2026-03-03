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

const API_KEY_PLACEHOLDER = "sk-...";

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
				.setPlaceholder(DEFAULT_SETTINGS.recordingsFolder)
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
				.setPlaceholder(DEFAULT_SETTINGS.whisperEndpointUrl)
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
			.setDesc("Model identifier for the transcription endpoint.")
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.whisperModel)
				.setValue(this.plugin.settings.whisperModel)
				.onChange((value) => {
					this.plugin.settings.whisperModel = value;
					this.debouncedSave();
				}));

		whisperApiKeySetting = new Setting(containerEl)
			.setName("Whisper API key")
			.setDesc("Optional bearer token for the transcription endpoint.")
			.addText(text => {
				text.inputEl.type = "password";
				text.setPlaceholder(API_KEY_PLACEHOLDER)
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
			.setName("Enrichment endpoint URL")
			.setDesc("Chat completions API base URL (e.g. http://{host:port}/v1).")
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.llmEndpointUrl)
				.setValue(this.plugin.settings.llmEndpointUrl)
				.onChange((value) => {
					this.plugin.settings.llmEndpointUrl = value;
					this.debouncedSave();
				}));

		new Setting(containerEl)
			.setName("Enrichment API key")
			.setDesc("Optional bearer token for the enrichment endpoint.")
			.addText(text => {
				text.inputEl.type = "password";
				text.setPlaceholder(API_KEY_PLACEHOLDER)
					.setValue(this.plugin.settings.llmApiKey)
					.onChange((value) => {
						this.plugin.settings.llmApiKey = value;
						this.debouncedSave();
					});
			});

		new Setting(containerEl)
			.setName("Enrichment model")
			.setDesc("Model identifier for the enrichment endpoint.")
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.llmModel)
				.setValue(this.plugin.settings.llmModel)
				.onChange((value) => {
					this.plugin.settings.llmModel = value;
					this.debouncedSave();
				}));
	}
}
