import { cx } from "cva";
import { createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import { Toggle } from "~/components/Toggle";
import type {
	AudioConfiguration,
	AudioFilters,
	VoiceIsolation,
} from "~/utils/tauri";
import { Slider } from "./ui";

const formatDb = (value: number) =>
	`${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

export const formatVolumeDb = (value: number) =>
	value <= -30 ? "Muted" : formatDb(value);

function Filter(props: {
	title: string;
	summary: string;
	enabled: boolean;
	onChange(value: boolean): void;
	children: JSX.Element;
}) {
	const [open, setOpen] = createSignal(false);
	const panel = createUniqueId();
	return (
		<div class="border-t border-ed-line">
			<div class="flex gap-2 items-center py-2">
				<button
					type="button"
					aria-expanded={open()}
					aria-controls={panel}
					aria-label={`${props.title} settings`}
					class="flex flex-1 gap-1.5 items-center min-w-0 text-left rounded-md focus-visible:outline focus-visible:outline-ed-accent"
					onClick={() => setOpen(!open())}
				>
					<IconCapChevronDown
						class={cx(
							"size-3 shrink-0 text-ed-text-3 transition-transform",
							!open() && "-rotate-90",
						)}
					/>
					<span
						class={cx(
							"text-xs font-medium truncate",
							props.enabled ? "text-ed-text-1" : "text-ed-text-3",
						)}
					>
						{props.title}
					</span>
					<span class="ml-auto text-[11px] tabular-nums whitespace-nowrap text-ed-text-3">
						{props.enabled ? props.summary : "Off"}
					</span>
				</button>
				<Toggle
					size="sm"
					aria-label={props.title}
					checked={props.enabled}
					onChange={props.onChange}
				/>
			</div>
			<Show when={open()}>
				<div
					id={panel}
					class={cx("pb-3 pl-[18px]", !props.enabled && "opacity-50")}
				>
					{props.children}
				</div>
			</Show>
		</div>
	);
}

function Parameter(props: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	onChange(value: number): void;
}) {
	const id = createUniqueId();
	return (
		<div class="mt-2 first:mt-0">
			<div class="flex gap-2 justify-between items-center">
				<label for={id} class="text-xs text-ed-text-2">
					{props.label}
				</label>
				<div class="flex gap-1 items-center text-xs text-ed-text-3">
					<input
						id={id}
						type="number"
						min={props.min}
						max={props.max}
						step={props.step}
						value={Number(props.value.toFixed(1))}
						class="px-1.5 py-0.5 w-14 text-right rounded-md bg-ed-ctl text-ed-text-1 focus-visible:outline focus-visible:outline-ed-accent"
						onChange={(event) => {
							const value = event.currentTarget.valueAsNumber;
							if (Number.isFinite(value))
								props.onChange(Math.min(props.max, Math.max(props.min, value)));
							event.currentTarget.value = String(
								Number(props.value.toFixed(1)),
							);
						}}
					/>
					<span class="w-7">{props.unit}</span>
				</div>
			</div>
			<Slider
				class="mt-1.5"
				aria-label={props.label}
				value={[props.value]}
				minValue={props.min}
				maxValue={props.max}
				step={props.step}
				onChange={([value]) => props.onChange(value)}
				formatTooltip={(value) => `${value.toFixed(1)} ${props.unit}`}
			/>
		</div>
	);
}

function Kbd(props: { children: string }) {
	return (
		<kbd class="px-1 py-px font-sans text-[10px] rounded border border-ed-line bg-ed-ctl text-ed-text-2">
			{props.children}
		</kbd>
	);
}

const strengths: { value: VoiceIsolation; label: string }[] = [
	{ value: "light", label: "Light" },
	{ value: "balanced", label: "Balanced" },
	{ value: "strong", label: "Strong" },
];

export function AudioFiltersCard(props: {
	audio: AudioConfiguration;
	previewBypass: boolean;
	onPreviewBypassChange(value: boolean): void;
	onChange(patch: Partial<AudioConfiguration>): void;
	children?: JSX.Element;
}) {
	const filters = () => props.audio.filters;
	const update = (patch: Partial<AudioFilters>) =>
		props.onChange({ filters: { ...filters(), ...patch } });
	const strengthLabel = () =>
		strengths.find((strength) => strength.value === props.audio.isolation)
			?.label ?? "";
	return (
		<section
			aria-label="Microphone processing"
			class="p-3.5 rounded-xl bg-ed-card-2"
		>
			<div class="flex gap-3 justify-between items-center">
				<span class="text-xs text-ed-text-2 shrink-0">Mic volume</span>
				<span class="text-[11px] tabular-nums text-ed-text-3">
					{formatVolumeDb(props.audio.micVolumeDb)}
				</span>
			</div>
			<Slider
				class="mt-2"
				aria-label="Microphone volume"
				disabled={props.audio.mute}
				value={[props.audio.micVolumeDb]}
				minValue={-30}
				maxValue={10}
				step={0.1}
				onChange={([micVolumeDb]) => props.onChange({ micVolumeDb })}
				formatTooltip={formatVolumeDb}
			/>
			<div class="flex gap-3 justify-between items-center pt-3 mt-3 border-t border-ed-line">
				<div>
					<h3 class="text-[13px] font-medium text-ed-text-1">
						Voice processing
					</h3>
					<p class="mt-0.5 text-xs text-ed-text-3">
						Cleans up your voice. Originals stay untouched.
					</p>
				</div>
				<Toggle
					aria-label="Voice processing"
					checked={props.audio.improve}
					onChange={(improve) => props.onChange({ improve })}
				/>
			</div>
			{props.children}
			<Show when={!props.audio.improve}>
				<p class="mt-3 text-xs text-ed-text-2">
					Processing is off. Your filter settings are kept.
				</p>
			</Show>
			<Show when={props.audio.improve}>
				<Show when={props.previewBypass}>
					<div
						aria-live="polite"
						class="flex gap-2 justify-between items-center p-2 mt-3 text-xs rounded-lg bg-ed-ctl text-ed-text-2"
					>
						<span>Playing the original audio.</span>
						<button
							type="button"
							class="font-medium text-ed-accent hover:underline"
							onClick={() => props.onPreviewBypassChange(false)}
						>
							Back to processed
						</button>
					</div>
				</Show>
				<div class="mt-3">
					<Filter
						title="Noise reduction"
						summary={strengthLabel()}
						enabled={filters().noiseReduction}
						onChange={(noiseReduction) => update({ noiseReduction })}
					>
						<div
							class="flex p-0.5 rounded-lg bg-ed-ctl"
							role="group"
							aria-label="Noise reduction strength"
						>
							<For each={strengths}>
								{(strength) => (
									<button
										type="button"
										aria-pressed={props.audio.isolation === strength.value}
										class="flex-1 py-1 text-xs rounded-md text-ed-text-2 focus-visible:outline focus-visible:outline-ed-accent"
										classList={{
											"bg-ed-card text-ed-text-1":
												props.audio.isolation === strength.value,
										}}
										onClick={() =>
											props.onChange({ isolation: strength.value })
										}
									>
										{strength.label}
									</button>
								)}
							</For>
						</div>
						<p class="mt-2 text-xs text-ed-text-3">
							{props.audio.isolation === "strong"
								? "Strong reduction may change the texture of your voice."
								: "Reduces steady background noise like fans and hum."}
						</p>
					</Filter>
					<Filter
						title="Auto volume"
						summary={`${filters().targetLufs.toFixed(0)} LUFS`}
						enabled={filters().autoLevel}
						onChange={(autoLevel) => update({ autoLevel })}
					>
						<Parameter
							label="Voice level"
							value={filters().targetLufs}
							min={-30}
							max={-10}
							step={1}
							unit="LUFS"
							onChange={(targetLufs) => update({ targetLufs })}
						/>
						<p class="mt-2 text-xs text-ed-text-3">
							Brings quiet speech to a consistent level.
						</p>
					</Filter>
					<Filter
						title="Compressor"
						summary={`${filters().thresholdDb.toFixed(0)} dB · ${filters().ratio.toFixed(1)}:1`}
						enabled={filters().compressor}
						onChange={(compressor) => update({ compressor })}
					>
						<Parameter
							label="Threshold"
							value={filters().thresholdDb}
							min={-60}
							max={0}
							step={1}
							unit="dB"
							onChange={(thresholdDb) => update({ thresholdDb })}
						/>
						<Parameter
							label="Compression"
							value={filters().ratio}
							min={1}
							max={20}
							step={0.5}
							unit=":1"
							onChange={(ratio) => update({ ratio })}
						/>
						<Parameter
							label="Attack"
							value={filters().attackMs}
							min={1}
							max={100}
							step={1}
							unit="ms"
							onChange={(attackMs) => update({ attackMs })}
						/>
						<Parameter
							label="Release"
							value={filters().releaseMs}
							min={10}
							max={1000}
							step={10}
							unit="ms"
							onChange={(releaseMs) => update({ releaseMs })}
						/>
						<p class="mt-2 text-xs text-ed-text-3">
							Softens loud words above the threshold.
						</p>
					</Filter>
					<Filter
						title="Peak protection"
						summary={formatDb(filters().ceilingDb)}
						enabled={filters().limiter}
						onChange={(limiter) => update({ limiter })}
					>
						<Parameter
							label="Maximum level"
							value={filters().ceilingDb}
							min={-12}
							max={-0.1}
							step={0.1}
							unit="dB"
							onChange={(ceilingDb) => update({ ceilingDb })}
						/>
						<p class="mt-2 text-xs text-ed-text-3">
							Limits microphone peaks. Clip volume and other tracks can still
							raise final peaks.
						</p>
					</Filter>
				</div>
				<Show
					when={
						!filters().limiter &&
						(filters().autoLevel || props.audio.micVolumeDb > 0)
					}
				>
					<div
						role="status"
						class="flex gap-2 items-start p-2.5 mt-1 text-xs rounded-lg bg-amber-400/10 text-ed-text-2"
					>
						<p class="flex-1">
							Peak protection is off. Raising the volume can distort loud words.
						</p>
						<button
							type="button"
							class="font-medium whitespace-nowrap text-ed-accent hover:underline"
							onClick={() => update({ limiter: true })}
						>
							Turn on
						</button>
					</div>
				</Show>
				<p class="flex gap-3 items-center pt-3 mt-1 text-[11px] border-t border-ed-line text-ed-text-3">
					<span class="flex gap-1 items-center">
						<Kbd>B</Kbd> compare
					</span>
					<span class="flex gap-1 items-center">
						<Kbd>L</Kbd> loop a phrase
					</span>
				</p>
			</Show>
		</section>
	);
}
