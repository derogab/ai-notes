import {App, PluginSettingTab, type SettingDefinitionItem} from "obsidian";
import AiNotesPlugin from "./main";

export interface AiNotesSettings {
	recordingsFolder: string;
	whisperEndpointUrl: string;
	whisperModel: string;
	whisperApiKey: string;
	whisperHeaders: string;
	llmEndpointUrl: string;
	llmApiKey: string;
	llmModel: string;
	llmHeaders: string;
}

export const DEFAULT_SETTINGS: AiNotesSettings = {
	recordingsFolder: "recordings",
	whisperEndpointUrl: "http://localhost:8080",
	whisperModel: "whisper-1",
	whisperApiKey: "",
	whisperHeaders: "",
	llmEndpointUrl: "http://localhost:11434/v1",
	llmApiKey: "",
	llmModel: "llama3",
	llmHeaders: "",
};

const API_KEY_PLACEHOLDER = "sk-...";

export class AiNotesSettingTab extends PluginSettingTab {
	plugin: AiNotesPlugin;

	constructor(app: App, plugin: AiNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem<keyof AiNotesSettings>[] {
		const isOpenAI = () => this.plugin.settings.whisperEndpointUrl.includes('/v1');

		return [
			{
				name: "Recordings folder",
				desc: "Vault folder where audio recordings are saved.",
				control: {
					type: "text",
					key: "recordingsFolder",
					defaultValue: DEFAULT_SETTINGS.recordingsFolder,
					placeholder: DEFAULT_SETTINGS.recordingsFolder,
				},
			},
			{
				name: "Whisper endpoint URL",
				desc: "whisper.cpp server (e.g. http://{host:port}) or OpenAI-compatible (e.g. http://{host:port}/v1).",
				control: {
					type: "text",
					key: "whisperEndpointUrl",
					defaultValue: DEFAULT_SETTINGS.whisperEndpointUrl,
					placeholder: DEFAULT_SETTINGS.whisperEndpointUrl,
				},
			},
			{
				name: "Whisper model",
				desc: "Model identifier for the transcription endpoint.",
				visible: isOpenAI,
				control: {
					type: "text",
					key: "whisperModel",
					defaultValue: DEFAULT_SETTINGS.whisperModel,
					placeholder: DEFAULT_SETTINGS.whisperModel,
				},
			},
			{
				name: "Whisper API key",
				desc: "Optional bearer token for the transcription endpoint.",
				visible: isOpenAI,
				render: (setting) => {
					setting.addText(text => {
						text.inputEl.type = "password";
						text.setPlaceholder(API_KEY_PLACEHOLDER)
							.setValue(this.plugin.settings.whisperApiKey)
							.onChange(async (value) => {
								this.plugin.settings.whisperApiKey = value;
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: "Whisper headers",
				desc: "Optional extra HTTP headers for the transcription endpoint, one per line (name: value).",
				control: {
					type: "textarea",
					key: "whisperHeaders",
					defaultValue: DEFAULT_SETTINGS.whisperHeaders,
					placeholder: "X-Custom-Header: value",
				},
			},
			{
				name: "Enrichment endpoint URL",
				desc: "Chat completions API base URL (e.g. http://{host:port}/v1).",
				control: {
					type: "text",
					key: "llmEndpointUrl",
					defaultValue: DEFAULT_SETTINGS.llmEndpointUrl,
					placeholder: DEFAULT_SETTINGS.llmEndpointUrl,
				},
			},
			{
				name: "Enrichment API key",
				desc: "Optional bearer token for the enrichment endpoint.",
				render: (setting) => {
					setting.addText(text => {
						text.inputEl.type = "password";
						text.setPlaceholder(API_KEY_PLACEHOLDER)
							.setValue(this.plugin.settings.llmApiKey)
							.onChange(async (value) => {
								this.plugin.settings.llmApiKey = value;
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: "Enrichment headers",
				desc: "Optional extra HTTP headers for the enrichment endpoint, one per line (name: value).",
				control: {
					type: "textarea",
					key: "llmHeaders",
					defaultValue: DEFAULT_SETTINGS.llmHeaders,
					placeholder: "X-Custom-Header: value",
				},
			},
			{
				name: "Enrichment model",
				desc: "Model identifier for the enrichment endpoint.",
				control: {
					type: "text",
					key: "llmModel",
					defaultValue: DEFAULT_SETTINGS.llmModel,
					placeholder: DEFAULT_SETTINGS.llmModel,
				},
			},
		];
	}
}
