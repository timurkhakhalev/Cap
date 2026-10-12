import { createUniqueId, For, type JSX, Show } from "solid-js";
import { Toggle } from "~/components/Toggle";
import { studioSoundFilters } from "~/utils/audio-filter-settings";
import type {
	AudioConfiguration,
	AudioFilters,
	VoiceIsolation,
} from "~/utils/tauri";
import { Slider } from "./ui";

function Filter(props: {
	title: string;
	description: string;
	enabled: boolean;
	onChange(value: boolean): void;
	children: JSX.Element;
}) {
	return (
		<div class="py-3 border-t border-ed-line">
			<div class="flex gap-3 items-center justify-between">
				<div>
					<div class="text-xs font-medium text-ed-text-1">{props.title}</div>
					<p class="mt-0.5 text-xs text-ed-text-3">{props.description}</p>
				</div>
				<Toggle
					size="sm"
					aria-label={props.title}
					checked={props.enabled}
					onChange={props.onChange}
				/>
			</div>
			<Show when={props.enabled}>
				<div class="mt-3">{props.children}</div>
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
		<div class="mt-2">
			<div class="flex items-center justify-between gap-2">
				<label for={id} class="text-xs text-ed-text-2">
					{props.label}
				</label>
				<div class="flex items-center gap-1 text-xs text-ed-text-3">
					<input
						id={id}
						type="number"
						min={props.min}
						max={props.max}
						step={props.step}
						value={Number(props.value.toFixed(1))}
						class="w-16 rounded-md bg-ed-ctl px-2 py-1 text-right text-ed-text-1 focus-visible:outline focus-visible:outline-ed-accent"
						onChange={(event) => {
							const value = event.currentTarget.valueAsNumber;
							if (Number.isFinite(value))
								props.onChange(Math.min(props.max, Math.max(props.min, value)));
							event.currentTarget.value = String(
								Number(props.value.toFixed(1)),
							);
						}}
					/>
					<span>{props.unit}</span>
				</div>
			</div>
			<Slider
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

export function AudioFiltersCard(props: {
	audio: AudioConfiguration;
	previewBypass: boolean;
	onPreviewBypassChange(value: boolean): void;
	onChange(patch: Partial<AudioConfiguration>): void;
	onSaveDefault(): void;
	savingDefault: boolean;
	children?: JSX.Element;
}) {
	const filters = () => props.audio.filters;
	const update = (patch: Partial<AudioFilters>) =>
		props.onChange({ filters: { ...filters(), ...patch } });
	const strengths: { value: VoiceIsolation; label: string }[] = [
		{ value: "light", label: "Light" },
		{ value: "balanced", label: "Balanced" },
		{ value: "strong", label: "Strong" },
	];
	return (
		<section
			aria-label="Microphone processing"
			class="p-3.5 rounded-xl bg-ed-card-2"
		>
			<div class="flex justify-between items-center gap-3">
				<div>
					<h3 class="text-[13px] font-medium text-ed-text-1">
						Voice processing
					</h3>
					<p class="mt-0.5 text-xs text-ed-text-3">
						Adjust your recorded voice. Originals stay untouched.
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
				<button
					type="button"
					aria-pressed={props.previewBypass}
					onClick={() => props.onPreviewBypassChange(!props.previewBypass)}
					class="mt-3 w-full rounded-lg border border-ed-line px-3 py-2 text-xs text-ed-text-1 hover:bg-ed-ctl focus-visible:outline focus-visible:outline-ed-accent"
				>
					{props.previewBypass
						? "Back to processed voice"
						: "Listen without filters"}
				</button>
				<Show when={props.previewBypass}>
					<p class="mt-2 text-xs text-ed-text-2">
						Preview only. Your export keeps these filter settings.
					</p>
				</Show>
				<Show
					when={
						!filters().limiter &&
						(filters().autoLevel || props.audio.micVolumeDb > 0)
					}
				>
					<p
						role="status"
						class="mt-3 rounded-lg bg-ed-ctl p-2.5 text-xs text-ed-text-2"
					>
						Peak protection is off. Raising the volume can distort loud words.
						Turn on Peak protection to keep peaks under control.
					</p>
				</Show>
				<details class="mt-3">
					<summary class="cursor-pointer py-2 text-xs font-medium text-ed-text-2 focus-visible:outline focus-visible:outline-ed-accent">
						Advanced tuning
					</summary>
					<button
						type="button"
						class="mt-3 mb-2 text-xs text-ed-accent hover:underline focus-visible:outline focus-visible:outline-ed-accent"
						onClick={() =>
							props.onChange({
								filters: { ...studioSoundFilters },
								isolation: "balanced",
							})
						}
					>
						Reset to Studio Sound
					</button>
					<Filter
						title="Noise reduction"
						description="Reduce steady background noise."
						enabled={filters().noiseReduction}
						onChange={(noiseReduction) => update({ noiseReduction })}
					>
						<div
							class="flex rounded-lg bg-ed-ctl p-0.5"
							role="group"
							aria-label="Noise reduction strength"
						>
							<For each={strengths}>
								{(strength) => (
									<button
										type="button"
										aria-pressed={props.audio.isolation === strength.value}
										class="flex-1 rounded-md py-1.5 text-xs text-ed-text-2 focus-visible:outline focus-visible:outline-ed-accent"
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
						<Show when={props.audio.isolation === "strong"}>
							<p class="mt-2 text-xs text-ed-text-3">
								Strong reduction may change the texture of your voice.
							</p>
						</Show>
					</Filter>
					<Filter
						title="Auto volume"
						description="Bring quiet speech to a consistent level."
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
					</Filter>
					<Filter
						title="Compressor"
						description="Soften loud words and even out your voice."
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
						<p class="text-xs text-ed-text-3">
							Sound above this level is reduced.
						</p>
						<Parameter
							label="Compression"
							value={filters().ratio}
							min={1}
							max={20}
							step={0.5}
							unit=":1"
							onChange={(ratio) => update({ ratio })}
						/>
						<details class="mt-2 text-xs text-ed-text-2">
							<summary class="cursor-pointer py-1">Timing settings</summary>
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
						</details>
					</Filter>
					<Filter
						title="Peak protection"
						description="Limit loud peaks after microphone volume."
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
						<p class="mt-2 text-xs text-ed-text-2">
							Protects the microphone. Clip volume and other tracks can still
							raise final peaks.
						</p>
					</Filter>
				</details>
			</Show>
			<button
				type="button"
				disabled={props.savingDefault}
				onClick={props.onSaveDefault}
				class="mt-3 w-full rounded-lg border border-ed-line py-2 px-3 text-xs text-ed-text-2 hover:bg-ed-ctl disabled:opacity-50 focus-visible:outline focus-visible:outline-ed-accent"
			>
				{props.savingDefault
					? "Saving…"
					: "Use these settings for new recordings"}
			</button>
		</section>
	);
}
