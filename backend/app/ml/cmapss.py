"""NASA C-MAPSS loading, download and synthetic fallback (same schema)."""

from __future__ import annotations

import io
import logging
import urllib.request
import zipfile
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.config import CMAPSS_DIR

log = logging.getLogger(__name__)

SETTINGS = ["setting1", "setting2", "setting3"]
SENSORS = [f"s{i}" for i in range(1, 22)]
COLUMNS = ["unit", "cycle", *SETTINGS, *SENSORS]
DATASETS = ["FD001", "FD002", "FD003", "FD004"]

DOWNLOAD_URL = "https://phm-datasets.s3.amazonaws.com/NASA/6.+Turbofan+Engine+Degradation+Simulation+Data+Set.zip"

# Plain-English sensor dictionary (C-MAPSS documentation, Saxena et al. 2008).
SENSOR_NAMES: dict[str, str] = {
    "s1": "Fan inlet temperature",
    "s2": "LPC outlet temperature",
    "s3": "HPC outlet temperature",
    "s4": "Exhaust gas temperature (LPT outlet)",
    "s5": "Fan inlet pressure",
    "s6": "Bypass-duct pressure",
    "s7": "HPC outlet total pressure",
    "s8": "Fan speed (N1)",
    "s9": "Core speed (N2)",
    "s10": "Engine pressure ratio",
    "s11": "HPC outlet static pressure",
    "s12": "Fuel-flow to static-pressure ratio",
    "s13": "Corrected fan speed",
    "s14": "Corrected core speed",
    "s15": "Bypass ratio",
    "s16": "Burner fuel-air ratio",
    "s17": "Bleed enthalpy",
    "s18": "Demanded fan speed",
    "s19": "Demanded corrected fan speed",
    "s20": "HPT coolant bleed",
    "s21": "LPT coolant bleed",
}


def source_label() -> str:
    marker = CMAPSS_DIR / "SOURCE"
    if marker.exists() and "synthetic" in marker.read_text().lower():
        return "synthetic"
    return "NASA C-MAPSS"


def available(dataset: str) -> bool:
    return all((CMAPSS_DIR / f"{p}_{dataset}.txt").exists() for p in ("train", "test", "RUL"))


def ensure_data(allow_download: bool = True) -> str:
    """Make sure at least FD001 exists. Returns data source label."""
    CMAPSS_DIR.mkdir(parents=True, exist_ok=True)
    if available("FD001"):
        return source_label()
    if allow_download:
        try:
            log.info("Downloading NASA C-MAPSS …")
            with urllib.request.urlopen(DOWNLOAD_URL, timeout=60) as r:
                outer = zipfile.ZipFile(io.BytesIO(r.read()))
            inner_name = next(n for n in outer.namelist() if n.endswith("CMAPSSData.zip"))
            inner = zipfile.ZipFile(io.BytesIO(outer.read(inner_name)))
            for name in inner.namelist():
                base = Path(name).name
                if base.endswith(".txt") and base.split("_")[0] in ("train", "test", "RUL"):
                    (CMAPSS_DIR / base).write_bytes(inner.read(name))
            (CMAPSS_DIR / "SOURCE").write_text(
                "NASA C-MAPSS (Saxena et al., 2008) via NASA Prognostics Data Repository\n"
            )
            return source_label()
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("C-MAPSS download failed (%s); generating synthetic data", exc)
    generate_synthetic()
    return "synthetic"


@lru_cache(maxsize=16)
def load(dataset: str, split: str) -> pd.DataFrame:
    """split: train | test. Returns dataframe with COLUMNS."""
    path = CMAPSS_DIR / f"{split}_{dataset}.txt"
    df = pd.read_csv(path, sep=r"\s+", header=None, names=COLUMNS, engine="python")
    return df


@lru_cache(maxsize=8)
def load_rul(dataset: str) -> np.ndarray:
    return pd.read_csv(CMAPSS_DIR / f"RUL_{dataset}.txt", header=None).iloc[:, 0].to_numpy()


# ---------------------------------------------------------------- synthetic fallback

# Healthy baseline and degradation sensitivity for each informative sensor (FD001-like magnitudes).
_SYN = {
    "s2": (642.5, 0.5, 2.0),
    "s3": (1589.0, 5.0, 25.0),
    "s4": (1405.0, 8.0, 38.0),
    "s7": (553.8, 0.8, -4.0),
    "s8": (2388.05, 0.06, 0.25),
    "s9": (9050.0, 18.0, 60.0),
    "s11": (47.45, 0.25, 1.6),
    "s12": (521.8, 0.7, -4.0),
    "s13": (2388.05, 0.06, 0.25),
    "s14": (8140.0, 18.0, 50.0),
    "s15": (8.42, 0.035, 0.18),
    "s17": (392.5, 1.4, 6.0),
    "s20": (38.9, 0.17, -0.9),
    "s21": (23.34, 0.1, -0.55),
}
_CONST = {"s1": 518.67, "s5": 14.62, "s6": 21.61, "s10": 1.3, "s16": 0.03, "s18": 2388.0, "s19": 100.0}


def _synthetic_units(rng: np.random.Generator, n_units: int, truncate: bool) -> tuple[pd.DataFrame, list[int]]:
    rows = []
    ruls = []
    for u in range(1, n_units + 1):
        life = int(rng.integers(130, 340))
        rate = rng.uniform(3.0, 5.0)
        stop = int(rng.integers(30, life - 5)) if truncate else life
        for c in range(1, stop + 1):
            frac = c / life
            deg = (np.exp(rate * frac) - 1) / (np.exp(rate) - 1)  # exponential wear, 0 → 1
            rec = {
                "unit": u,
                "cycle": c,
                "setting1": rng.normal(0, 0.002),
                "setting2": rng.normal(0, 0.0003),
                "setting3": 100.0,
            }
            for s in SENSORS:
                if s in _SYN:
                    base, noise, sens = _SYN[s]
                    rec[s] = base + sens * deg + rng.normal(0, noise)
                else:
                    rec[s] = _CONST[s]
            rows.append(rec)
        ruls.append(life - stop)
    return pd.DataFrame(rows, columns=COLUMNS), ruls


def generate_synthetic(seed: int = 7) -> None:
    rng = np.random.default_rng(seed)
    CMAPSS_DIR.mkdir(parents=True, exist_ok=True)
    for ds in ("FD001", "FD003"):
        train, _ = _synthetic_units(rng, 100, truncate=False)
        test, ruls = _synthetic_units(rng, 100, truncate=True)
        fmt = ["%d", "%d"] + ["%.4f"] * (len(COLUMNS) - 2)
        np.savetxt(CMAPSS_DIR / f"train_{ds}.txt", train.to_numpy(), fmt=fmt)
        np.savetxt(CMAPSS_DIR / f"test_{ds}.txt", test.to_numpy(), fmt=fmt)
        np.savetxt(CMAPSS_DIR / f"RUL_{ds}.txt", np.array(ruls), fmt="%d")
    (CMAPSS_DIR / "SOURCE").write_text("synthetic run-to-failure data (C-MAPSS schema), generated offline\n")
    load.cache_clear()
    load_rul.cache_clear()
