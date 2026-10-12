import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { Server: WebSocketServer } = require("ws");

const [projectPath, port = "47123"] = process.argv.slice(2);
if (!projectPath) {
	console.error("usage: frame-server.mjs <recording.cap> [port]");
	process.exit(1);
}

const display = join(projectPath, "content/segments/segment-0/display.mp4");
const probe = JSON.parse(
	execFileSync("ffprobe", [
		"-v",
		"quiet",
		"-print_format",
		"json",
		"-show_streams",
		display,
	]).toString(),
).streams.find((s) => s.codec_type === "video");
const width = Math.floor(probe.width / 2 / 2) * 2;
const height = Math.floor(probe.height / 2 / 2) * 2;

const frameAt = (seconds) => {
	const rgba = execFileSync(
		"ffmpeg",
		[
			"-v",
			"quiet",
			"-ss",
			String(seconds),
			"-i",
			display,
			"-frames:v",
			"1",
			"-vf",
			`scale=${width}:${height}`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	const meta = Buffer.alloc(24);
	meta.writeUInt32LE(width * 4, 0);
	meta.writeUInt32LE(height, 4);
	meta.writeUInt32LE(width, 8);
	meta.writeUInt32LE(0, 12);
	meta.writeBigUInt64LE(BigInt(Math.round(seconds * 1e9)), 16);
	return Buffer.concat([rgba, meta]);
};

const frame = frameAt(1);
const server = new WebSocketServer({ port: Number(port), host: "127.0.0.1" });
server.on("connection", (socket) => socket.send(frame));
console.log(`frames ws://127.0.0.1:${port} ${width}x${height}`);
