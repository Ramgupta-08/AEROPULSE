"""Unknown-fault detection.

Known degradation moves sensors along a predictable path as wear accumulates. We model the expected
(rolling-mean) value of every sensor as a function of remaining life, then run an IsolationForest on the
residuals + short-window volatility. Behaviour far from the learned path — e.g. a sensor drifting on its own
or turning noisy — is flagged as "unusual behaviour that doesn't match known degradation".
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.cmapss import SENSOR_NAMES


def fit_expectation(feats: pd.DataFrame, rul: np.ndarray, sensors: list[str]) -> dict:
    out = {}
    for s in sensors:
        y = feats[f"{s}_mean10"].to_numpy()
        coef = np.polyfit(rul, y, 3)
        resid = y - np.polyval(coef, rul)
        out[s] = {
            "coef": coef.tolist(),
            "resid_std": float(resid.std() + 1e-9),
            "std10_med": float(np.median(feats[f"{s}_std10"]) + 1e-9),
        }
    return out


def anomaly_features(feats: pd.DataFrame, rul: np.ndarray, sensors: list[str], expect: dict) -> np.ndarray:
    """Per-window summary that is invariant to which sensor misbehaves: the three largest |residual z|,
    the three largest log-volatility ratios, and their means across sensors."""
    zs, vols = [], []
    for s in sensors:
        e = expect[s]
        zs.append(np.abs((feats[f"{s}_mean10"].to_numpy() - np.polyval(e["coef"], rul)) / e["resid_std"]))
        vols.append(np.log((feats[f"{s}_std10"].to_numpy() + 1e-9) / e["std10_med"]))
    z = np.sort(np.column_stack(zs), axis=1)[:, ::-1]
    v = np.sort(np.column_stack(vols), axis=1)[:, ::-1]
    return np.column_stack([z[:, :3], v[:, :3], z.mean(axis=1), v.mean(axis=1)])


def explain_row(row: pd.Series, rul: float, sensors: list[str], expect: dict, top: int = 3) -> list[dict]:
    """Sensors most responsible for the deviation (largest |residual z| or volatility jump)."""
    items = []
    for s in sensors:
        e = expect[s]
        z = (row[f"{s}_mean10"] - np.polyval(e["coef"], rul)) / e["resid_std"]
        vol = row[f"{s}_std10"] / e["std10_med"]
        score = max(abs(z), vol / 1.5)
        kind = "drift" if abs(z) >= vol / 1.5 else "noise"
        items.append(
            {
                "sensor": s,
                "name": SENSOR_NAMES[s],
                "z": round(float(z), 2),
                "volatility_ratio": round(float(vol), 2),
                "kind": kind,
                "score": float(score),
            }
        )
    items.sort(key=lambda d: d["score"], reverse=True)
    return [{k: v for k, v in d.items() if k != "score"} for d in items[:top]]


# ---------------------------------------------------------------- serving
_models: dict[str, dict] = {}


def _model(dataset: str) -> dict | None:
    from app.core.config import ARTIFACTS_DIR

    if dataset not in _models:
        p = ARTIFACTS_DIR / f"anomaly_{dataset}.joblib"
        if not p.exists():
            return None
        import joblib

        _models[dataset] = joblib.load(p)
    return _models[dataset]


_scores: dict[tuple, dict | None] = {}


def score_engine(track, p50: float) -> dict | None:
    """IsolationForest score for the latest window of an engine track (cached per track state)."""
    key = (track.dataset, track.unit, len(track.raw), round(float(track.raw.iloc[-1].sum()), 4), round(p50, 1))
    if key not in _scores:
        _scores[key] = _score(track, p50)
    return _scores[key]


def _score(track, p50: float) -> dict | None:
    m = _model(track.dataset)
    if m is None:
        return None
    from app.ml.features import RUL_CAP

    rul = np.array([min(p50, RUL_CAP)])
    row = track.feats.iloc[[-1]]
    x = anomaly_features(row, rul, m["sensors"], m["expect"])
    score = float(m["iso"].score_samples(x)[0])
    flagged = score < m["threshold"]
    return {
        "score": round(score, 4),
        "threshold": round(float(m["threshold"]), 4),
        "flagged": bool(flagged),
        "sensors": explain_row(track.feats.iloc[-1], float(rul[0]), m["sensors"], m["expect"]),
    }
