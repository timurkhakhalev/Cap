(() => {
	const fixture = window.__CAP_FIXTURE__;
	const callbacks = new Map();
	const listeners = new Map();
	const unknown = new Set();
	const store = new Map();
	let nextId = 1;
	const FPS = 60;
	let playhead = 0;
	let playbackTimer = null;
	let playbackStartedAt = 0;
	let playbackStartFrame = 0;
	const stopPlayback = () => {
		if (playbackTimer !== null) clearInterval(playbackTimer);
		playbackTimer = null;
	};

	const emit = (event, payload) => {
		for (const [id, name] of listeners) {
			if (name === event) callbacks.get(id)?.({ event, id, payload });
		}
	};

	const handlers = {
		"plugin:event|listen": ({ event, handler }) => {
			listeners.set(handler, event);
			return handler;
		},
		"plugin:event|unlisten": ({ eventId }) => {
			listeners.delete(eventId);
		},
		"plugin:event|emit": ({ event, payload }) => emit(event, payload),
		"plugin:event|emit_to": ({ event, payload }) => emit(event, payload),
		"plugin:store|load": () => 1,
		"plugin:store|get_store": () => 1,
		"plugin:store|get": ({ key }) => [store.get(key) ?? null, store.has(key)],
		"plugin:store|set": ({ key, value }) => {
			if (JSON.stringify(store.get(key)) === JSON.stringify(value)) return;
			store.set(key, value);
			emit("store://change", { resourceId: 1, key, value, exists: true });
		},
		"plugin:store|has": ({ key }) => store.has(key),
		"plugin:store|delete": ({ key }) => store.delete(key),
		"plugin:store|keys": () => [...store.keys()],
		"plugin:store|values": () => [...store.values()],
		"plugin:store|entries": () => [...store.entries()],
		"plugin:store|length": () => store.size,
		"plugin:store|save": () => null,
		"plugin:store|reload": () => null,
		"plugin:store|clear": () => store.clear(),
		"plugin:store|reset": () => store.clear(),
		"plugin:window|inner_size": () => ({ width: 1440, height: 900 }),
		"plugin:window|outer_size": () => ({ width: 1440, height: 900 }),
		"plugin:window|scale_factor": () => window.devicePixelRatio,
		"plugin:window|is_fullscreen": () => false,
		"plugin:window|is_maximized": () => false,
		"plugin:window|is_focused": () => true,
		"plugin:window|is_visible": () => true,
		"plugin:window|theme": () => "dark",
		get_editor_project_path: () => fixture.projectPath,
		get_recording_meta_by_path: () => fixture.meta,
		get_editor_meta: () => fixture.meta,
		create_editor_instance: () => ({
			instanceId: "browser-preview",
			preparingPlayback: false,
			framesSocketUrl: "ws://127.0.0.1:47123",
			preparingSnapshot: null,
			recordingDuration: fixture.duration,
			savedProjectConfig: fixture.config,
			recordings: fixture.recordings,
			path: fixture.projectPath,
		}),
		get_project_config: () => fixture.config,
		set_project_config: ({ config }) => {
			fixture.config = config;
		},
		update_project_config_in_memory: () => null,
		check_import_ready: () => true,
		get_mic_waveforms: () => fixture.micWaveforms,
		get_system_audio_waveforms: () => fixture.systemAudioWaveforms,
		seek_to: ({ frameNumber }) => {
			playhead = frameNumber;
		},
		set_playhead_position: ({ frameNumber }) => {
			playhead = frameNumber;
		},
		start_playback: ({ fps }) => {
			stopPlayback();
			playbackStartedAt = performance.now();
			playbackStartFrame = playhead;
			playbackTimer = setInterval(() => {
				const elapsed = (performance.now() - playbackStartedAt) / 1000;
				const last = Math.floor(fixture.duration * (fps ?? FPS));
				playhead = Math.min(
					playbackStartFrame + Math.floor(elapsed * (fps ?? FPS)),
					last,
				);
				emit("editor-state-changed", { playhead_position: playhead });
				if (playhead >= last) stopPlayback();
			}, 33);
		},
		stop_playback: () => stopPlayback(),
	};

	window.__CAP_MOCK__ = { handlers, unknown, emit, store, fixture };
	window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
		unregisterListener(_event, id) {
			listeners.delete(id);
			callbacks.delete(id);
		},
	};

	window.__TAURI_INTERNALS__ = {
		metadata: {
			currentWindow: { label: "editor-browser-preview" },
			currentWebview: {
				label: "editor-browser-preview",
				windowLabel: "editor-browser-preview",
			},
		},
		plugins: { path: { sep: "/", delimiter: ":" } },
		callbacks,
		transformCallback(callback, once) {
			const id = nextId++;
			callbacks.set(id, (payload) => {
				if (once) callbacks.delete(id);
				return callback?.(payload);
			});
			return id;
		},
		unregisterCallback(id) {
			callbacks.delete(id);
		},
		runCallback(id, payload) {
			callbacks.get(id)?.(payload);
		},
		convertFileSrc(path, protocol = "asset") {
			return `${protocol}://localhost/${encodeURIComponent(path)}`;
		},
		async invoke(cmd, args = {}) {
			const handler = handlers[cmd];
			if (handler) return handler(args);
			if (!unknown.has(cmd)) {
				unknown.add(cmd);
				console.warn("[tauri-mock] unhandled", cmd, args);
			}
			return null;
		},
	};

	window.__TAURI_OS_PLUGIN_INTERNALS__ = {
		os_type: "macos",
		platform: "macos",
		family: "unix",
		arch: "aarch64",
		version: "26.0.0",
		eol: "\n",
		exe_extension: "",
	};
})();
