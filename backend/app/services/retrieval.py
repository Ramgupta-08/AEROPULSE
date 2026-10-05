"""Local retrieval over the fictional maintenance manual and the technical-records logbook (offline TF-IDF).

Character n-grams make retrieval robust to Hinglish, abbreviations ("hyd press") and typos.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlmodel import Session, func, select

from app.core.config import MANUALS_DIR
from app.models import MaintenanceRecord


@dataclass
class Section:
    ref: str  # e.g. "GMM 29-10"
    title: str
    chapter: str
    text: str


def load_manual() -> list[Section]:
    out = []
    for path in sorted(MANUALS_DIR.glob("*.md")):
        text = path.read_text()
        chapter = text.splitlines()[0].lstrip("# ").strip()
        for block in re.split(r"\n(?=## )", text)[1:]:
            head, _, body = block.partition("\n")
            m = re.match(r"## (GMM [\d-]+)\s+(.*)", head)
            if m:
                out.append(Section(ref=m.group(1), title=m.group(2).strip(), chapter=chapter, text=body.strip()))
    return out


def _vectorizer() -> TfidfVectorizer:
    return TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=1)


def _words() -> TfidfVectorizer:
    return TfidfVectorizer(
        analyzer="word", token_pattern=r"(?u)\b[a-z0-9]{2,}\b", lowercase=True, sublinear_tf=True, stop_words="english"
    )


class Hybrid:
    """Blend of character n-gram (robust to Hinglish/typos) and word TF-IDF (sharp on acronyms like EGT, APU)."""

    def __init__(self, docs: list[str]):
        self.c, self.w = _vectorizer(), _words()
        self.mc, self.mw = self.c.fit_transform(docs), self.w.fit_transform(docs)

    def scores(self, query: str) -> np.ndarray:
        sc = (self.mc @ self.c.transform([query]).T).toarray().ravel()
        sw = (self.mw @ self.w.transform([query]).T).toarray().ravel()
        return 0.5 * sc + 0.5 * sw


class Index:
    def __init__(self, session: Session):
        self.sections = load_manual()
        self.h_manual = Hybrid([f"{s.title} {s.title} {s.title} {s.text}" for s in self.sections])
        recs = session.exec(select(MaintenanceRecord).where(MaintenanceRecord.record_type == "defect")).all()
        self.records = [
            {
                "id": r.id,
                "tail": r.tail,
                "base_id": r.base_id,
                "date": r.date.isoformat(),
                "defect_code": r.defect_code,
                "component_kind": r.component_kind,
                "narrative": r.narrative,
                "action_taken": r.action_taken,
                "batch": r.batch,
                "man_hours": r.man_hours,
            }
            for r in recs
        ]
        self.h_logs = Hybrid([r["narrative"] for r in self.records])

    def manual(self, query: str, k: int = 3) -> list[tuple[Section, float]]:
        sims = self.h_manual.scores(query)
        idx = np.argsort(-sims)[:k]
        return [(self.sections[i], float(sims[i])) for i in idx if sims[i] > 0.02]

    def cases(self, query: str, k: int = 6) -> list[tuple[dict, float]]:
        sims = self.h_logs.scores(query)
        out, seen = [], set()
        for i in np.argsort(-sims)[: k * 4]:
            r = self.records[i]
            key = (r["narrative"][:60], r["action_taken"][:40])
            if sims[i] <= 0.05 or key in seen:
                continue
            seen.add(key)
            out.append((r, float(sims[i])))
            if len(out) == k:
                break
        return out


_lock = threading.Lock()
_index: tuple[int, Index] | None = None


def get_index(session: Session) -> Index:
    """Rebuilt when technical records are added (new log entries become searchable immediately)."""
    global _index
    n = session.exec(select(func.count()).select_from(MaintenanceRecord)).one()
    with _lock:
        if _index is None or _index[0] != n:
            _index = (n, Index(session))
        return _index[1]
