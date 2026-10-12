import { fileURLToPath } from "node:url";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
export default defineConfig({
	plugins: [solid()],
	resolve: {
		alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
		conditions: ["development", "browser"],
	},
	test: {
		environment: "jsdom",
		include: [
			"src/routes/editor/AudioFiltersCard.test.tsx",
			"src/routes/editor/audio-tuning.test.tsx",
			"src/routes/editor/playback-loop.test.ts",
		],
		maxWorkers: 1,
		fileParallelism: false,
	},
});
