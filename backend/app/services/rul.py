"""Engine RUL serving: quantile predictions over each engine's history, SHAP reasons in plain English."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from app.core.config import ARTIFACTS_DIR
from app.ml import cmapss
from app.ml.features import build_features, predict_quantiles

_lock = threading.Lock()


@lru_cache(maxsize=8)
def bundle(dataset: str) -> dict:
    return joblib.load(ARTIFACTS_DIR / f"rul_{dataset}.joblib")


def models_ready() -> bool:
    return (ARTIFACTS_DIR / "rul_FD001.joblib").exists()


@dataclass
class EngineTrack:
    dataset: str
    unit: int
    raw: pd.DataFrame  # raw sensor history (after any planted injection)
    feats: pd.DataFrame
    pred: pd.DataFrame  # cycle, p10, p50, p90 per cycle


def _apply_injection(raw: pd.DataFrame, injection: dict | None, pre) -> pd.DataFrame:
    """Planted unknown faults (seed only): drift or noise on chosen sensors over the last N cycles."""
    if not injection:
        return raw
    raw = raw.copy()
    rng = np.random.default_rng(int(raw["unit"].iloc[0]) * 7919)
    n = len(raw)
    for s, spec in injection.items():
        if s not in pre.sensors:
            continue
        idx = pre.sensors.index(s)
        sd = float(pre.std[0][idx])
        start = max(0, n - int(spec["cycles"]))
        k = np.arange(n - start)
        if spec["kind"] == "drift":
            delta = spec["sigma"] * sd * (k + 1) / len(k)
        else:
            delta = rng.normal(0, spec["sigma"] * sd, len(k))
        raw.loc[raw.index[start:], s] = raw[s].to_numpy()[start:] + delta
    return raw


_tracks: dict[tuple, EngineTrack] = {}


def track(dataset: str, unit: int, injection: dict | None = None, split: str = "test") -> EngineTrack:
    key = (dataset, unit, split, repr(sorted((injection or {}).items())))
    with _lock:
        if key in _tracks:
            return _tracks[key]
    b = bundle(dataset)
    pre = b["pre"]
    df = cmapss.load(dataset, split)
    raw = df[df["unit"] == unit].sort_values("cycle").reset_index(drop=True)
    raw = _apply_injection(raw, injection, pre)
    feats = build_features(pre.normalise(raw), pre.sensors).reset_index(drop=True)
    x = feats[b["columns"]]
    p = predict_quantiles(b["models"], x, b.get("cqr", 0.0))
    pred = pd.DataFrame({"cycle": feats["cycle"], "p10": p[0], "p50": p[1], "p90": p[2]})
    t = EngineTrack(dataset, unit, raw, feats, pred)
    with _lock:
        _tracks[key] = t
    return t


def predict_at(t: EngineTrack, cycle: int | None = None) -> dict:
    row = t.pred.iloc[-1] if cycle is None else t.pred.iloc[int(np.clip(cycle - 1, 0, len(t.pred) - 1))]
    return {"cycle": int(row["cycle"]), "p10": float(row["p10"]), "p50": float(row["p50"]), "p90": float(row["p90"])}


@lru_cache(maxsize=4)
def _explainer(dataset: str):
    import shap

    return shap.TreeExplainer(bundle(dataset)["models"]["p50"].model)


_reason_cache: dict[tuple, list[dict]] = {}


def reasons(t: EngineTrack, top: int = 5) -> list[dict]:
    """SHAP top drivers (pushing RUL down) for the latest cycle, in plain English."""
    key = (t.dataset, t.unit, len(t.raw), float(t.raw.iloc[-1][cmapss.SENSORS].sum()))
    if key in _reason_cache:
        return _reason_cache[key]
    b = bundle(t.dataset)
    cols = b["columns"]
    ref = b["reference"]
    row = t.feats[cols].iloc[[-1]]
    sv = _explainer(t.dataset).shap_values(row)[0]
    contrib: dict[str, float] = {}
    for c, v in zip(cols, sv, strict=True):
        key_s = c.split("_")[0]
        contrib[key_s] = contrib.get(key_s, 0.0) + float(v)
    ordered = sorted(contrib.items(), key=lambda kv: kv[1])  # most negative (life-reducing) first
    out = []
    r = t.feats.iloc[-1]
    for s, impact in ordered:
        if impact >= -0.5 or len(out) >= top:
            break
        if s == "cycle":
            out.append(
                {
                    "sensor": "cycle",
                    "name": "Time since overhaul",
                    "text": f"{int(r['cycle'])} sorties since last engine overhaul — high accumulated wear",
                    "impact": round(impact, 1),
                    "evidence": {"cycles": int(r["cycle"])},
                }
            )
            continue
        name = cmapss.SENSOR_NAMES[s]
        slope = float(r[f"{s}_slope20"])
        ratio = abs(slope) / ref["slope_scale"][s]
        level = (float(r[f"{s}_mean10"]) - ref["healthy_mean"][s]) / ref["sensor_std"][s]
        if ratio >= 1.5:
            text = f"{name} {'rising' if slope > 0 else 'falling'} {ratio:.1f}× faster than fleet average"
        else:
            text = f"{name} {abs(level):.1f}σ {'above' if level > 0 else 'below'} healthy baseline"
        out.append(
            {
                "sensor": s,
                "name": name,
                "text": text,
                "impact": round(impact, 1),
                "evidence": {"trend_ratio": round(ratio, 2), "level_sigma": round(level, 2)},
            }
        )
    _reason_cache[key] = out
    return out
