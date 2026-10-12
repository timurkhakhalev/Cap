import { describe, expect, it } from "vitest";
import {
	CAMERA_MAX_SIZE,
	CAMERA_MIN_SIZE,
	cameraPreviewDimensions,
	cameraResizeSize,
} from "./CameraPreviewChrome";

it("keeps portrait preview at 9:16 with the same short-side size", () => {
	for (const sourceAspect of [16 / 9, 4 / 3, 9 / 16]) {
		const { width, height } = cameraPreviewDimensions(
			230,
			"portrait",
			sourceAspect,
		);
		expect(width).toBe(230);
		expect(width / height).toBeCloseTo(9 / 16);
	}
	expect(cameraPreviewDimensions(230, "square")).toEqual({
		width: 230,
		height: 230,
	});
	expect(cameraPreviewDimensions(230, "full").height).toBe(230);
});

describe("camera corner resizing", () => {
	for (const shape of ["round", "square", "full", "portrait"] as const) {
		for (const corner of ["nw", "ne", "sw", "se"] as const) {
			it(`grows and shrinks ${shape} from ${corner} along either axis`, () => {
				const size = 230;
				const dimensions = cameraPreviewDimensions(size, shape, 2);
				const dirX = corner.includes("e") ? 1 : -1;
				const dirY = corner.includes("s") ? 1 : -1;
				for (const change of [-30, 30]) {
					const x = (change * dimensions.width * dirX) / size;
					const y = (change * dimensions.height * dirY) / size;
					for (const delta of [
						{ x, y: 0 },
						{ x: 0, y },
						{ x, y },
					]) {
						expect(
							cameraResizeSize(size, dimensions, corner, delta),
						).toBeCloseTo(size + change);
					}
				}
			});
		}
	}

	it("follows the dominant axis when the pointer crosses the corner diagonal", () => {
		const dimensions = cameraPreviewDimensions(230, "portrait");
		expect(cameraResizeSize(230, dimensions, "se", { x: -30, y: 10 })).toBe(
			200,
		);
		expect(cameraResizeSize(230, dimensions, "se", { x: 30, y: -10 })).toBe(
			260,
		);
	});

	it("clamps both ends of the allowed camera size", () => {
		const dimensions = cameraPreviewDimensions(230, "portrait");
		expect(
			cameraResizeSize(230, dimensions, "se", { x: -1000, y: -1000 }),
		).toBe(CAMERA_MIN_SIZE);
		expect(cameraResizeSize(230, dimensions, "se", { x: 1000, y: 1000 })).toBe(
			CAMERA_MAX_SIZE,
		);
	});
});
