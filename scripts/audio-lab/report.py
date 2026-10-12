import html


def escape(value):
    return html.escape(str(value), quote=True)


def number(value, digits=2):
    return "—" if value is None else f"{value:.{digits}f}"


def waveform(samples):
    import numpy as np

    if not len(samples):
        return ""
    chunks = np.array_split(np.max(np.abs(samples), axis=1), min(320, len(samples)))
    peaks = np.array([float(np.max(part)) for part in chunks])
    peaks /= max(float(np.max(peaks)), 1e-8)
    points = " ".join(
        f"{i * 320 / len(peaks):.1f},{36 - v * 32:.1f}" for i, v in enumerate(peaks)
    )
    return f'<svg viewBox="0 0 320 40" role="img" aria-label="Waveform, independently scaled"><polyline points="{points}" fill="none" stroke="currentColor" stroke-width="1"/></svg>'


def render_catalog(rows):
    cards = "".join(
        f"<article><h2>{escape(row['id'])}</h2><p>{escape(row['description'])}</p>"
        f'{row["waveform"]}<audio controls preload="none" src="{escape(row["audio"])}"></audio>'
        f"<p>{number(row['duration'])} с · RMS {number(row['rmsDbfs'])} dBFS</p></article>"
        for row in rows
    )
    return f"""<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cap · Audio Lab · Fixtures</title>
<style>body{{background:#10131a;color:#e8edf6;font:15px/1.5 system-ui;margin:0}}main{{max-width:1050px;padding:32px 24px;margin:auto}}h1{{font-size:32px}}h2{{font-size:18px}}section{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}}article{{background:#191f2b;border:1px solid #303a50;border-radius:12px;padding:20px}}audio,svg{{width:100%}}svg{{height:55px;color:#7baaff}}p{{color:#b2bfd4}}</style>
<main><h1>Cap Audio Lab · {len(rows)} тестовых примеров</h1><p>Фрагменты предоставленной записи и воспроизводимые варианты. Это входные файлы для стенда; обработка движком ещё не проверена. Исходная запись сохранена.</p><section>{cards}</section></main></html>"""


