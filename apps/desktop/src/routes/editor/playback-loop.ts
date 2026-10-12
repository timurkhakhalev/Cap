export type PlaybackLoop = { enabled: boolean; start: number; end: number };

export const MIN_LOOP_SECONDS = 0.1;
const DEFAULT_LOOP_SECONDS = 5;

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

export function loopAroundPlayhead(
	playhead: number,
	duration: number,
): PlaybackLoop {
	const length = Math.min(DEFAULT_LOOP_SECONDS, duration);
	const start = clamp(playhead, 0, Math.max(0, duration - length));
	return { enabled: length >= MIN_LOOP_SECONDS, start, end: start + length };
}

export function setLoopEdgeAt(
	loop: PlaybackLoop,
	edge: "start" | "end",
	time: number,
	duration: number,
): PlaybackLoop {
	if (duration < MIN_LOOP_SECONDS) return loopAroundPlayhead(0, duration);
	const current = loopRange({ ...loop, enabled: true }, duration);
	const t = clamp(time, 0, duration);
	if (edge === "start") {
		const end =
			current && current.end - t >= MIN_LOOP_SECONDS
				? current.end
				: Math.min(duration, t + DEFAULT_LOOP_SECONDS);
		const start = Math.min(t, end - MIN_LOOP_SECONDS);
		return { enabled: true, start: Math.max(0, start), end };
	}
	const start =
		current && t - current.start >= MIN_LOOP_SECONDS
			? current.start
			: Math.max(0, t - DEFAULT_LOOP_SECONDS);
	const end = Math.max(t, start + MIN_LOOP_SECONDS);
	return { enabled: true, start, end: Math.min(duration, end) };
}

export function setLoopEdge(
	loop: PlaybackLoop,
	edge: "start" | "end",
	time: number,
	duration: number,
): PlaybackLoop {
	const bounded = loopRange({ ...loop, enabled: true }, duration);
	if (!bounded) return loopAroundPlayhead(time, duration);
	return edge === "start"
		? {
				...loop,
				...bounded,
				start: clamp(time, 0, bounded.end - MIN_LOOP_SECONDS),
			}
		: {
				...loop,
				...bounded,
				end: clamp(time, bounded.start + MIN_LOOP_SECONDS, duration),
			};
}

export function moveLoop(
	loop: PlaybackLoop,
	start: number,
	duration: number,
): PlaybackLoop {
	const length = Math.min(loop.end - loop.start, duration);
	const next = clamp(start, 0, Math.max(0, duration - length));
	return { ...loop, start: next, end: next + length };
}

export function drawLoop(
	anchor: number,
	time: number,
	duration: number,
): PlaybackLoop {
	if (duration < MIN_LOOP_SECONDS) return loopAroundPlayhead(0, duration);
	const start = clamp(Math.min(anchor, time), 0, duration);
	const end = clamp(Math.max(anchor, time), 0, duration);
	if (end - start >= MIN_LOOP_SECONDS) return { enabled: true, start, end };
	return time >= anchor
		? {
				enabled: true,
				start: Math.max(0, Math.min(start, duration - MIN_LOOP_SECONDS)),
				end: Math.min(duration, start + MIN_LOOP_SECONDS),
			}
		: {
				enabled: true,
				start: Math.max(0, end - MIN_LOOP_SECONDS),
				end: Math.max(end, MIN_LOOP_SECONDS),
			};
}

export function snapLoopTime(
	time: number,
	targets: number[],
	tolerance: number,
) {
	let best = time;
	let distance = tolerance;
	let snapped = false;
	for (const target of targets) {
		const d = Math.abs(target - time);
		if (d <= distance) {
			best = target;
			distance = d;
			snapped = true;
		}
	}
	return { time: best, snapped };
}

export function loopRange(loop: PlaybackLoop, duration: number) {
	const start = Math.max(0, Math.min(loop.start, duration));
	const end = Math.max(0, Math.min(loop.end, duration));
	return loop.enabled &&
		Number.isFinite(start) &&
		Number.isFinite(end) &&
		end - start >= MIN_LOOP_SECONDS - 1e-9
		? { start, end }
		: undefined;
}

export function loopRestartTime(
	loop: PlaybackLoop,
	duration: number,
	time: number,
	fps: number,
) {
	const range = loopRange(loop, duration);
	if (!range) return undefined;
	const frame = Math.round(time * fps);
	const start = Math.floor(range.start * fps);
	return frame < start || frame >= Math.ceil(range.end * fps) - 1
		? start / fps
		: undefined;
}

export function createLoopRestart(actions: {
	stop(): Promise<unknown>;
	seek(seconds: number): Promise<unknown>;
	start(): Promise<unknown>;
	active(): boolean;
	position(seconds: number): void;
	failed(error: unknown): void;
}) {
	let pending = false;
	let revision = 0;
	return {
		cancel() {
			revision++;
		},
		async restart(seconds: number) {
			if (pending) return;
			pending = true;
			const current = revision;
			const active = () => current === revision && actions.active();
			try {
				await actions.stop();
				if (!active()) return;
				await actions.seek(seconds);
				if (!active()) return;
				actions.position(seconds);
				await actions.start();
				if (!active()) await actions.stop();
			} catch (error) {
				actions.failed(error);
			} finally {
				pending = false;
			}
		},
	};
}
