"""Feature engineering for RUL models (shared by training and serving)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from app.ml.cmapss import SENSORS, SETTINGS

RUL_CAP = 125
WINDOWS = (5, 10, 20)
SLOPE_WINDOWS = (10, 20)
FLAT_STD = 1e-3


@dataclass
class Preprocessor:
    """Fitted on training data: informative sensors + per-operating-condition normalisation."""

    sensors: list[str]
    n_conditions: int
    kmeans: KMeans | None
    mean: dict[int, np.ndarray]
    std: dict[int, np.ndarray]

    def conditions(self, df: pd.DataFrame) -> np.ndarray:
        if self.kmeans is None:
            return np.zeros(len(df), dtype=int)
        return self.kmeans.predict(df[SETTINGS].round(2).to_numpy())

    def normalise(self, df: pd.DataFrame) -> pd.DataFrame:
        cond = self.conditions(df)
        x = df[self.sensors].to_numpy(dtype=float).copy()
        for c in np.unique(cond):
            m = cond == c
            x[m] = (x[m] - self.mean[int(c)]) / self.std[int(c)]
        out = pd.DataFrame(x, columns=self.sensors, index=df.index)
        out.insert(0, "cycle", df["cycle"].to_numpy())
        out.insert(0, "unit", df["unit"].to_numpy())
        return out


def fit_preprocessor(train: pd.DataFrame, n_conditions: int) -> Preprocessor:
    km = None
    cond = np.zeros(len(train), dtype=int)
    if n_conditions > 1:
        km = KMeans(n_clusters=n_conditions, n_init=10, random_state=0).fit(train[SETTINGS].round(2).to_numpy())
        cond = km.labels_
    # Informative sensors: not flat within operating conditions.
    keep = []
    for s in SENSORS:
        within = pd.Series(train[s].to_numpy()).groupby(cond).std().fillna(0)
        if within.mean() > FLAT_STD and train[s].nunique() > 20:
            keep.append(s)
    mean, std = {}, {}
    for c in np.unique(cond):
        sub = train.loc[cond == c, keep].to_numpy(dtype=float)
        mean[int(c)] = sub.mean(axis=0)
        std[int(c)] = sub.std(axis=0) + 1e-9
    return Preprocessor(sensors=keep, n_conditions=n_conditions, kmeans=km, mean=mean, std=std)


def _rolling_slope(s: pd.Series, w: int) -> pd.Series:
    """Least-squares slope over a trailing window (per cycle)."""
    t = pd.Series(np.arange(len(s), dtype=float), index=s.index)
    cov = s.rolling(w, min_periods=3).cov(t)
    var = t.rolling(w, min_periods=3).var()
    return (cov / var).fillna(0.0)


def build_features(norm: pd.DataFrame, sensors: list[str]) -> pd.DataFrame:
    """Backward-looking rolling statistics per unit; row i only uses cycles ≤ i."""
    parts = []
    for _, g in norm.groupby("unit", sort=False):
        g = g.sort_values("cycle")
        feats = {"unit": g["unit"].to_numpy(), "cycle": g["cycle"].to_numpy()}
        for s in sensors:
            col = g[s]
            feats[f"{s}"] = col.to_numpy()
            for w in WINDOWS:
                r = col.rolling(w, min_periods=1)
                feats[f"{s}_mean{w}"] = r.mean().to_numpy()
                feats[f"{s}_std{w}"] = r.std().fillna(0).to_numpy()
            for w in SLOPE_WINDOWS:
                feats[f"{s}_slope{w}"] = _rolling_slope(col.reset_index(drop=True), w).to_numpy()
        parts.append(pd.DataFrame(feats, index=g.index))
    return pd.concat(parts).loc[norm.index]


def feature_columns(sensors: list[str]) -> list[str]:
    cols = ["cycle"]
    for s in sensors:
        cols.append(s)
        cols += [f"{s}_{k}{w}" for w in WINDOWS for k in ("mean", "std")]
        cols += [f"{s}_slope{w}" for w in SLOPE_WINDOWS]
    return cols


def add_rul(df: pd.DataFrame) -> pd.Series:
    max_c = df.groupby("unit")["cycle"].transform("max")
    return (max_c - df["cycle"]).clip(upper=RUL_CAP)


def nasa_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """PHM08 asymmetric scoring: late predictions are penalised more than early ones."""
    d = np.asarray(y_pred, dtype=float) - np.asarray(y_true, dtype=float)
    return float(np.sum(np.where(d < 0, np.exp(-d / 13) - 1, np.exp(d / 10) - 1)))


class OffsetModel:
    """LightGBM model trained from a constant init score; predictions add the offset back.

    Quantile objectives initialised at the label quantile can stall when that quantile sits on the RUL cap
    (every row gets an identical gradient), so all quantile models start from the label mean instead.
    """

    def __init__(self, model, offset: float):
        self.model = model
        self.offset = float(offset)

    def predict(self, x):
        return self.model.predict(x) + self.offset

    @property
    def booster_(self):
        return self.model.booster_


def predict_quantiles(models: dict, x: pd.DataFrame, cqr: float = 0.0) -> np.ndarray:
    """Rows P10, P50, P90 (non-crossing, conformally widened by `cqr`, clipped at 0)."""
    p = np.sort(np.vstack([models[k].predict(x) for k in ("p10", "p50", "p90")]), axis=0)
    p[0] -= cqr
    p[2] += cqr
    return p.clip(0, None)