def render(report):
    cards = []
    for row in report["results"]:
        failures = [check for check in row.get("checks", []) if not check["passed"]]
        failures_html = "".join(
            f"<li>{escape(c['name'])}: {escape(c.get('firstMismatchFrame', 'failed'))}</li>"
            for c in failures
        )
        if row.get("error"):
            failures_html += f"<li>{escape(row['error'])}</li>"
        similarity = row.get("similarity", {})
        metrics = row.get("levels", {})
        controls = ""
        if row.get("audio"):
            controls = f'''<div class="buttons"><button data-src="{escape(row["before"])}" data-rms="{row.get("beforeRms", 0)}">До</button><button data-src="{escape(row["audio"])}" data-rms="{row.get("rms", 0)}">После · PCM экспорта</button></div>
<audio controls preload="none" src="{escape(row["audio"])}"></audio>
<label><input type="checkbox" checked> Сравнивать при одинаковом RMS</label>
<p><a href="{escape(row["audio"])}" download>Скачать WAV</a> · <a href="{escape(row["enginePath"])}">Данные движка</a></p>'''
        cards.append(f'''<article class="{escape(row["status"])}"><div class="title"><h2>{escape(row["case"])} <small>{escape(row["mode"])}</small></h2><b>{escape(row["status"]).upper()}</b></div>
<p class="note">{escape(row.get("description", ""))}</p>{row.get("waveform", "")}
<dl><div><dt>RMS, dBFS</dt><dd>{number(metrics.get("rmsDbfs"))}</dd></div><div><dt>Пик, dBFS</dt><dd>{number(metrics.get("peakDbfs"))}</dd></div><div><dt>Δ STOI</dt><dd>{number(row.get("stoiDelta"), 4)}</dd></div><div><dt>SI-SDR, dB</dt><dd>{number(similarity.get("siSdrDb"))}</dd></div></dl>
<ul class="errors">{failures_html}</ul>{controls}<details><summary>Проверки ({len(row.get("checks", []))})</summary><ul>{"".join(f"<li>{'✓' if c['passed'] else '✗'} {escape(c['name'])}</li>" for c in row.get("checks", []))}</ul></details></article>''')
    summary = report["summary"]
    run_failures = [
        check["name"] for check in report.get("runChecks", []) if not check["passed"]
    ]
    if report.get("error"):
        run_failures.append(report["error"])
    run_status = f'<p class="{escape(report["status"])}"><b>RUN {escape(report["status"]).upper()}</b></p>'
    run_status += (
        '<ul class="errors">'
        + "".join(f"<li>{escape(error)}</li>" for error in run_failures)
        + "</ul>"
    )
    return f"""<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cap · Audio Lab</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#10131a;color:#e8edf6;font:15px/1.5 system-ui,sans-serif}}main{{max-width:1100px;margin:auto;padding:32px 24px}}h1{{font-size:36px;letter-spacing:-1px;margin:8px 0}}h2{{font-size:16px;margin:0}}small,.note,dt{{color:#aab5c9}}small{{display:block;font-weight:400}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}}article{{padding:20px;background:#191f2b;border:1px solid #303a50;border-radius:14px}}.title{{display:flex;justify-content:space-between;gap:12px}}b{{font-size:11px;color:#69dbad}}.failed b,.errors{{color:#ff9292}}.failed{{border-color:#a54553}}.incomplete b{{color:#ffd17b}}dl{{display:flex;justify-content:space-between;gap:8px}}dt{{font-size:11px}}dd{{margin:0;font-variant-numeric:tabular-nums}}audio{{width:100%;margin:12px 0}}button{{background:#303d57;color:inherit;border:1px solid #536689;border-radius:8px;padding:9px 13px;cursor:pointer}}.buttons{{display:flex;gap:8px}}a{{color:#9fc2ff}}label,details{{font-size:12px}}svg{{color:#7baaff;width:100%;height:55px}}header{{margin-bottom:24px}}code{{word-break:break-all}}.banner{{padding:12px 16px;border-left:3px solid #87afff;background:#1b263b;margin:20px 0}}
</style><main><header><small>CAP / LOCAL AUDIO LAB</small><h1>Обработка голоса после записи</h1>{run_status}<p>{summary["passed"]} passed · {summary["failed"]} failed · {summary["incomplete"]} incomplete</p><p class="note">Запуск: <code>{escape(report["runId"])}</code> · {escape(report["suite"])}</p><div class="banner">Проверяется реальный Rust-движок предпросмотра и PCM экспорта. STOI и SI-SDR сравнивают с исходным фрагментом, который сам может содержать шум. Они не доказывают субъективное улучшение голоса. MP4, UI и звуковое устройство этим прогоном не проверяются.</div></header><section class="grid">{"".join(cards)}</section><p><a href="report.json">Полный JSON-отчёт</a> · <a href="engine.log">Лог движка</a></p></main>
<script>
for (const card of document.querySelectorAll("article")) {{
 const audio = card.querySelector("audio"); if (!audio) continue;
 const buttons = [...card.querySelectorAll("button")]; const checkbox = card.querySelector("input");
 let selected = buttons[1];
 const volume = () => {{ const rms = Number(selected.dataset.rms); const target = Math.min(...buttons.map(b => Number(b.dataset.rms))); audio.volume = checkbox.checked && rms > 0 && target > 0 ? Math.min(1, target / rms) : 1; }};
 checkbox.addEventListener("change", volume); volume();
 for (const button of buttons) button.addEventListener("click", () => {{
  const time = audio.currentTime; const playing = !audio.paused; selected = button; audio.pause();
  audio.src = button.dataset.src; audio.addEventListener("loadedmetadata", () => {{ audio.currentTime = Math.min(time, audio.duration); volume(); if (playing) audio.play().catch(() => {{}}); }}, {{once:true}}); audio.load();
 }});
}}
</script></html>"""
