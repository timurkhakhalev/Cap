import { fileURLToPath } from "node:url";
import AutoImport from "unplugin-auto-import/vite";
import { FileSystemIconLoader } from "unplugin-icons/loaders";
import IconsResolver from "unplugin-icons/resolver";
import Icons from "unplugin-icons/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
export default defineConfig({
	plugins: [
		AutoImport({
			resolvers: [
				IconsResolver({
					prefix: "Icon",
					extension: "jsx",
					customCollections: ["cap"],
				}),
			],
			dts: false,
		}),
		Icons({
			compiler: "solid",
			enabledCollections: ["lucide"],
			customCollections: {
				cap: FileSystemIconLoader(
					fileURLToPath(
						new URL("../../packages/ui-solid/icons", import.meta.url),
					),
				),
			},
		}),
		solid(),
	],
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
