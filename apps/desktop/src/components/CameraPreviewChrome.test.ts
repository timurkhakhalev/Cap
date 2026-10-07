import { expect, it } from "vitest";
import { cameraPreviewDimensions } from "./CameraPreviewChrome";

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
