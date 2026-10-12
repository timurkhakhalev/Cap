export type PlaybackLoop = { enabled: boolean; start: number; end: number };

export function loopRange(loop: PlaybackLoop, duration: number) {
	const start = Math.max(0, Math.min(loop.start, duration));
	const end = Math.max(0, Math.min(loop.end, duration));
	return loop.enabled &&
		Number.isFinite(start) &&
		Number.isFinite(end) &&
		end - start >= 0.1
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
