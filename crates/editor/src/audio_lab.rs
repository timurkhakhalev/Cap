use super::{ExportAudioRenderer, ExportAudioSources, ExportAudioTrack};
use crate::{AudioRenderer, AudioSegment, audio::AudioSegmentTrack};
use cap_audio::{AudioData, StereoMode, cast_f32_slice_to_bytes};
use cap_project::{AudioConfiguration, ProjectConfiguration};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
    time::Instant,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Job {
    id: String,
    input: PathBuf,
    output: PathBuf,
    audio: AudioConfiguration,
    timeline: Option<cap_project::TimelineConfiguration>,
}

fn preview(data: &Arc<AudioData>) -> AudioRenderer {
    AudioRenderer::new(vec![AudioSegment {
        tracks: vec![
            AudioSegmentTrack::new(
                data.clone(),
                |config| config.mic_volume_db,
                |config| match config.mic_stereo_mode {
                    cap_project::StereoMode::Stereo => StereoMode::Stereo,
                    cap_project::StereoMode::MonoL => StereoMode::MonoL,
                    cap_project::StereoMode::MonoR => StereoMode::MonoR,
                },
                |offsets| offsets.mic,
            )
            .with_microphone_enhancement(),
        ],
    }])
}

fn export(path: &Path) -> Result<ExportAudioRenderer, Box<dyn Error>> {
    let cancellation = Arc::new(AtomicBool::new(false));
    Ok(ExportAudioRenderer {
        renderer: AudioRenderer::new(Vec::new()),
        sources: ExportAudioSources {
            tracks: vec![vec![ExportAudioTrack::open(
                path,
                0,
                true,
                0.0,
                &cancellation,
                &cancellation,
            )?]],
            cancellation: cancellation.clone(),
            abort: cancellation,
        },
        failure: None,
    })
}

fn render(
    renderer: &mut AudioRenderer,
    project: &ProjectConfiguration,
    requests: &[usize],
    expected_frames: usize,
) -> Result<Vec<f32>, Box<dyn Error>> {
    let mut samples = Vec::new();
    let mut request = 0;
    while let Some((frames, block)) =
        renderer.render_frame_raw(requests[request % requests.len()], project)
    {
        if frames == 0 || samples.len() / 2 + frames > expected_frames {
            return Err("Preview produced an empty or unbounded block".into());
        }
        samples.extend(block);
        request += 1;
    }
    Ok(samples)
}

fn comparison(name: &str, actual: &[f32], expected: &[f32]) -> Value {
    let first = actual
        .iter()
        .zip(expected)
        .position(|(a, b)| !a.is_finite() || !b.is_finite() || (a - b).abs() > 1e-6)
        .or_else(|| (actual.len() != expected.len()).then_some(actual.len().min(expected.len())));
    let max_error = actual
        .iter()
        .zip(expected)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0_f32, f32::max);
    json!({
        "name": name,
        "passed": first.is_none(),
        "firstMismatchFrame": first.map(|index| index / 2),
        "maxAbsoluteError": max_error,
        "actualFrames": actual.len() / 2,
        "expectedFrames": expected.len() / 2,
    })
}

fn write_pcm(path: &Path, samples: &[f32]) -> Result<(), Box<dyn Error>> {
    fs::write(path, unsafe { cast_f32_slice_to_bytes(samples) })?;
    Ok(())
}

