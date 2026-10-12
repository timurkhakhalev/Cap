import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { studioSoundFilters } from "~/utils/audio-filter-settings";
import { type AudioPreset, audioPresetSettings } from "~/utils/audio-presets";
import type { AudioConfiguration } from "~/utils/tauri";
import { AudioLoopControls } from "./AudioLoopControls";
import { AudioPresets } from "./AudioPresets";

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
});
const audio: AudioConfiguration = {
	improve: true,
	mute: false,
	isolation: "balanced",
	micVolumeDb: 3,
	micStereoMode: "stereo",
	systemVolumeDb: 2,
	filters: { ...studioSoundFilters },
};
function button(text: string) {
	const result = [...document.querySelectorAll("button")].find(
		(item) => item.textContent === text,
	);
	expect(result).toBeDefined();
	return result as HTMLButtonElement;
}
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

it("saves a named snapshot and restores it without changing other tracks or mute", async () => {
	const [current, setCurrent] = createStore(structuredClone(audio));
	const [presets, setPresets] = createSignal<AudioPreset[]>([]);
	dispose = render(
		() => (
			<AudioPresets
				audio={current}
				presets={presets()}
				loading={false}
				onApply={(preset) => setCurrent(preset.audio)}
				onSave={async (name) => {
					setPresets([
						{ id: "one", name, audio: audioPresetSettings(current) },
					]);
				}}
				onDelete={async (id) => {
					setPresets((items) => items.filter((item) => item.id !== id));
				}}
			/>
		),
		document.body,
	);
	button("Save as preset…").click();
	const input = document.querySelector("input") as HTMLInputElement;
	input.value = "My microphone";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	(document.querySelector("form") as HTMLFormElement).dispatchEvent(
		new Event("submit", { bubbles: true, cancelable: true }),
	);
	await settle();
	expect(presets()[0].name).toBe("My microphone");
	setCurrent("filters", "ratio", 8);
	setCurrent({ mute: true, systemVolumeDb: -5 });
	expect(presets()[0].audio.filters.ratio).toBe(2);
	const select = document.querySelector("select") as HTMLSelectElement;
	expect(select.value).toBe("");
	select.value = "one";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	expect(current.filters.ratio).toBe(2);
	expect(current.mute).toBe(true);
	expect(current.systemVolumeDb).toBe(-5);
	button("Delete preset").click();
	await settle();
	expect(presets()).toEqual([]);
});

it("keeps the name and exposes storage errors for retry", async () => {
	const save = vi.fn(async () => {
		throw new Error("disk");
	});
	dispose = render(
		() => (
			<AudioPresets
				audio={audio}
				presets={[]}
				loading={false}
				onApply={() => {}}
				onSave={save}
				onDelete={async () => {}}
			/>
		),
		document.body,
	);
	button("Save as preset…").click();
	const input = document.querySelector("input") as HTMLInputElement;
	input.value = "Desk";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	document
		.querySelector("form")
		?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	await settle();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"Try again",
	);
	expect(input.value).toBe("Desk");
});

it("keeps explicitly selected presets distinct even with identical settings", async () => {
	const presets = ["Desk", "Travel"].map((name, index) => ({
		id: String(index),
		name,
		audio: audioPresetSettings(audio),
	}));
	const remove = vi.fn(async () => {});
	const save = vi.fn(async () => {});
	dispose = render(
		() => (
			<AudioPresets
				audio={audio}
				presets={presets}
				loading={false}
				onApply={() => {}}
				onSave={save}
				onDelete={remove}
			/>
		),
		document.body,
	);
	const select = document.querySelector("select") as HTMLSelectElement;
	select.value = "1";
	select.dispatchEvent(new Event("change", { bubbles: true }));
	expect(select.value).toBe("1");
	button("Delete preset").click();
	await settle();
	expect(remove).toHaveBeenCalledWith("1");
	button("Save as preset…").click();
	const input = document.querySelector("input") as HTMLInputElement;
	input.value = " desk ";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	document
		.querySelector("form")
		?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	await settle();
	expect(save).not.toHaveBeenCalled();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"already used",
	);
});

it("sets loop boundaries from the playhead and reports reversed ranges", () => {
	const [loop, setLoop] = createStore({ enabled: false, start: 0, end: 0 });
	const [playhead, setPlayhead] = createSignal(5);
	dispose = render(
		() => (
			<AudioLoopControls
				loop={loop}
				duration={30}
				playhead={playhead()}
				onChange={setLoop}
			/>
		),
		document.body,
	);
	(
		document.querySelector(
			'input[aria-label="Loop preview"]',
		) as HTMLInputElement
	).click();
	expect(loop).toEqual({ enabled: true, start: 5, end: 15 });
	setPlayhead(3);
	(
		document.querySelector(
			'[aria-label="Set loop end at playhead"]',
		) as HTMLButtonElement
	).click();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain(
		"after start",
	);
	setPlayhead(12);
	(
		document.querySelector(
			'[aria-label="Set loop end at playhead"]',
		) as HTMLButtonElement
	).click();
	expect(loop.end).toBe(12);
	expect(document.querySelector('[role="alert"]')).toBeNull();
});
