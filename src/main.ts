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
			id: "enrich",
			name: "Enrich note",
			callback: () => this.enrich(),
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
		const noteFolder = `${this.settings.recordingsFolder}/${this.recordingNoteName}`;

		if (!(await this.app.vault.adapter.exists(noteFolder))) {
			await this.app.vault.createFolder(noteFolder);
		}

		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.slice(0, 19);
		const fileName = `${this.recordingNoteName}-${timestamp}.webm`;
		const filePath = `${noteFolder}/${fileName}`;

		const arrayBuffer = await blob.arrayBuffer();
		await this.app.vault.createBinary(filePath, arrayBuffer);

		const noteFile = this.app.vault.getFiles().find(
			f => f.basename === this.recordingNoteName && f.extension === "md"
		);
		if (noteFile) {
			const content = await this.app.vault.read(noteFile);
			const updatedContent = this.addRecordingToDetailsBlock(content, filePath);
			await this.app.vault.modify(noteFile, updatedContent);
		}

		new Notice(`Recording saved: ${fileName}`);

		if (noteFile) {
			await this.transcribeFile(filePath, noteFile);
		}

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
		const audioPaths: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = embedRegex.exec(content)) !== null) {
			audioPaths.push(match[1] ?? "");
		}

		if (audioPaths.length === 0) {
			new Notice("No audio embed found in this note.");
			return;
		}

		for (const audioPath of audioPaths) {
			await this.transcribeFile(audioPath, noteFile);
		}
	}

	private async transcribeFile(audioPath: string, noteFile: TFile) {
		const audioFile = this.app.vault.getAbstractFileByPath(audioPath);
		if (!audioFile || !(audioFile instanceof TFile)) {
			new Notice(`Audio file not found: ${audioPath}`);
			return;
		}

		new Notice("Transcribing...");

		const audioData = await this.app.vault.readBinary(audioFile);
		const wavData = await this.convertToWav(audioData);

		const wavName = audioFile.name.replace(/\.\w+$/, '.wav');
		const formData = new FormData();
		formData.append(
			"file",
			new Blob([wavData], {type: "audio/wav"}),
			wavName
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

		const currentContent = await this.app.vault.read(noteFile);
		const updatedContent = this.updateTranscriptionInDetailsBlock(currentContent, audioPath, transcription);
		await this.app.vault.modify(noteFile, updatedContent);
		new Notice("Transcription added.");
	}

	private async enrich() {
		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note to enrich.");
			return;
		}

		const content = await this.app.vault.read(noteFile);

		new Notice("Enriching...");

		const body = {
			model: this.settings.llmModel,
			messages: [
				{
					role: "system",
					content: "Enrich the following note using its content and transcription. Produce a concise, well-structured summary. Reference specific parts of the notes and transcription as sources.",
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

		let enrichment: string;
		try {
			const response = await requestUrl({
				url: this.settings.llmEndpointUrl,
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});

			const json = response.json;
			enrichment = json.choices?.[0]?.message?.content?.trim() ?? "";
		} catch (e) {
			new Notice(`Enrichment failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		if (!enrichment) {
			new Notice("Enrichment returned empty.");
			return;
		}

		const updatedContent = this.replaceSection(
			await this.app.vault.read(noteFile),
			"Enrichment",
			enrichment
		);
		await this.app.vault.modify(noteFile, updatedContent);
		new Notice("Note enriched.");
	}

	private addRecordingToDetailsBlock(content: string, audioPath: string): string {
		const entry = [
			`![[${audioPath}]]`,
			'<details>',
			'<summary>Transcription</summary>',
			'',
			'</details>',
		].join('\n');

		const transcriptionMarker = '<summary>Transcription</summary>';
		if (content.includes(transcriptionMarker)) {
			const lastDetailsClose = content.lastIndexOf('</details>');
			const separatorIndex = content.indexOf('\n---', lastDetailsClose);
			if (separatorIndex !== -1) {
				const before = content.slice(0, separatorIndex);
				const after = content.slice(separatorIndex);
				return `${before}\n\n${entry}${after}`;
			}
		}

		const section = `${entry}\n\n---`;

		const titleMatch = content.match(/^# .+\n/);
		if (titleMatch) {
			const insertPos = titleMatch.index! + titleMatch[0].length;
			const before = content.slice(0, insertPos).trimEnd();
			const after = content.slice(insertPos).trimStart();
			return `${before}\n\n${section}\n\n${after}`;
		}

		return `${section}\n\n${content}`;
	}

	private async convertToWav(audioData: ArrayBuffer): Promise<ArrayBuffer> {
		const audioCtx = new AudioContext();
		const decoded = await audioCtx.decodeAudioData(audioData.slice(0));
		await audioCtx.close();

		const numChannels = decoded.numberOfChannels;
		const sampleRate = decoded.sampleRate;
		const length = decoded.length;
		const bytesPerSample = 2;
		const dataSize = length * numChannels * bytesPerSample;
		const buffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(buffer);

		const writeString = (offset: number, str: string) => {
			for (let i = 0; i < str.length; i++) {
				view.setUint8(offset + i, str.charCodeAt(i));
			}
		};

		writeString(0, 'RIFF');
		view.setUint32(4, 36 + dataSize, true);
		writeString(8, 'WAVE');
		writeString(12, 'fmt ');
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
		view.setUint16(32, numChannels * bytesPerSample, true);
		view.setUint16(34, bytesPerSample * 8, true);
		writeString(36, 'data');
		view.setUint32(40, dataSize, true);

		const channels: Float32Array[] = [];
		for (let ch = 0; ch < numChannels; ch++) {
			channels.push(decoded.getChannelData(ch));
		}

		let offset = 44;
		for (let i = 0; i < length; i++) {
			for (let ch = 0; ch < numChannels; ch++) {
				const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
				view.setInt16(offset, sample * 0x7FFF, true);
				offset += bytesPerSample;
			}
		}

		return buffer;
	}

	private updateTranscriptionInDetailsBlock(content: string, audioPath: string, transcription: string): string {
		const escapedPath = audioPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const entryRegex = new RegExp(
			`(!\\[\\[${escapedPath}\\]\\]\\n<details>\\n<summary>Transcription</summary>\\n)[\\s\\S]*?(\\n</details>)`
		);
		return content.replace(entryRegex, `$1\n${transcription}\n$2`);
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
