import { A, type RouteSectionProps } from "@solidjs/router";
import { getVersion } from "@tauri-apps/api/app";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createResource, For, Show, Suspense } from "solid-js";
import { CapErrorBoundary } from "~/components/CapErrorBoundary";

const settingsItems = [
	{ href: "general", name: "General", icon: IconCapSettings },
	{
		href: "quality",
		name: "Recording quality",
		icon: IconLucideSlidersHorizontal,
	},
	{ href: "hotkeys", name: "Shortcuts", icon: IconCapHotkeys },
	{ href: "cli", name: "CLI", icon: IconLucideTerminal },
	{ href: "recordings", name: "Recordings", icon: IconLucideSquarePlay },
	{ href: "screenshots", name: "Screenshots", icon: IconLucideImage },
	{ href: "automations", name: "Automations", icon: IconLucideZap },
	{ href: "transcription", name: "Transcription", icon: IconCapCaptions },
	{ href: "experimental", name: "Experimental", icon: IconCapSettings },
	{ href: "license", name: "About Cap Local", icon: IconLucideInfo },
];

export default function Settings(props: RouteSectionProps) {
	const [version] = createResource(getVersion);
	return (
		<div class="cap-settings-shell flex-1 flex flex-row divide-x divide-gray-3 text-[0.875rem] leading-5 overflow-y-hidden">
			<div
				class="cap-settings-sidebar flex flex-col h-full bg-gray-2"
				data-tauri-drag-region
			>
				<div class="cap-settings-window-spacer" data-tauri-drag-region />
				<div class="mx-4 mt-4 mb-3">
					<p class="text-[13px] text-gray-12">Cap Local</p>
					<p class="text-[11px] text-gray-10">All local features available</p>
				</div>
				<ul class="cap-settings-nav min-w-48 h-full p-2.5 space-y-1 text-gray-12">
					<For each={settingsItems}>
						{(item) => (
							<li>
								<A
									href={item.href}
									activeClass="bg-gray-5 pointer-events-none"
									class="cap-settings-nav-item rounded-lg h-8 hover:bg-gray-3 text-[13px] px-2 flex flex-row items-center gap-1.5 transition-colors"
								>
									<item.icon class="opacity-60 size-4" aria-hidden="true" />
									<span>{item.name}</span>
								</A>
							</li>
						)}
					</For>
				</ul>
				<Show when={version()}>
					{(value) => (
						<button
							type="button"
							class="p-3 text-left text-xs text-gray-11"
							title="Copy version"
							onClick={() => void writeText(`Cap Local ${value()}`)}
						>
							v{value()}
						</button>
					)}
				</Show>
			</div>
			<div class="cap-settings-content overflow-y-hidden flex-1 min-w-0">
				<CapErrorBoundary>
					<Suspense>{props.children}</Suspense>
				</CapErrorBoundary>
			</div>
		</div>
	);
}
