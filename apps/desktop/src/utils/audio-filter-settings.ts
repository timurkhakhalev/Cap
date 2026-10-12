import type { AudioFilters } from "./tauri";

export const studioSoundFilters: AudioFilters = {
	noiseReduction: true,
	autoLevel: true,
	targetLufs: -16,
	compressor: true,
	thresholdDb: -18.0618,
	ratio: 2,
	attackMs: 15,
	releaseMs: 180,
	limiter: true,
	ceilingDb: -1.5,
};
