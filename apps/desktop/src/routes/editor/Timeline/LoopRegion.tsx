import { createEventListenerMap } from "@solid-primitives/event-listener";
import { cx } from "cva";
import { createRoot, createSignal, For, onCleanup, Show } from "solid-js";
import { clipDuration, clipTimelineOffsets } from "../clip-transitions";
import { FPS, useEditorContext } from "../context";
import {
	drawLoop,
	loopRange,
	moveLoop,
	type PlaybackLoop,
	setLoopEdge,
	snapLoopTime,
} from "../playback-loop";
import { formatTime } from "../utils";
import { useTimelineContext } from "./context";
import { SPLIT_SNAP_PX } from "./split-snapping";

const OVERLAY_TRACKS = [
	"zoomSegments",
	"sceneSegments",
	"textSegments",
	"captionSegments",
	"keyboardSegments",
	"audioSegments",
] as const;

type LoopDrag = "start" | "end" | "move" | "draw";

const formatLoopTime = (seconds: number) =>
	`${formatTime(seconds)}.${Math.floor((seconds % 1) * 10)}`;

export function createLoopEditing(secsPerPixel: () => number) {
	const { editorState, setEditorState, project, totalDuration } =
		useEditorContext();
	const [drag, setDrag] = createSignal<LoopDrag | null>(null);
	let finishDrag: (() => void) | undefined;
	onCleanup(() => finishDrag?.());

	const range = () => loopRange(editorState.playbackLoop, totalDuration());

	const snapTargets = () => {
		const targets = [0, totalDuration(), editorState.playbackTime];
		const timeline = project.timeline;
		if (!timeline) return targets;
		const offsets = clipTimelineOffsets(
			timeline.segments,
			timeline.transitions ?? [],
		);
		timeline.segments.forEach((segment, index) => {
			targets.push(offsets[index], offsets[index] + clipDuration(segment));
		});
		for (const key of OVERLAY_TRACKS) {
			for (const segment of timeline[key] ?? []) {
				targets.push(segment.start, segment.end);
			}
		}
		return targets;
	};

	const snap = (time: number, bypass: boolean) =>
		bypass
			? time
			: snapLoopTime(time, snapTargets(), SPLIT_SNAP_PX * secsPerPixel()).time;

	function begin(
		kind: LoopDrag,
		event: MouseEvent,
		timeAt: (clientX: number) => number | null,
	) {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		const origin = timeAt(event.clientX);
		if (origin === null) return;
		finishDrag?.();
		const initial: PlaybackLoop = { ...editorState.playbackLoop, ...range() };
		const anchor = snap(origin, event.altKey);
		setDrag(kind);

		const update = (moveEvent: MouseEvent) => {
			const time = timeAt(moveEvent.clientX);
			if (time === null) return;
			const duration = totalDuration();
			const free = moveEvent.altKey;
			let next: PlaybackLoop;
			if (kind === "draw") {
				next = drawLoop(anchor, snap(time, free), duration);
			} else if (kind === "move") {
				const length = initial.end - initial.start;
				const start = initial.start + time - origin;
				const snappedStart = snap(start, free);
				const shifted =
					snappedStart !== start
						? snappedStart
						: snap(start + length, free) - length;
				next = moveLoop(initial, shifted, duration);
			} else {
				next = setLoopEdge(initial, kind, snap(time, free), duration);
			}
			setEditorState("playbackLoop", next);
		};

		if (kind === "draw") update(event);

		createRoot((dispose) => {
			finishDrag = () => {
				setDrag(null);
				dispose();
				finishDrag = undefined;
			};
			createEventListenerMap(window, {
				mousemove: update,
				mouseup: () => finishDrag?.(),
				blur: () => finishDrag?.(),
				keydown: (keyEvent) => {
					if (keyEvent.key !== "Escape") return;
					setEditorState("playbackLoop", initial);
					finishDrag?.();
				},
			});
		});
	}

	function keyboard(kind: "start" | "end" | "move", event: KeyboardEvent) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		event.stopPropagation();
		const current = range();
		if (!current) return;
		const delta =
			(event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 1 / FPS);
		const loop = { ...current, enabled: true };
		setEditorState(
			"playbackLoop",
			kind === "move"
				? moveLoop(loop, current.start + delta, totalDuration())
				: setLoopEdge(loop, kind, current[kind] + delta, totalDuration()),
		);
	}
	return { range, drag, begin, keyboard };
}

