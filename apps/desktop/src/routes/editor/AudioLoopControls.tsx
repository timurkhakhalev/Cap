import { createUniqueId, For, Show } from "solid-js";
import { Toggle } from "~/components/Toggle";
import { loopRange, type PlaybackLoop } from "./playback-loop";

export function AudioLoopControls(props: {
	loop: PlaybackLoop;
	duration: number;
	playhead: number;
	onChange(loop: PlaybackLoop): void;
}) {
	const id = createUniqueId();
	const update = (edge: "start" | "end", value: number) => {
		if (!Number.isFinite(value)) return;
		props.onChange({
			...props.loop,
			[edge]: Math.max(0, Math.min(props.duration, value)),
		});
	};
	return (
		<div class="mt-3 border-t border-ed-line pt-3 text-xs text-ed-text-2">
			<div class="flex items-center justify-between gap-2">
				<span>Loop preview</span>
				<Toggle
					aria-label="Loop preview"
					size="sm"
					checked={props.loop.enabled}
					disabled={props.duration < 0.1}
					onChange={(enabled) => {
						const range = loopRange(
							{ ...props.loop, enabled: true },
							props.duration,
						);
						const start = Math.max(
							0,
							Math.min(props.playhead, props.duration - 0.1),
						);
						props.onChange(
							range
								? { ...range, enabled }
								: { start, end: Math.min(start + 10, props.duration), enabled },
						);
					}}
				/>
			</div>
			<Show when={props.loop.enabled}>
				<div class="mt-2 grid grid-cols-2 gap-2">
					<For each={["start", "end"] as const}>
						{(edge) => (
							<div>
								<label for={`${id}-${edge}`} class="block mb-1">
									{edge === "start" ? "Start (seconds)" : "End (seconds)"}
								</label>
								<input
									id={`${id}-${edge}`}
									type="number"
									min={0}
									max={props.duration}
									step={0.1}
									value={Number(props.loop[edge].toFixed(2))}
									class="w-full rounded-md bg-ed-ctl px-2 py-1.5 text-ed-text-1"
									onChange={(event) => {
										update(edge, event.currentTarget.valueAsNumber);
										event.currentTarget.value = String(
											Number(props.loop[edge].toFixed(2)),
										);
									}}
								/>
								<button
									type="button"
									class="mt-1.5 text-ed-accent hover:underline"
									aria-label={`Set loop ${edge} at playhead`}
									onClick={() => update(edge, props.playhead)}
								>
									Use playhead
								</button>
							</div>
						)}
					</For>
				</div>
				<Show
					when={!loopRange(props.loop, props.duration)}
					fallback={
						<p class="mt-2">
							Press Play to repeat this range. Export is unchanged.
						</p>
					}
				>
					<p role="alert" class="mt-2">
						End must be at least 0.1 seconds after start.
					</p>
				</Show>
			</Show>
		</div>
	);
}
