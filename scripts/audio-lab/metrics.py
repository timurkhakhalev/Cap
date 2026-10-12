import math
import warnings

import numpy as np
from pystoi import stoi
from scipy.signal import resample_poly

RATE = 48_000


def db(value):
    return float(20 * math.log10(value)) if value > 0 else None


def rms(samples):
    return (
        float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
        if samples.size
        else 0.0
    )


def mono(samples):
    return samples.mean(axis=1) if samples.ndim == 2 else samples


def levels(samples):
    finite = bool(np.isfinite(samples).all())
    return {
        "finite": finite,
        "frames": len(samples),
        "rmsDbfs": db(rms(samples)) if finite else None,
        "peakDbfs": db(float(np.max(np.abs(samples))))
        if finite and samples.size
        else None,
        "clippedSamples": int(np.count_nonzero(np.abs(samples) >= 1)),
    }


def similarity(reference, output):
    a, b = mono(reference).astype(np.float64), mono(output).astype(np.float64)
    if len(a) != len(b) or len(a) < RATE or not np.isfinite(b).all() or rms(a) < 1e-7:
        return {
            "status": "unavailable",
            "reason": "Requires finite, equal-length non-silent audio of at least one second",
        }
    projection = np.dot(a, b) / max(np.dot(a, a), 1e-20) * a
    si_sdr = 10 * np.log10(
        max(np.dot(projection, projection), 1e-20)
        / max(np.sum((b - projection) ** 2), 1e-20)
    )
    with warnings.catch_warnings(record=True) as notices:
        warnings.simplefilter("always", RuntimeWarning)
        intelligibility = float(
            stoi(resample_poly(a, 1, 3), resample_poly(b, 1, 3), 16_000)
        )
    if not math.isfinite(intelligibility) or not math.isfinite(si_sdr):
        return {"status": "unavailable", "reason": "Non-finite quality metric"}
    return {
        "status": "measured",
        "stoi": intelligibility,
        "siSdrDb": float(si_sdr),
        "alignment": "none; timing is tested separately",
        "numericalWarnings": sorted({str(notice.message) for notice in notices}),
    }


def signal_checks(source, output, bypass, kind, enhanced, require_change=True):
    checks = [
        {"name": "output-duration", "passed": len(source) == len(output)},
        {"name": "finite-output", "passed": bool(np.isfinite(output).all())},
        {
            "name": "sample-peak",
            "passed": bool(
                np.isfinite(output).all() and np.max(np.abs(output), initial=0) < 1
            ),
        },
    ]
    if kind == "silence":
        checks.append({"name": "silence-remains-silent", "passed": rms(output) < 1e-8})
    elif kind not in ("short", "impulse"):
        checks.append({"name": "not-silenced", "passed": rms(output) > 1e-6})
    if not enhanced:
        expected = (
            np.repeat(source * np.float32(0.707), 2, axis=1)
            if source.shape[1] == 1
            else source
        )
        checks.append(
            {
                "name": "bypass-identity",
                "passed": output.shape == expected.shape
                and bool(np.allclose(output, expected, atol=1e-6, rtol=0)),
            }
        )
    elif require_change and kind not in ("silence", "short", "impulse"):
        checks.append(
            {
                "name": "processing-active",
                "passed": output.shape == bypass.shape
                and bool(np.max(np.abs(output - bypass), initial=0) > 1e-6),
            }
        )
    if kind == "impulse" and not enhanced:
        checks.append(
            {
                "name": "impulse-timing",
                "passed": int(np.argmax(np.abs(mono(source))))
                == int(np.argmax(np.abs(mono(output)))),
            }
        )
    return checks