export type LoopEditing = ReturnType<typeof createLoopEditing>;

export function LoopRulerRegion(props: {
	loop: LoopEditing;
	left: number;
	timeAt: (clientX: number) => number | null;
}) {
	const { editorState, totalDuration } = useEditorContext();
	const { secsPerPixel } = useTimelineContext();
	const x = (time: number) =>
		(time - editorState.timeline.transform.position) / secsPerPixel();

	return (
		<Show when={props.loop.range()}>
			{(range) => (
				<div
					class="absolute inset-y-0 right-0 z-50 overflow-hidden pointer-events-none"
					style={{ left: `${props.left}px` }}
				>
					<div
						role="group"
						aria-label={`Loop preview ${formatTime(range().start)} to ${formatTime(range().end)}`}
						class="absolute inset-y-0 bg-amber-400/10"
						style={{
							transform: `translateX(${x(range().start)}px)`,
							width: `${Math.max((range().end - range().start) / secsPerPixel(), 2)}px`,
						}}
					>
						<button
							type="button"
							aria-label="Move loop"
							title="Drag to move the loop. Hold Option to skip snapping."
							class={cx(
								"group absolute inset-x-0 top-0 h-2 pointer-events-auto",
								props.loop.drag() === "move"
									? "cursor-grabbing"
									: "cursor-grab",
							)}
							onMouseDown={(event) =>
								props.loop.begin("move", event, props.timeAt)
							}
							onKeyDown={(event) => props.loop.keyboard("move", event)}
						>
							<div class="h-[3px] bg-amber-400 transition-[height] group-hover:h-1.5" />
						</button>
						<Show when={props.loop.drag()}>
							<div class="absolute top-1 left-1/2 px-1.5 py-px text-[10px] font-medium tabular-nums leading-tight whitespace-nowrap rounded-full -translate-x-1/2 pointer-events-none bg-amber-400 text-black">
								{formatLoopTime(range().start)} – {formatLoopTime(range().end)}
							</div>
						</Show>
						<For each={["start", "end"] as const}>
							{(edge) => (
								<div
									role="slider"
									tabIndex={0}
									aria-valuemin={edge === "start" ? 0 : range().start + 0.1}
									aria-valuemax={
										edge === "start" ? range().end - 0.1 : totalDuration()
									}
									aria-valuenow={range()[edge]}
									aria-valuetext={formatLoopTime(range()[edge])}
									onKeyDown={(event) => props.loop.keyboard(edge, event)}
									aria-label={edge === "start" ? "Loop start" : "Loop end"}
									class={cx(
										"absolute inset-y-0 w-3 cursor-ew-resize pointer-events-auto",
										edge === "start" ? "-left-1.5" : "-right-1.5",
									)}
									onMouseDown={(event) =>
										props.loop.begin(edge, event, props.timeAt)
									}
								>
									<div class="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400" />
									<div
										class={cx(
											"absolute top-0 h-2.5 w-1.5 bg-amber-400",
											edge === "start"
												? "left-1/2 rounded-br-sm"
												: "right-1/2 rounded-bl-sm",
										)}
									/>
								</div>
							)}
						</For>
					</div>
				</div>
			)}
		</Show>
	);
}

export function LoopTrackShade(props: {
	loop: LoopEditing;
	left: number;
	top: number;
}) {
	const { editorState } = useEditorContext();
	const { secsPerPixel } = useTimelineContext();
	const x = (time: number) =>
		(time - editorState.timeline.transform.position) / secsPerPixel();

	return (
		<Show when={props.loop.range()}>
			{(range) => (
				<div
					class="absolute right-0 bottom-0 z-10 overflow-hidden pointer-events-none"
					style={{ left: `${props.left}px`, top: `${props.top}px` }}
				>
					<div
						class="absolute inset-y-0 border-x border-amber-400/60 bg-amber-400/[0.04]"
						style={{
							transform: `translateX(${x(range().start)}px)`,
							width: `${(range().end - range().start) / secsPerPixel()}px`,
						}}
					/>
				</div>
			)}
		</Show>
	);
}
