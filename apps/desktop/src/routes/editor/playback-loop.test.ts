import { expect, it, vi } from "vitest";
import {
	createLoopRestart,
	drawLoop,
	loopAroundPlayhead,
	loopRange,
	loopRestartTime,
	moveLoop,
	setLoopEdge,
	setLoopEdgeAt,
	snapLoopTime,
	togglePlaybackLoop,
} from "./playback-loop";

it("creates a new loop at the current cursor after disabling an old range", () => {
	const disabled = togglePlaybackLoop(
		{ enabled: true, start: 2, end: 6 },
		3,
		24,
	);
	expect(disabled).toEqual({ enabled: false, start: 2, end: 6 });
	expect(togglePlaybackLoop(disabled, 11, 24)).toEqual({
		enabled: true,
		start: 11,
		end: 16,
	});
});

it("repeats at the last frame and accepts a start between frames", () => {
	const loop = { enabled: true, start: 2.01, end: 5 };
	expect(loopRestartTime(loop, 5, 149 / 30, 30)).toBe(2);
	expect(loopRestartTime(loop, 5, 2, 30)).toBeUndefined();
	expect(loopRestartTime(loop, 5, 0, 30)).toBe(2);
	expect(
		loopRestartTime({ ...loop, enabled: false }, 5, 5, 30),
	).toBeUndefined();
});

it("bounds loops after trimming and rejects empty, reversed and non-finite ranges", () => {
	expect(loopRange({ enabled: true, start: 2, end: 20 }, 10)).toEqual({
		start: 2,
		end: 10,
	});
	for (const [start, end] of [
		[10, 20],
		[4, 2],
		[0, 0.01],
		[Number.NaN, 4],
	]) {
		expect(loopRange({ enabled: true, start, end }, 10)).toBeUndefined();
	}
	expect(loopRange({ enabled: false, start: 2, end: 5 }, 10)).toBeUndefined();
});

it("serializes stop, seek and restart without duplicate boundary requests", async () => {
	let finishStop: () => void = () => {};
	const stop = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finishStop = resolve;
			}),
	);
	const seek = vi.fn(async () => {});
	const start = vi.fn(async () => {});
	const position = vi.fn();
	const loop = createLoopRestart({
		stop,
		seek,
		start,
		position,
		active: () => true,
		failed: vi.fn(),
	});
	const pending = loop.restart(2);
	await loop.restart(2);
	expect(stop).toHaveBeenCalledTimes(1);
	expect(seek).not.toHaveBeenCalled();
	finishStop();
	await pending;
	expect(seek).toHaveBeenCalledWith(2);
	expect(position).toHaveBeenCalledWith(2);
	expect(start).toHaveBeenCalledTimes(1);
});

it("does not resume when paused during an asynchronous seek", async () => {
	let finishSeek: () => void = () => {};
	let active = true;
	const start = vi.fn(async () => {});
	const loop = createLoopRestart({
		stop: async () => {},
		seek: () =>
			new Promise<void>((resolve) => {
				finishSeek = resolve;
			}),
		start,
		position: vi.fn(),
		active: () => active,
		failed: vi.fn(),
	});
	const pending = loop.restart(2);
	await Promise.resolve();
	active = false;
	loop.cancel();
	finishSeek();
	await pending;
	expect(start).not.toHaveBeenCalled();
});

it("stops a restart which completed after pause", async () => {
	let finishStart: () => void = () => {};
	const stop = vi.fn(async () => {});
	const loop = createLoopRestart({
		stop,
		seek: async () => {},
		start: () =>
			new Promise<void>((resolve) => {
				finishStart = resolve;
			}),
		position: vi.fn(),
		active: () => true,
		failed: vi.fn(),
	});
	const pending = loop.restart(2);
	await Promise.resolve();
	await Promise.resolve();
	loop.cancel();
	finishStart();
	await pending;
	expect(stop).toHaveBeenCalledTimes(2);
});

it("starts a loop at the playhead and keeps it inside short recordings", () => {
	expect(loopAroundPlayhead(3, 24)).toEqual({
		enabled: true,
		start: 3,
		end: 8,
	});
	expect(loopAroundPlayhead(22, 24)).toEqual({
		enabled: true,
		start: 19,
		end: 24,
	});
	expect(loopAroundPlayhead(1, 2)).toEqual({ enabled: true, start: 0, end: 2 });
	expect(drawLoop(0, 0.04, 0.04)).toEqual({
		enabled: false,
		start: 0,
		end: 0.04,
	});
});

it("keeps edges ordered and the range inside the recording while dragging", () => {
	const loop = { enabled: true, start: 2, end: 6 };
	expect(setLoopEdge(loop, "start", 7, 10)).toMatchObject({
		start: 5.9,
		end: 6,
	});
	expect(setLoopEdge(loop, "end", 1, 10)).toMatchObject({ start: 2, end: 2.1 });
	expect(setLoopEdge(loop, "end", 30, 10)).toMatchObject({ end: 10 });
	expect(moveLoop(loop, 8, 10)).toMatchObject({ start: 6, end: 10 });
	expect(moveLoop(loop, -3, 10)).toMatchObject({ start: 0, end: 4 });
});

it("draws loops in either direction with a minimum length", () => {
	expect(drawLoop(5, 2, 10)).toEqual({ enabled: true, start: 2, end: 5 });
	expect(drawLoop(5, 5, 10)).toMatchObject({ start: 5, end: 5.1 });
	expect(drawLoop(10, 10, 10)).toMatchObject({ start: 9.9, end: 10 });
	expect(loopRange(drawLoop(5, 5, 10), 10)).toBeDefined();
	expect(
		loopRange(
			setLoopEdge({ enabled: true, start: 2, end: 6 }, "start", 7, 10),
			10,
		),
	).toBeDefined();
	expect(moveLoop({ enabled: true, start: 2, end: 20 }, 0, 10).end).toBe(10);
});

it("snaps to the closest target within tolerance", () => {
	expect(snapLoopTime(4.05, [0, 4, 4.1], 0.2)).toEqual({
		time: 4.1,
		snapped: true,
	});
	expect(snapLoopTime(3, [4], 0.2)).toEqual({ time: 3, snapped: false });
});

it("sets loop edges at the playhead and opens a new range when they would cross", () => {
	const loop = { enabled: false, start: 2, end: 6 };
	expect(setLoopEdgeAt(loop, "start", 3, 24)).toEqual({
		enabled: true,
		start: 3,
		end: 6,
	});
	expect(setLoopEdgeAt(loop, "start", 7, 24)).toEqual({
		enabled: true,
		start: 7,
		end: 12,
	});
	expect(setLoopEdgeAt(loop, "end", 1, 24)).toEqual({
		enabled: true,
		start: 0,
		end: 1,
	});
	expect(setLoopEdgeAt(loop, "end", 9, 24)).toEqual({
		enabled: true,
		start: 2,
		end: 9,
	});
});
