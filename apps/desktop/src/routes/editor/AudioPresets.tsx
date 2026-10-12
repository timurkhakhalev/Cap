import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { cx } from "cva";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { studioSoundFilters } from "~/utils/audio-filter-settings";
import { type AudioPreset, matchesAudioPreset } from "~/utils/audio-presets";
import type { AudioConfiguration } from "~/utils/tauri";

export const STUDIO_SOUND_ID = "studio-sound";

function isStudioSound(audio: AudioConfiguration) {
	return (
		audio.isolation === "balanced" &&
		(
			Object.keys(studioSoundFilters) as (keyof typeof studioSoundFilters)[]
		).every((key) => {
			const a = audio.filters[key];
			const b = studioSoundFilters[key];
			return typeof a === "number" && typeof b === "number"
				? Math.abs(a - b) < 0.001
				: a === b;
		})
	);
}

const chip =
	"flex items-center h-6 rounded-full border text-xs transition-colors focus-visible:outline focus-visible:outline-ed-accent disabled:opacity-50";

export function AudioPresets(props: {
	audio: AudioConfiguration;
	presets: AudioPreset[];
	loading: boolean;
	onApply(preset: AudioPreset): void;
	onApplyStudioSound(): void;
	onSave(name: string): Promise<void>;
	onDelete(id: string): Promise<void>;
	onSaveDefault(): void;
	savingDefault: boolean;
}) {
	const id = createUniqueId();
	const [naming, setNaming] = createSignal(false);
	const [name, setName] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const [selectedId, setSelectedId] = createSignal<string>();
	const [menuOpen, setMenuOpen] = createSignal(false);
	let nameInput: HTMLInputElement | undefined;
	const selected = () => {
		const explicit = props.presets.find(
			(preset) =>
				preset.id === selectedId() && matchesAudioPreset(props.audio, preset),
		);
		if (explicit) return explicit.id;
		if (selectedId() === STUDIO_SOUND_ID && isStudioSound(props.audio))
			return STUDIO_SOUND_ID;
		return (
			props.presets.find((preset) => matchesAudioPreset(props.audio, preset))
				?.id ?? (isStudioSound(props.audio) ? STUDIO_SOUND_ID : undefined)
		);
	};
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
	const remove = async (preset: AudioPreset) => {
		setBusy(true);
		setError("");
		try {
			await props.onDelete(preset.id);
		} catch {
			setError("Could not delete the preset. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const chipState = (active: boolean) =>
		active
			? "border-ed-accent bg-ed-accent/15 text-ed-text-1"
			: "border-ed-line text-ed-text-2 hover:bg-ed-ctl hover:text-ed-text-1";
	return (
		<div class="mt-3 text-xs text-ed-text-2">
			<div class="flex justify-between items-center mb-1.5">
				<span id={`${id}-label`}>Preset</span>
				<Show when={props.loading}>
					<span class="text-ed-text-3">Loading…</span>
				</Show>
				<DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
					<DropdownMenu.Trigger
						aria-label="Audio preset actions"
						class="px-2 py-1 rounded text-ed-text-2 hover:bg-ed-ctl"
						disabled={props.loading || busy()}
					>
						•••
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							onCloseAutoFocus={(event) => {
								if (naming()) {
									event.preventDefault();
									queueMicrotask(() => nameInput?.focus());
								}
							}}
							class="z-50 min-w-44 p-1 rounded-lg border border-ed-line bg-ed-card text-xs text-ed-text-1 shadow-lg"
						>
							<DropdownMenu.Item
								class="px-3 py-2 rounded outline-none data-highlighted:bg-ed-ctl"
								onSelect={() => {
									setNaming(true);
									setError("");
									setMenuOpen(false);
								}}
							>
								Save as preset…
							</DropdownMenu.Item>
							<DropdownMenu.Item
								class="px-3 py-2 rounded outline-none data-highlighted:bg-ed-ctl"
								disabled={props.savingDefault}
								onSelect={props.onSaveDefault}
							>
								{props.savingDefault
									? "Saving…"
									: "Use these settings for new recordings"}
							</DropdownMenu.Item>
							<Show
								when={props.presets.find((preset) => preset.id === selected())}
							>
								{(preset) => (
									<DropdownMenu.Item
										class="px-3 py-2 rounded outline-none data-highlighted:bg-ed-ctl"
										onSelect={() => void remove(preset())}
									>
										Delete preset {preset().name}
									</DropdownMenu.Item>
								)}
							</Show>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu>
			</div>
			<div
				role="group"
				aria-labelledby={`${id}-label`}
				class="flex flex-wrap gap-1.5"
			>
				<button
					type="button"
					aria-pressed={selected() === STUDIO_SOUND_ID}
					class={cx(chip, "px-2.5", chipState(selected() === STUDIO_SOUND_ID))}
					disabled={busy()}
					onClick={() => {
						setSelectedId(STUDIO_SOUND_ID);
						props.onApplyStudioSound();
					}}
				>
					Studio Sound
				</button>
				<For each={props.presets}>
					{(preset) => (
						<span
							class={cx(
								chip,
								"group overflow-hidden",
								chipState(selected() === preset.id),
							)}
						>
							<button
								type="button"
								aria-pressed={selected() === preset.id}
								class="px-2.5 h-full max-w-64 truncate disabled:opacity-50"
								disabled={busy()}
								onClick={() => {
									setSelectedId(preset.id);
									props.onApply(preset);
								}}
							>
								{preset.name}
							</button>
						</span>
					)}
				</For>
				<Show when={!selected()}>
					<span
						aria-current="true"
						class={cx(
							chip,
							"px-2.5 border-dashed border-ed-text-3 text-ed-text-1",
						)}
					>
						Custom
					</span>
					<button
						type="button"
						class="px-1 text-ed-accent hover:underline"
						disabled={busy()}
						onClick={() => {
							const preset = props.presets.find(
								(item) => item.id === selectedId(),
							);
							if (preset) props.onApply(preset);
							else props.onApplyStudioSound();
						}}
					>
						Revert
					</button>
				</Show>
			</div>
			<Show when={naming()}>
				<form
					class="flex gap-1.5 items-center mt-2"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<input
						id={`${id}-name`}
						aria-label="Preset name"
						placeholder="Preset name"
						ref={nameInput}
						required
						maxLength={60}
						disabled={busy()}
						value={name()}
						onInput={(event) => setName(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setNaming(false);
								setError("");
							}
						}}
						class="flex-1 px-2 py-1 min-w-0 rounded-md bg-ed-ctl text-ed-text-1 focus-visible:outline focus-visible:outline-ed-accent"
					/>
					<button
						type="submit"
						disabled={busy() || !name().trim()}
						class="px-2 py-1 font-medium rounded-md text-ed-accent hover:bg-ed-ctl disabled:opacity-50"
					>
						{busy() ? "Saving…" : "Save"}
					</button>
					<button
						type="button"
						disabled={busy()}
						class="px-2 py-1 rounded-md hover:bg-ed-ctl"
						onClick={() => {
							setNaming(false);
							setError("");
						}}
					>
						Cancel
					</button>
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
