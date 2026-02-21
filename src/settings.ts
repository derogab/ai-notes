import {App, PluginSettingTab, Setting} from "obsidian";
import AiNotesPlugin from "./main";

export interface AiNotesSettings {
	recordingsFolder: string;
	whisperServerUrl: string;
	llmEndpointUrl: string;
	llmApiKey: string;
	llmModel: string;
}

export const DEFAULT_SETTINGS: AiNotesSettings = {
	recordingsFolder: "recordings",
	whisperServerUrl: "http://localhost:8080",
	llmEndpointUrl: "http://localhost:11434/v1/chat/completions",
	llmApiKey: "",
	llmModel: "llama3",
};

export class AiNotesSettingTab extends PluginSettingTab {
	plugin: AiNotesPlugin;

	constructor(app: App, plugin: AiNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Recordings folder")
			.setDesc("Vault folder where audio recordings are saved.")
			.addText(text => text
				.setPlaceholder("recordings")
				.setValue(this.plugin.settings.recordingsFolder)
				.onChange(async (value) => {
					this.plugin.settings.recordingsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Whisper server URL")
			.setDesc("Base URL of the whisper.cpp HTTP server.")
			.addText(text => text
				.setPlaceholder("http://localhost:8080")
				.setValue(this.plugin.settings.whisperServerUrl)
				.onChange(async (value) => {
					this.plugin.settings.whisperServerUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("LLM endpoint URL")
			.setDesc("OpenAI-compatible chat completions endpoint.")
			.addText(text => text
				.setPlaceholder("http://localhost:11434/v1/chat/completions")
				.setValue(this.plugin.settings.llmEndpointUrl)
				.onChange(async (value) => {
					this.plugin.settings.llmEndpointUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("LLM API key")
			.setDesc("Optional API key for the LLM endpoint.")
			.addText(text => text
				.setPlaceholder("sk-...")
				.setValue(this.plugin.settings.llmApiKey)
				.onChange(async (value) => {
					this.plugin.settings.llmApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("LLM model")
			.setDesc("Model name to use for summarization.")
			.addText(text => text
				.setPlaceholder("llama3")
				.setValue(this.plugin.settings.llmModel)
				.onChange(async (value) => {
					this.plugin.settings.llmModel = value;
					await this.plugin.saveSettings();
				}));
	}
}
