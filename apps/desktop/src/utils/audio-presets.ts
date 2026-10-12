import type { AudioConfiguration } from "./tauri";

export type AudioPresetSettings = Pick<
	AudioConfiguration,
	"improve" | "isolation" | "filters" | "micVolumeDb"
>;
export type AudioPreset = {
	id: string;
	name: string;
	audio: AudioPresetSettings;
};

export function audioPresetSettings(
	audio: AudioConfiguration,
): AudioPresetSettings {
	return {
		improve: audio.improve,
		isolation: audio.isolation,
		micVolumeDb: audio.micVolumeDb,
		filters: { ...audio.filters },
	};
}

export function matchesAudioPreset(
	audio: AudioConfiguration,
	preset: AudioPreset,
) {
	return (
		audio.improve === preset.audio.improve &&
		audio.isolation === preset.audio.isolation &&
		Math.abs(audio.micVolumeDb - preset.audio.micVolumeDb) < 0.001 &&
		(
			Object.keys(audio.filters) as (keyof AudioConfiguration["filters"])[]
		).every((key) => {
			const a = audio.filters[key];
			const b = preset.audio.filters[key];
			return typeof a === "number" && typeof b === "number"
				? Math.abs(a - b) < 0.001
				: a === b;
		})
	);
}
