import { expect, it, vi } from "vitest";
import { createLoopRestart, loopRange, loopRestartTime } from "./playback-loop";

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
