import {Plugin, Notice, requestUrl, TFile, MarkdownView} from "obsidian";
import {AiNotesSettings, DEFAULT_SETTINGS, AiNotesSettingTab} from "./settings";

export default class AiNotesPlugin extends Plugin {
	settings: AiNotesSettings = DEFAULT_SETTINGS;
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private statusBarEl: HTMLElement | null = null;
	private recordingNoteName: string | null = null;

	async onload() {
		await this.loadSettings();

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("ai-notes-status");
		this.updateStatusBar(false);

		this.addCommand({
			id: "record",
			name: "Start/Stop recording",
			callback: () => this.toggleRecording(),
		});

		this.addCommand({
			id: "transcribe",
			name: "Transcribe recording",
			callback: () => this.transcribe(),
		});

		this.addCommand({
			id: "summarize",
			name: "Summarize note",
			callback: () => this.summarize(),
		});

		this.addSettingTab(new AiNotesSettingTab(this.app, this));
	}

	onunload() {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AiNotesSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private updateStatusBar(recording: boolean) {
		if (!this.statusBarEl) return;
		if (recording) {
			this.statusBarEl.setText("🔴 Recording");
			this.statusBarEl.addClass("ai-notes-recording");
		} else {
			this.statusBarEl.setText("");
			this.statusBarEl.removeClass("ai-notes-recording");
		}
	}

	private getActiveNoteFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file ?? null;
	}

	private async toggleRecording() {
		if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
			this.mediaRecorder.stop();
			return;
		}

		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note before recording.");
			return;
		}

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({audio: true});
		} catch (e) {
			new Notice("Microphone access denied.");
			return;
		}

		this.recordedChunks = [];
		this.recordingNoteName = noteFile.basename;

		this.mediaRecorder = new MediaRecorder(stream);

		this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
			if (e.data.size > 0) {
				this.recordedChunks.push(e.data);
			}
		};

		this.mediaRecorder.onstop = async () => {
			stream.getTracks().forEach(t => t.stop());
			this.updateStatusBar(false);

			const blob = new Blob(this.recordedChunks, {type: "audio/webm"});
			await this.saveRecording(blob);
			this.mediaRecorder = null;
			this.recordedChunks = [];
		};

		this.mediaRecorder.start();
		this.updateStatusBar(true);
		new Notice("Recording started.");
	}

	private async saveRecording(blob: Blob) {
		const folder = this.settings.recordingsFolder;

		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.createFolder(folder);
		}

		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.slice(0, 19);
		const fileName = `${this.recordingNoteName}-${timestamp}.webm`;
		const filePath = `${folder}/${fileName}`;

		const arrayBuffer = await blob.arrayBuffer();
		await this.app.vault.createBinary(filePath, arrayBuffer);

		const noteFile = this.app.vault.getFiles().find(
			f => f.basename === this.recordingNoteName && f.extension === "md"
		);
		if (noteFile) {
			const content = await this.app.vault.read(noteFile);
			const embed = `\n![[${filePath}]]\n`;
			await this.app.vault.modify(noteFile, content + embed);
		}

		new Notice(`Recording saved: ${fileName}`);
		this.recordingNoteName = null;
	}

	private async transcribe() {
		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note to transcribe.");
			return;
		}

		const content = await this.app.vault.read(noteFile);

		const embedRegex = /!\[\[([^\]]+\.(webm|wav))\]\]/g;
		let lastMatch: RegExpExecArray | null = null;
		let match: RegExpExecArray | null;
		while ((match = embedRegex.exec(content)) !== null) {
			lastMatch = match;
		}

		if (!lastMatch) {
			new Notice("No audio embed found in this note.");
			return;
		}

		const audioPath = lastMatch[1] ?? "";
		const audioFile = this.app.vault.getAbstractFileByPath(audioPath);
		if (!audioFile || !(audioFile instanceof TFile)) {
			new Notice(`Audio file not found: ${audioPath}`);
			return;
		}

		new Notice("Transcribing...");

		const audioData = await this.app.vault.readBinary(audioFile);

		const formData = new FormData();
		formData.append(
			"file",
			new Blob([audioData], {type: "audio/webm"}),
			audioFile.name
		);
		formData.append("response_format", "json");

		let transcription: string;
		try {
			const response = await fetch(
				`${this.settings.whisperServerUrl}/inference`,
				{method: "POST", body: formData}
			);

			if (!response.ok) {
				throw new Error(`Server responded with ${response.status}`);
			}

			const json = await response.json();
			transcription = json.text?.trim() ?? "";
		} catch (e) {
			new Notice(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (!transcription) {
			new Notice("Transcription returned empty.");
			return;
		}

		const updatedContent = this.replaceSection(
			await this.app.vault.read(noteFile),
			"Transcription",
			transcription
		);
		await this.app.vault.modify(noteFile, updatedContent);
		new Notice("Transcription added.");
	}

	private async summarize() {
		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note to summarize.");
			return;
		}

		const content = await this.app.vault.read(noteFile);

		new Notice("Summarizing...");

		const body = {
			model: this.settings.llmModel,
			messages: [
				{
					role: "system",
					content: "Summarize the following note and its transcription. Be concise. Reference specific parts of the notes and transcription as sources.",
				},
				{
					role: "user",
					content: content,
				},
			],
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.settings.llmApiKey) {
			headers["Authorization"] = `Bearer ${this.settings.llmApiKey}`;
		}

		let summary: string;
		try {
			const response = await requestUrl({
				url: this.settings.llmEndpointUrl,
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});

			const json = response.json;
			summary = json.choices?.[0]?.message?.content?.trim() ?? "";
		} catch (e) {
			new Notice(`Summary failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (!summary) {
			new Notice("Summary returned empty.");
			return;
		}

		const updatedContent = this.replaceSection(
			await this.app.vault.read(noteFile),
			"Summary",
			summary
		);
		await this.app.vault.modify(noteFile, updatedContent);
		new Notice("Summary added.");
	}

	private replaceSection(content: string, heading: string, newBody: string): string {
		const sectionRegex = new RegExp(
			`(## ${heading}\\n)([\\s\\S]*?)(?=\\n## |$)`
		);
		const replacement = `## ${heading}\n${newBody}\n`;

		if (sectionRegex.test(content)) {
			return content.replace(sectionRegex, replacement);
		}

		return content.trimEnd() + `\n\n${replacement}`;
	}
}
