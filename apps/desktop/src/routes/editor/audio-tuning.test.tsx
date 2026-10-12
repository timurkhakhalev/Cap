import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studioSoundFilters } from "~/utils/audio-filter-settings";
import { type AudioPreset, audioPresetSettings } from "~/utils/audio-presets";
import type { AudioConfiguration } from "~/utils/tauri";
import { AudioPresets } from "./AudioPresets";

let dispose: (() => void) | undefined;
beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
	dispose?.();
	document.body.replaceChildren();
	vi.restoreAllMocks();
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
	if (
		text === "Save as preset…" ||
		text.startsWith("Delete preset") ||
		text === "Use these settings for new recordings"
	) {
		document
			.querySelector('[aria-label="Audio preset actions"]')
			?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			);
	}
	const result = [
		...document.querySelectorAll('button, [role="menuitem"]'),
	].find(
		(item) =>
			item.textContent?.trim() === text ||
			item.getAttribute("aria-label") === text,
	);
	expect(result).toBeDefined();
	return result as HTMLButtonElement;
}
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

function chooseMenu(text: string) {
	button(text).dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
}

it("saves a named snapshot and restores it without changing other tracks or mute", async () => {
	const [current, setCurrent] = createStore(structuredClone(audio));
	const [presets, setPresets] = createSignal<AudioPreset[]>([]);
	dispose = render(
		() => (
			<AudioPresets
				onSaveDefault={() => {}}
				savingDefault={false}
				audio={current}
				presets={presets()}
				loading={false}
				onApply={(preset) => setCurrent(preset.audio)}
				onApplyStudioSound={() =>
					setCurrent({
						filters: { ...studioSoundFilters },
						isolation: "balanced",
					})
				}
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
	await settle();
	chooseMenu("Save as preset…");
	const input = document.querySelector("input") as HTMLInputElement;
	expect(button("Audio preset actions").getAttribute("aria-expanded")).toBe(
		"false",
	);
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
	expect(button("My microphone").getAttribute("aria-pressed")).toBe("false");
	expect(document.body.textContent).toContain("Custom");
	button("My microphone").click();
	expect(current.filters.ratio).toBe(2);
	expect(current.mute).toBe(true);
	expect(current.systemVolumeDb).toBe(-5);
	expect(button("My microphone").getAttribute("aria-pressed")).toBe("true");
	chooseMenu("Delete preset My microphone");
	await settle();
	expect(presets()).toEqual([]);
	chooseMenu("Save as preset…");
	expect(document.querySelector("input")).not.toBeNull();
	button("Cancel").click();
	expect(document.querySelector("input")).toBeNull();
});

it("keeps the name and exposes storage errors for retry", async () => {
	const save = vi.fn(async () => {
		throw new Error("disk");
	});
	dispose = render(
		() => (
			<AudioPresets
				onSaveDefault={() => {}}
				savingDefault={false}
				audio={audio}
				presets={[]}
				loading={false}
				onApply={() => {}}
				onApplyStudioSound={() => {}}
				onSave={save}
				onDelete={async () => {}}
			/>
		),
		document.body,
	);
	chooseMenu("Save as preset…");
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
				onSaveDefault={() => {}}
				savingDefault={false}
				audio={audio}
				presets={presets}
				loading={false}
				onApply={() => {}}
				onApplyStudioSound={() => {}}
				onSave={save}
				onDelete={remove}
			/>
		),
		document.body,
	);
	button("Travel").click();
	expect(button("Travel").getAttribute("aria-pressed")).toBe("true");
	expect(button("Desk").getAttribute("aria-pressed")).toBe("false");
	chooseMenu("Delete preset Travel");
	await settle();
	expect(remove).toHaveBeenCalledWith("1");
	chooseMenu("Save as preset…");
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

it("applies the built-in Studio Sound preset and marks edits as custom", () => {
	const [current, setCurrent] = createStore<AudioConfiguration>(
		structuredClone({ ...audio, isolation: "strong" as const }),
	);
	dispose = render(
		() => (
			<AudioPresets
				onSaveDefault={() => {}}
				savingDefault={false}
				audio={current}
				presets={[]}
				loading={false}
				onApply={() => {}}
				onApplyStudioSound={() =>
					setCurrent({
						filters: { ...studioSoundFilters },
						isolation: "balanced",
					})
				}
				onSave={async () => {}}
				onDelete={async () => {}}
			/>
		),
		document.body,
	);
	expect(button("Studio Sound").getAttribute("aria-pressed")).toBe("false");
	expect(document.body.textContent).toContain("Custom");
	button("Studio Sound").click();
	expect(current.isolation).toBe("balanced");
	expect(button("Studio Sound").getAttribute("aria-pressed")).toBe("true");
	expect(document.body.textContent).not.toContain("Custom");
	setCurrent("filters", "ratio", 6);
	expect(button("Studio Sound").getAttribute("aria-pressed")).toBe("false");
});

it("saves defaults only from the explicit preset menu action", () => {
	const save = vi.fn();
	dispose = render(
		() => (
			<AudioPresets
				audio={audio}
				presets={[]}
				loading={false}
				onApply={() => {}}
				onApplyStudioSound={() => {}}
				onSave={async () => {}}
				onDelete={async () => {}}
				onSaveDefault={save}
				savingDefault={false}
			/>
		),
		document.body,
	);
	expect(save).not.toHaveBeenCalled();
	chooseMenu("Use these settings for new recordings");
	expect(save).toHaveBeenCalledTimes(1);
});
