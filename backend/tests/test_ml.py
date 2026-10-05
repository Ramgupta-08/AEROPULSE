import numpy as np
import pandas as pd

from app.ml.features import RUL_CAP, add_rul, build_features, nasa_score


def _toy(n=40):
    return pd.DataFrame(
        {"unit": [1] * n, "cycle": range(1, n + 1), "s2": np.linspace(0, 1, n), "s3": np.sin(np.arange(n))}
    )


def test_features_are_backward_looking():
    df = _toy()
    full = build_features(df, ["s2", "s3"])
    trunc = build_features(df.iloc[:25], ["s2", "s3"])
    pd.testing.assert_series_equal(full.iloc[24], trunc.iloc[24], check_names=False)


def test_rul_target_capped():
    df = pd.DataFrame({"unit": [1] * 200, "cycle": range(1, 201)})
    r = add_rul(df)
    assert r.max() == RUL_CAP and r.iloc[-1] == 0


def test_nasa_score_penalises_late_more_than_early():
    y = np.array([50.0])
    assert nasa_score(y, y + 10) > nasa_score(y, y - 10) > 0
    assert nasa_score(y, y) == 0


def test_trained_metrics_within_target():
    import json

    from app.core.config import ARTIFACTS_DIR

    path = ARTIFACTS_DIR / "metrics.json"
    if not path.exists():
        import pytest

        pytest.skip("models not trained")
    m = json.loads(path.read_text())
    fd1 = next(d for d in m["datasets"] if d["dataset"] == "FD001")
    assert 10 < fd1["test"]["rmse"] < 18
    assert fd1["test"]["interval_coverage"] >= 0.7
