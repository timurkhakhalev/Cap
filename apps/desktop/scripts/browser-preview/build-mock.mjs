import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [
	projectPath,
	outFile = fileURLToPath(new URL("./.generated-mock.js", import.meta.url)),
] = process.argv.slice(2);
if (!projectPath) {
	console.error("usage: build-mock.mjs <recording.cap> [out.js]");
	process.exit(1);
}

const probe = (file) =>
	JSON.parse(
		execFileSync("ffprobe", [
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_streams",
			"-show_format",
			file,
		]).toString(),
	);

const meta = JSON.parse(
	readFileSync(join(projectPath, "recording-meta.json"), "utf8"),
);
const config = JSON.parse(
	readFileSync(join(projectPath, "project-config.json"), "utf8"),
);

const audio = (entry) => {
	if (!entry) return null;
	const info = probe(join(projectPath, entry.path));
	const stream = info.streams.find((s) => s.codec_type === "audio");
	return {
		duration: Number(info.format.duration),
		sample_rate: Number(stream.sample_rate),
		channels: stream.channels,
		start_time: entry.start_time ?? 0,
	};
};

const video = (entry) => {
	if (!entry) return null;
	const info = probe(join(projectPath, entry.path));
	const stream = info.streams.find((s) => s.codec_type === "video");
	return {
		duration: Number(info.format.duration),
		width: stream.width,
		height: stream.height,
		fps: entry.fps ?? 30,
		start_time: entry.start_time ?? 0,
	};
};

const segments = (meta.segments ?? []).map((segment) => ({
	display: video(segment.display),
	camera: video(segment.camera),
	mic: audio(segment.mic),
	system_audio: audio(segment.system_audio),
}));

const waveform = (entry) => {
	if (!entry) return [];
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"quiet",
			"-i",
			join(projectPath, entry.path),
			"-ac",
			"1",
			"-ar",
			"48000",
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 512 * 1024 * 1024 },
	);
	const samples = new Float32Array(
		pcm.buffer,
		pcm.byteOffset,
		Math.floor(pcm.byteLength / 4),
	);
	const block = 4800;
	const peaks = [];
	for (let i = 0; i < samples.length; i += block) {
		let sum = 0;
		const end = Math.min(i + block, samples.length);
		for (let j = i; j < end; j++) sum += Math.abs(samples[j]);
		const mean = sum / (end - i);
		peaks.push(mean > 0 ? 20 * Math.log10(mean) : -60);
	}
	return peaks;
};

const fixture = {
	micWaveforms: (meta.segments ?? []).map((s) => waveform(s.mic)),
	systemAudioWaveforms: (meta.segments ?? []).map((s) =>
		waveform(s.system_audio),
	),
	projectPath,
	meta,
	config,
	recordings: { segments },
	duration: Math.max(...segments.map((s) => s.display.duration)),
};

const runtime = readFileSync(
	new URL("./tauri-mock-runtime.js", import.meta.url),
	"utf8",
);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
	outFile,
	`window.__CAP_FIXTURE__ = ${JSON.stringify(fixture)};\n${runtime}`,
);
console.log(outFile);
