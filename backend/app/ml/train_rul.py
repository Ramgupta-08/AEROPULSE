"""Train LightGBM quantile RUL models (P10/P50/P90) + IsolationForest anomaly detector.

Usage:  python -m app.ml.train_rul
Writes: app/ml/artifacts/{rul_FD00x.joblib, anomaly.joblib, metrics.json}
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import GroupKFold

from app.core.config import ARTIFACTS_DIR
from app.ml import cmapss
from app.ml.features import (
    RUL_CAP,
    OffsetModel,
    add_rul,
    build_features,
    feature_columns,
    fit_preprocessor,
    nasa_score,
    predict_quantiles,
)

log = logging.getLogger("train")
QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}
N_CONDITIONS = {"FD001": 1, "FD002": 6, "FD003": 1, "FD004": 6}
PARAMS = dict(
    n_estimators=700,
    learning_rate=0.03,
    num_leaves=24,
    min_child_samples=60,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.5,
    reg_lambda=1.0,
    verbose=-1,
)


def _fit(alpha: float, x: pd.DataFrame, y: np.ndarray, seed: int = 0) -> OffsetModel:
    offset = float(np.mean(y))
    m = lgb.LGBMRegressor(objective="quantile", alpha=alpha, random_state=seed, **PARAMS)
    m.fit(x, y, init_score=np.full(len(y), offset))
    return OffsetModel(m, offset)


def _metrics(y: np.ndarray, p10: np.ndarray, p50: np.ndarray, p90: np.ndarray) -> dict:
    err = p50 - y
    return {
        "rmse": round(float(np.sqrt(np.mean(err**2))), 2),
        "mae": round(float(np.mean(np.abs(err))), 2),
        "nasa_score": round(nasa_score(y, p50), 1),
        "interval_coverage": round(float(np.mean((y >= p10) & (y <= p90))), 3),
        "mean_interval_width": round(float(np.mean(p90 - p10)), 1),
        "n": int(len(y)),
    }


def train_dataset(ds: str, cv_folds: int = 5) -> dict:
    t0 = time.time()
    train = cmapss.load(ds, "train")
    test = cmapss.load(ds, "test")
    true_rul = cmapss.load_rul(ds)

    pre = fit_preprocessor(train, N_CONDITIONS[ds])
    cols = feature_columns(pre.sensors)
    ftr = build_features(pre.normalise(train), pre.sensors)
    y = add_rul(train).to_numpy()
    groups = train["unit"].to_numpy()

    # Cross-validation grouped by engine unit (no unit appears in both train and validation folds).
    oof = {k: np.zeros(len(ftr)) for k in QUANTILES}
    for tr, va in GroupKFold(n_splits=cv_folds).split(ftr, y, groups):
        for k, a in QUANTILES.items():
            oof[k][va] = _fit(a, ftr.iloc[tr][cols], y[tr]).predict(ftr.iloc[va][cols])
    lo, mid, hi = np.sort(np.vstack([oof["p10"], oof["p50"], oof["p90"]]), axis=0)
    # Conformalised quantile regression: widen [P10, P90] by the CV conformity quantile so the band
    # reaches its nominal 80 % coverage on engines the model has not seen.
    conformity = np.maximum(lo - y, y - hi)
    cqr = float(np.quantile(conformity, 0.80))
    cv_raw_coverage = float(np.mean((y >= lo) & (y <= hi)))
    lo, hi = lo - cqr, hi + cqr
    cv = _metrics(y, lo, mid, hi)
    cv["raw_interval_coverage"] = round(cv_raw_coverage, 3)
    cv.pop("nasa_score")  # the PHM score is defined on one prediction per test engine, not per row

    models = {k: _fit(a, ftr[cols], y) for k, a in QUANTILES.items()}

    # Official test set: predict at each test unit's last observed cycle.
    fte = build_features(pre.normalise(test), pre.sensors)
    last = fte.groupby("unit").tail(1).sort_values("unit")
    preds = predict_quantiles(models, last[cols], cqr)
    y_test = np.minimum(true_rul, RUL_CAP)
    test_m = _metrics(y_test, *preds)
    test_m["rmse_uncapped_truth"] = round(float(np.sqrt(np.mean((preds[1] - true_rul) ** 2))), 2)

    # Feature importance (gain) for the model card.
    imp = pd.Series(models["p50"].booster_.feature_importance("gain"), index=cols).sort_values(ascending=False)
    top = [{"feature": f, "gain_pct": round(100 * g / imp.sum(), 1)} for f, g in imp.head(12).items()]

    # Healthy reference for plain-English explanations: early-life mean and population slope scale.
    early = ftr[ftr["cycle"] <= 30]
    reference = {
        "healthy_mean": {s: float(early[f"{s}_mean10"].mean()) for s in pre.sensors},
        "slope_scale": {s: float(ftr[f"{s}_slope20"].abs().mean() + 1e-9) for s in pre.sensors},
        "sensor_std": {s: float(ftr[f"{s}_mean10"].std() + 1e-9) for s in pre.sensors},
    }

    joblib.dump(
        {"dataset": ds, "pre": pre, "columns": cols, "models": models, "reference": reference, "cqr": cqr},
        ARTIFACTS_DIR / f"rul_{ds}.joblib",
        compress=3,
    )
    calib = [
        {
            "unit": int(u),
            "actual": int(a),
            "p10": round(float(l_), 1),
            "p50": round(float(m_), 1),
            "p90": round(float(h_), 1),
        }
        for u, a, l_, m_, h_ in zip(last["unit"], y_test, *preds, strict=True)
    ]
    log.info(
        "%s: test RMSE %.2f  NASA %.0f  coverage %.2f  (%.0fs)",
        ds,
        test_m["rmse"],
        test_m["nasa_score"],
        test_m["interval_coverage"],
        time.time() - t0,
    )
    return {
        "dataset": ds,
        "train_units": int(train["unit"].nunique()),
        "test_units": int(test["unit"].nunique()),
        "train_rows": int(len(train)),
        "operating_conditions": N_CONDITIONS[ds],
        "sensors_used": pre.sensors,
        "sensors_dropped": [s for s in cmapss.SENSORS if s not in pre.sensors],
        "n_features": len(cols),
        "conformal_adjustment": round(cqr, 2),
        "cv": cv,
        "test": test_m,
        "top_features": top,
        "calibration": calib,
        "train_seconds": round(time.time() - t0, 1),
    }


def train_anomaly(ds: str = "FD001") -> dict:
    """IsolationForest on residuals between observed sensors and those expected for the predicted wear level."""
    from app.services.anomaly import anomaly_features, fit_expectation

    bundle = joblib.load(ARTIFACTS_DIR / f"rul_{ds}.joblib")
    pre = bundle["pre"]
    train = cmapss.load(ds, "train")
    norm = pre.normalise(train)
    feats = build_features(norm, pre.sensors)
    rul = add_rul(train).to_numpy()
    expect = fit_expectation(feats, rul, pre.sensors)
    x = anomaly_features(feats, rul, pre.sensors, expect)
    iso = IsolationForest(n_estimators=300, contamination=0.01, random_state=0).fit(x)
    scores = iso.score_samples(x)
    threshold = float(np.quantile(scores, 0.01))
    joblib.dump(
        {"dataset": ds, "sensors": pre.sensors, "iso": iso, "expect": expect, "threshold": threshold},
        ARTIFACTS_DIR / f"anomaly_{ds}.joblib",
    )
    return {"dataset": ds, "contamination": 0.01, "threshold": round(threshold, 4), "n_train": int(len(x))}


FLEET_DATASETS = ("FD001", "FD003")  # single-condition sets whose test engines populate the simulated fleet


def main() -> None:
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    source = cmapss.ensure_data()
    log.info("Engine data source: %s", source)
    metrics_path = ARTIFACTS_DIR / "metrics.json"
    if "--anomaly-only" in sys.argv and metrics_path.exists():
        metrics = json.loads(metrics_path.read_text())
        metrics["anomaly"] = [train_anomaly(ds) for ds in FLEET_DATASETS if cmapss.available(ds)]
        metrics_path.write_text(json.dumps(metrics, indent=2))
        return
    results = [train_dataset(ds) for ds in cmapss.DATASETS if cmapss.available(ds)]
    anomaly = [train_anomaly(ds) for ds in FLEET_DATASETS if cmapss.available(ds)]
    metrics = {
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "data_source": source,
        "model": "LightGBM quantile regression (P10 / P50 / P90)",
        "rul_cap": RUL_CAP,
        "params": PARAMS,
        "datasets": results,
        "anomaly": anomaly,
    }
    metrics_path.write_text(json.dumps(metrics, indent=2))
    log.info("Wrote %s", metrics_path)


if __name__ == "__main__":
    main()
