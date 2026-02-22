import {Plugin, Notice, requestUrl, TFile, MarkdownView} from "obsidian";
import {AiNotesSettings, DEFAULT_SETTINGS, AiNotesSettingTab} from "./settings";

const HEADING_RECORDINGS = '🔴 REC';
const HEADING_AI = '🤖 AI';

export default class AiNotesPlugin extends Plugin {
	settings: AiNotesSettings = DEFAULT_SETTINGS;
	private mediaRecorder: MediaRecorder | null = null;
	private recordedChunks: Blob[] = [];
	private statusBarEl: HTMLElement | null = null;
	private recordingNotePath: string | null = null;

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
			name: "Transcribe recordings",
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
		if (this.statusBarEl) {
			this.statusBarEl.setText("");
			this.statusBarEl.removeClass("ai-notes-recording");
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
		this.recordingNotePath = noteFile.path;

		this.mediaRecorder = new MediaRecorder(stream);

		this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
			if (e.data.size > 0) {
				this.recordedChunks.push(e.data);
			}
		};

		this.mediaRecorder.onstop = async () => {
			stream.getTracks().forEach(t => t.stop());
			this.updateStatusBar(false);

			const blob = new Blob(this.recordedChunks, {type: this.mediaRecorder?.mimeType ?? "audio/webm"});
			await this.saveRecording(blob);
			this.mediaRecorder = null;
			this.recordedChunks = [];
		};

		this.mediaRecorder.start();
		this.updateStatusBar(true);
		new Notice("Recording started.");
	}

	private async saveRecording(blob: Blob) {
		const noteName = this.recordingNotePath!.split('/').pop()!.replace(/\.md$/, '');
		const noteFolder = `${this.settings.recordingsFolder}/${noteName}`;

		if (!(await this.app.vault.adapter.exists(noteFolder))) {
			await this.app.vault.createFolder(noteFolder);
		}

		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.slice(0, 19);
		const fileName = `${noteName}-${timestamp}.webm`;
		const filePath = `${noteFolder}/${fileName}`;

		const arrayBuffer = await blob.arrayBuffer();
		await this.app.vault.createBinary(filePath, arrayBuffer);

		const noteFile = this.app.vault.getAbstractFileByPath(this.recordingNotePath!);
		if (noteFile && noteFile instanceof TFile) {
			const content = await this.app.vault.read(noteFile);
			const updatedContent = this.addRecordingToDetailsBlock(content, filePath);
			await this.app.vault.modify(noteFile, updatedContent);
		}

		new Notice(`Recording saved: ${fileName}`);

		if (noteFile && noteFile instanceof TFile) {
			await this.transcribeFile(filePath, noteFile);
		}

		this.recordingNotePath = null;
	}

	private async transcribe() {
		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note to transcribe.");
			return;
		}

		const content = await this.app.vault.read(noteFile);

		const embedRegex = /!\[\[([^\]]+\.(webm|wav|mp3|m4a|ogg|flac))\]\]/g;
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
		let wavData: ArrayBuffer;
		try {
			wavData = await this.convertToWav(audioData);
		} catch (e) {
			new Notice(`Audio conversion failed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		const wavName = audioFile.name.replace(/\.\w+$/, '.wav');
		const formData = new FormData();
		formData.append(
			"file",
			new Blob([wavData], {type: "audio/wav"}),
			wavName
		);
		formData.append("response_format", "json");

		const baseUrl = this.settings.whisperEndpointUrl.replace(/\/+$/, '');
		const isOpenAI = baseUrl.includes('/v1');

		let url: string;
		const fetchOptions: RequestInit = {method: "POST", body: formData};

		if (isOpenAI) {
			url = `${baseUrl}/audio/transcriptions`;
			formData.append("model", this.settings.whisperModel);
			if (this.settings.whisperApiKey) {
				fetchOptions.headers = {"Authorization": `Bearer ${this.settings.whisperApiKey}`};
			}
		} else {
			url = `${baseUrl}/inference`;
		}

		let transcription: string;
		try {
			const response = await fetch(url, fetchOptions);

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

	private extractTranscriptions(content: string): string[] {
		const regex = /<details>\s*<summary>Transcription<\/summary>\s*([\s\S]*?)\s*<\/details>/g;
		const transcriptions: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const text = (match[1] ?? "").trim();
			if (text) transcriptions.push(text);
		}
		return transcriptions;
	}

	private extractUserNotes(content: string): string {
		const recHeading = `## ${HEADING_RECORDINGS}\n`;
		const aiHeading = `## ${HEADING_AI}\n`;

		let recordingsIndex = content.indexOf(`\n${recHeading}`);
		if (recordingsIndex === -1 && content.startsWith(recHeading)) recordingsIndex = 0;
		if (recordingsIndex !== -1) {
			return content.slice(0, recordingsIndex).trim();
		}

		let aiNotesIndex = content.indexOf(`\n${aiHeading}`);
		if (aiNotesIndex === -1 && content.startsWith(aiHeading)) aiNotesIndex = 0;
		if (aiNotesIndex !== -1) {
			return content.slice(0, aiNotesIndex).trim();
		}

		return content.trim();
	}

	private async enrich() {
		const noteFile = this.getActiveNoteFile();
		if (!noteFile) {
			new Notice("Open a note to enrich.");
			return;
		}

		// Re-transcribe all recordings first
		await this.transcribe();

		const content = await this.app.vault.read(noteFile);

		const userNotes = this.extractUserNotes(content);
		const transcriptions = this.extractTranscriptions(content);

		let sourceContent = userNotes;
		if (transcriptions.length > 0) {
			sourceContent += '\n\nTranscriptions:\n' + transcriptions.join('\n\n');
		}

		new Notice("Enriching...");

		const body = {
			model: this.settings.llmModel,
			messages: [
				{
					role: "system",
					content: "You are given notes and transcriptions. Write a well-structured enriched note covering the key topics and ideas. Your output must be shorter than the combined input — match the density of information, not the volume. Write in the same language as the input.",
				},
				{
					role: "user",
					content: sourceContent,
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
				url: `${this.settings.llmEndpointUrl.replace(/\/+$/, '')}/chat/completions`,
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
			HEADING_AI,
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

		const recordingsHeading = `## ${HEADING_RECORDINGS}`;
		const recordingsIndex = content.indexOf(`\n${recordingsHeading}\n`);

		if (recordingsIndex !== -1) {
			const aiIndex = content.indexOf(`\n## ${HEADING_AI}\n`);
			if (aiIndex !== -1) {
				const before = content.slice(0, aiIndex).trimEnd();
				const after = content.slice(aiIndex);
				return `${before}\n\n${entry}${after}`;
			}
			return content.trimEnd() + `\n\n${entry}\n`;
		}

		const recordingSection = `${recordingsHeading}\n\n${entry}`;

		const aiIndex = content.indexOf(`\n## ${HEADING_AI}\n`);
		if (aiIndex !== -1) {
			const before = content.slice(0, aiIndex).trimEnd();
			const after = content.slice(aiIndex).trimStart();
			return `${before}\n\n${recordingSection}\n\n${after}`;
		}

		return content.trimEnd() + `\n\n${recordingSection}\n`;
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