fn run(job: &Job) -> Result<Value, Box<dyn Error>> {
    fs::create_dir_all(&job.output)?;
    let started = Instant::now();
    let data = Arc::new(AudioData::from_file(&job.input)?);
    let frames = job
        .timeline
        .as_ref()
        .map_or(data.sample_count(), |timeline| {
            (timeline.duration() * 48_000.0).round() as usize
        });
    let project = ProjectConfiguration {
        audio: job.audio.clone(),
        timeline: job.timeline.clone(),
        ..Default::default()
    };
    let mut renderer = preview(&data);
    let pcm = render(&mut renderer, &project, &[4096], frames)?;
    let preview_seconds = started.elapsed().as_secs_f64();
    write_pcm(&job.output.join("preview.f32"), &pcm)?;

    let started = Instant::now();
    let mut renderer = export(&job.input)?;
    let mut exported = Vec::new();
    let mut peak_source_bytes = 0;
    let streaming = ExportAudioRenderer::eligible_sources(&project, 1);
    if streaming {
        loop {
            let written = renderer.render_chunks(4096, &project, |_, block| {
                exported.extend_from_slice(block);
                Ok(())
            })?;
            peak_source_bytes = peak_source_bytes
                .max(renderer.sources.tracks[0][0].samples.capacity() * size_of::<f32>());
            if exported.len() / 2 > frames || written == Some(0) {
                return Err("Export produced an empty or unbounded block".into());
            }
            if written.is_none() {
                break;
            }
        }
        renderer.validate_to_end()?;
    } else {
        exported = render(&mut preview(&data), &project, &[4800], frames)?;
    }
    let export_seconds = started.elapsed().as_secs_f64();
    write_pcm(&job.output.join("export.f32"), &exported)?;

    let irregular = render(
        &mut preview(&data),
        &project,
        &[1, 479, 481, 4096, 997],
        frames,
    )?;
    let mut checks = vec![
        json!({"name": "frame-count", "passed": pcm.len() == frames * 2, "actualFrames": pcm.len() / 2, "expectedFrames": frames}),
        json!({"name": "finite-samples", "passed": pcm.iter().chain(&exported).all(|v| v.is_finite())}),
        comparison("preview-export", &pcm, &exported),
        comparison("chunk-boundaries", &irregular, &pcm),
    ];
    let mut seek_renderer = preview(&data);
    for start in [frames * 3 / 4, 0, frames / 3] {
        let seconds = start as f64 / 48_000.0;
        seek_renderer.set_playhead(seconds, &project);
        let mut fresh = preview(&data);
        fresh.set_playhead(seconds, &project);
        let count = 4096.min(frames.saturating_sub(start));
        let actual = seek_renderer
            .render_frame_raw(count, &project)
            .unwrap_or_default()
            .1;
        let expected = fresh
            .render_frame_raw(count, &project)
            .unwrap_or_default()
            .1;
        let mut check = comparison("seek-reinitialization", &actual, &expected);
        check["sourceFrame"] = json!(start);
        checks.push(check);
    }
    Ok(json!({
        "id": job.id,
        "status": if checks.iter().all(|c| c["passed"] == true) { "passed" } else { "failed" },
        "checks": checks,
        "frames": frames,
        "inputChannels": data.channels(),
        "outputChannels": 2,
        "sampleRate": 48_000,
        "previewSeconds": preview_seconds,
        "exportSeconds": export_seconds,
        "peakSourceBufferBytes": peak_source_bytes,
        "exportPath": if streaming { "streaming" } else { "buffered" },
        "audio": project.audio,
    }))
}

#[test]
#[ignore = "run with bun run audio:lab check; requires a prepared local fixture corpus"]
fn render_fixtures() -> Result<(), Box<dyn Error>> {
    ffmpeg::init()?;
    ffmpeg::log::set_level(ffmpeg::log::Level::Error);
    let manifest = PathBuf::from(
        std::env::var_os("CAP_AUDIO_LAB_JOBS").ok_or("CAP_AUDIO_LAB_JOBS is required")?,
    );
    let jobs: Vec<Job> = serde_json::from_slice(&fs::read(&manifest)?)?;
    if jobs.is_empty() {
        return Err("Audio lab selected zero jobs".into());
    }
    let mut failed = 0;
    for job in jobs {
        fs::create_dir_all(&job.output)?;
        let result = run(&job).unwrap_or_else(|error| {
            json!({
                "id": job.id, "status": "failed", "error": error.to_string(),
            })
        });
        if result["status"] != "passed" {
            failed += 1;
        }
        fs::write(
            job.output.join("engine.json"),
            serde_json::to_vec_pretty(&result)?,
        )?;
        eprintln!("audio-lab {}: {}", job.id, result["status"]);
    }
    if failed > 0 {
        return Err(format!(
            "{failed} audio lab jobs failed; inspect engine.json in the run directory"
        )
        .into());
    }
    Ok(())
}
