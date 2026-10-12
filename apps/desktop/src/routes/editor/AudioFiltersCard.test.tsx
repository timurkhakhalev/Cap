import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studioSoundFilters } from "~/utils/audio-filter-settings";
import type { AudioConfiguration } from "~/utils/tauri";
import { AudioFiltersCard } from "./AudioFiltersCard";
import { createStoreHistory } from "./project-history";

vi.mock("./context", () => ({ useEditorContext: () => undefined }));
vi.mock("@tauri-apps/plugin-os", () => ({ type: () => "macos" }));
let dispose: (() => void) | undefined;
beforeEach(() =>
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	),
);
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});
function mount() {
	const [previewBypass, setPreviewBypass] = createSignal(false);
	const [audio, setAudio] = createStore<AudioConfiguration>({
		mute: false,
		improve: true,
		isolation: "balanced",
		filters: { ...studioSoundFilters },
		micVolumeDb: 0,
		micStereoMode: "stereo",
		systemVolumeDb: 0,
	});
	const save = vi.fn();
	dispose = render(() => {
		createStoreHistory(audio, setAudio);
		return (
			<AudioFiltersCard
				audio={audio}
				previewBypass={previewBypass()}
				onPreviewBypassChange={setPreviewBypass}
				onChange={(patch) => setAudio(patch)}
				onSaveDefault={save}
				savingDefault={false}
			/>
		);
	}, document.body);
	return { audio, save, previewBypass };
}
function input(label: string) {
	const element = document.querySelector<HTMLInputElement>(
		`input[aria-label="${label}"]`,
	);
	expect(element, `${label} must have an accessible input`).not.toBeNull();
	return element as HTMLInputElement;
}
function numeric(label: string) {
	const title = [...document.querySelectorAll("label")].find(
		(item) => item.textContent === label,
	);
	expect(title).toBeDefined();
	return document.getElementById(title?.htmlFor ?? "") as HTMLInputElement;
}
it("disables filters independently and keeps settings when processing is off", () => {
	const { audio, save } = mount();
	input("Noise reduction").click();
	expect(audio.filters.noiseReduction).toBe(false);
	expect(audio.filters.compressor).toBe(true);
	expect(audio.filters.limiter).toBe(true);
	expect(save).not.toHaveBeenCalled();
	input("Voice processing").click();
	expect(audio.improve).toBe(false);
	input("Voice processing").click();
	expect(audio.filters.noiseReduction).toBe(false);
});
it("bounds numeric changes and hides advanced timing initially", () => {
	const { audio } = mount();
	expect(document.querySelector("details")?.open).toBe(false);
	const threshold = numeric("Threshold");
	threshold.value = "-28";
	threshold.dispatchEvent(new Event("change", { bubbles: true }));
	expect(audio.filters.thresholdDb).toBe(-28);
	const ratio = numeric("Compression");
	ratio.value = "999";
	ratio.dispatchEvent(new Event("change", { bubbles: true }));
	expect(audio.filters.ratio).toBe(20);
	ratio.value = "";
	ratio.dispatchEvent(new Event("change", { bubbles: true }));
	expect(audio.filters.ratio).toBe(20);
});
it("resets processing and saves defaults only on explicit click", () => {
	const { audio, save } = mount();
	input("Compressor").click();
	const button = (label: string) =>
		[...document.querySelectorAll("button")].find(
			(item) => item.textContent === label,
		);
	button("Reset to Studio Sound")?.click();
	expect(audio.filters).toEqual(studioSoundFilters);
	expect(save).not.toHaveBeenCalled();
	button("Use these settings for new recordings")?.click();
	expect(save).toHaveBeenCalledTimes(1);
});

it("explains clipping risk only while unprotected volume processing is active", () => {
	mount();
	expect(document.querySelector('[role="status"]')).toBeNull();
	input("Peak protection").click();
	expect(document.querySelector('[role="status"]')?.textContent).toContain(
		"distort loud words",
	);
	input("Voice processing").click();
	expect(document.querySelector('[role="status"]')).toBeNull();
	input("Voice processing").click();
	expect(document.querySelector('[role="status"]')).not.toBeNull();
	input("Peak protection").click();
	expect(document.querySelector('[role="status"]')).toBeNull();
});

it("undoes and redoes filter changes with the editor keyboard history", async () => {
	const { audio } = mount();
	await Promise.resolve();
	input("Noise reduction").click();
	await Promise.resolve();
	const threshold = numeric("Threshold");
	threshold.value = "-28";
	threshold.dispatchEvent(new Event("change", { bubbles: true }));
	await Promise.resolve();
	const undo = (redo = false) =>
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				code: "KeyZ",
				metaKey: true,
				shiftKey: redo,
				bubbles: true,
				cancelable: true,
			}),
		);
	undo();
	expect(audio.filters.thresholdDb).toBe(studioSoundFilters.thresholdDb);
	expect(audio.filters.noiseReduction).toBe(false);
	undo();
	expect(audio.filters.noiseReduction).toBe(true);
	undo(true);
	expect(audio.filters.noiseReduction).toBe(false);
	undo(true);
	expect(audio.filters.thresholdDb).toBe(-28);
});

it("compares unprocessed audio without changing saved filter settings", () => {
	const { audio, save, previewBypass } = mount();
	const original = JSON.stringify(audio);
	const compare = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === "Listen without filters",
	);
	expect(compare).toBeDefined();
	compare?.click();
	expect(previewBypass()).toBe(true);
	expect(compare?.getAttribute("aria-pressed")).toBe("true");
	expect(JSON.stringify(audio)).toBe(original);
	expect(save).not.toHaveBeenCalled();
	compare?.click();
	expect(previewBypass()).toBe(false);
	expect(JSON.stringify(audio)).toBe(original);
});

it("names sliders and changes their values with the keyboard", () => {
	const { audio } = mount();
	const slider = document.querySelector<HTMLElement>(
		'[role="slider"][aria-label="Threshold"]',
	);
	expect(slider).not.toBeNull();
	const before = audio.filters.thresholdDb;
	slider?.focus();
	slider?.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
	);
	slider?.dispatchEvent(
		new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
	);
	expect(audio.filters.thresholdDb).toBeGreaterThan(before);
});
