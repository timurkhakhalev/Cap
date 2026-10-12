import { createSignal, createUniqueId, For, Show } from "solid-js";
import { type AudioPreset, matchesAudioPreset } from "~/utils/audio-presets";
import type { AudioConfiguration } from "~/utils/tauri";

export function AudioPresets(props: {
	audio: AudioConfiguration;
	presets: AudioPreset[];
	loading: boolean;
	onApply(preset: AudioPreset): void;
	onSave(name: string): Promise<void>;
	onDelete(id: string): Promise<void>;
}) {
	const id = createUniqueId();
	const [naming, setNaming] = createSignal(false);
	const [name, setName] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const [selectedId, setSelectedId] = createSignal<string>();
	const selected = () =>
		props.presets.find(
			(preset) =>
				preset.id === selectedId() && matchesAudioPreset(props.audio, preset),
		) ??
		props.presets.find((preset) => matchesAudioPreset(props.audio, preset));
	const save = async () => {
		const trimmed = name().trim();
		if (!trimmed || busy()) return;
		if (
			props.presets.some(
				(preset) =>
					preset.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
			)
		) {
			setError("That name is already used. Choose another name.");
			return;
		}
		setBusy(true);
		setError("");
		try {
			await props.onSave(trimmed);
			setSelectedId(
				props.presets.find((preset) => preset.name === trimmed)?.id,
			);
			setNaming(false);
			setName("");
		} catch {
			setError("Could not save the preset. Try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div class="mt-3 text-xs text-ed-text-2">
			<label for={id} class="block mb-1.5">
				Audio preset
			</label>
			<select
				id={id}
				class="w-full rounded-lg bg-ed-ctl px-2 py-2 text-ed-text-1"
				disabled={props.loading || busy()}
				value={selected()?.id ?? ""}
				onChange={(event) => {
					const preset = props.presets.find(
						(item) => item.id === event.currentTarget.value,
					);
					if (preset) {
						setSelectedId(preset.id);
						props.onApply(preset);
					}
				}}
			>
				<option value="" disabled>
					{props.loading ? "Loading presets…" : "Custom settings"}
				</option>
				<For each={props.presets}>
					{(preset) => <option value={preset.id}>{preset.name}</option>}
				</For>
			</select>
			<div class="mt-2 flex gap-3">
				<button
					type="button"
					class="text-ed-accent hover:underline disabled:opacity-50"
					disabled={props.loading || busy()}
					onClick={() => {
						setNaming(true);
						setError("");
					}}
				>
					Save as preset…
				</button>
				<Show when={selected()}>
					{(preset) => (
						<button
							type="button"
							class="hover:underline disabled:opacity-50"
							disabled={busy()}
							onClick={async () => {
								setBusy(true);
								setError("");
								try {
									await props.onDelete(preset().id);
								} catch {
									setError("Could not delete the preset. Try again.");
								} finally {
									setBusy(false);
								}
							}}
						>
							Delete preset
						</button>
					)}
				</Show>
			</div>
			<Show when={naming()}>
				<form
					class="mt-3"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<label for={`${id}-name`} class="block mb-1.5">
						Preset name
					</label>
					<input
						id={`${id}-name`}
						autofocus
						required
						maxLength={60}
						disabled={busy()}
						value={name()}
						onInput={(event) => setName(event.currentTarget.value)}
						class="w-full rounded-lg bg-ed-ctl px-2 py-2 text-ed-text-1"
					/>
					<div class="mt-2 flex gap-3">
						<button
							type="submit"
							disabled={busy() || !name().trim()}
							class="text-ed-accent disabled:opacity-50"
						>
							{busy() ? "Saving…" : "Save preset"}
						</button>
						<button
							type="button"
							disabled={busy()}
							onClick={() => {
								setNaming(false);
								setError("");
							}}
						>
							Cancel
						</button>
					</div>
				</form>
			</Show>
			<Show when={error()}>
				<p role="alert" class="mt-2">
					{error()}
				</p>
			</Show>
		</div>
	);
}
