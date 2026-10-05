"""Technician Copilot: troubleshooting answers grounded in the manual and past logbook cases.

With ANTHROPIC_API_KEY set, Claude writes the answer from the retrieved context (RAG) with citations.
Without it (or if the call fails) a structured retrieval-only answer is returned — same shape, same sources.
"""

from __future__ import annotations

import logging
import re
from collections import Counter

from sqlmodel import Session

from app.core.config import settings
from app.services.domain import KIND_LABEL
from app.services.retrieval import Section, get_index

log = logging.getLogger(__name__)

SYSTEM = (
    "You are AeroPulse Copilot, a troubleshooting assistant for aircraft maintenance technicians. "
    "Answer only from the provided manual sections and past logbook cases; cite them inline as [M1], [C2] etc. "
    "Structure: 1) Likely causes, most probable first, each with one line of evidence. 2) Recommended checks, in order. "
    "3) What fixed similar past cases. Be concise and practical. If the context does not cover the symptom, say so "
    "and recommend the relevant manual chapter. The manual is a fictional demonstration extract; never present it as "
    "real aircraft data. The technician may write in English or Hinglish; answer in clear English."
)


def _section_parts(s: Section) -> tuple[list[str], list[str]]:
    causes, checks, mode = [], [], None
    for line in s.text.splitlines():
        low = line.strip().lower()
        if low.startswith("likely causes"):
            mode = "c"
            continue
        if low.startswith("recommended checks") or low.startswith("recommended actions"):
            mode = "k"
            continue
        if low.startswith("rectification") or (not line.strip()):
            mode = None if low.startswith("rectification") else mode
            if low.startswith("rectification"):
                checks.append(line.strip())
            continue
        item = re.sub(r"^(\d+\.|-)\s*", "", line.strip())
        if mode == "c" and re.match(r"^(\d+\.|-)", line.strip()):
            causes.append(item)
        elif mode == "k" and re.match(r"^(\d+\.|-)", line.strip()):
            checks.append(item)
    return causes, checks


def retrieve(session: Session, question: str) -> dict:
    idx = get_index(session)
    manual = idx.manual(question, k=3)
    cases = idx.cases(question, k=6)
    # Likely causes: from the best-matching manual section, ranked by how often past cases' fixes support them.
    # Likely causes: from the best-matching manual section that lists causes, ranked by how many similar past
    # cases' narratives / fixes point at each cause (word-level similarity).
    causes, checks = [], []
    for sec, _ in manual:
        causes, checks = _section_parts(sec)
        if causes:
            break
    ranked = []
    if causes:
        docs = [c["narrative"] + " " + c["action_taken"] for c, _ in cases]
        support = [0] * len(causes)
        if docs:
            from sklearn.feature_extraction.text import TfidfVectorizer

            v = TfidfVectorizer(stop_words="english", token_pattern=r"(?u)\b[a-z]{3,}\b").fit(docs + causes)
            sim = (v.transform(causes) @ v.transform(docs).T).toarray()
            support = [int((row > 0.12).sum()) for row in sim]
        for i, cause in enumerate(causes):
            ranked.append(
                {
                    "cause": cause,
                    "manual_rank": i + 1,
                    "past_cases": support[i],
                    "score": (len(causes) - i) + 1.5 * support[i],
                }
            )
        ranked.sort(key=lambda r: -r["score"])
    best = cases[0][1] if cases else 0
    fixes = Counter(c["action_taken"] for c, sc in cases if sc >= 0.6 * best).most_common(3)
    kinds = Counter(c["component_kind"] for c, _ in cases)
    return {
        "manual": [
            {
                "id": f"M{i + 1}",
                "ref": s.ref,
                "title": s.title,
                "chapter": s.chapter,
                "text": s.text,
                "score": round(sc, 3),
            }
            for i, (s, sc) in enumerate(manual)
        ],
        "cases": [
            {**c, "record_id": c["id"], "id": f"C{i + 1}", "score": round(sc, 3)} for i, (c, sc) in enumerate(cases)
        ],
        "causes": ranked,
        "checks": checks,
        "past_fixes": [{"action": a, "count": n} for a, n in fixes],
        "component": KIND_LABEL.get(kinds.most_common(1)[0][0], None) if kinds else None,
    }


def _context(r: dict) -> str:
    parts = ["<manual>"]
    for m in r["manual"]:
        parts.append(f"[{m['id']}] {m['ref']} {m['title']} ({m['chapter']})\n{m['text']}")
    parts.append("</manual>\n<past_cases>")
    for c in r["cases"]:
        parts.append(
            f"[{c['id']}] {c['date']} {c['tail']} {c['defect_code']} — {c['narrative']} → Action: {c['action_taken']}"
        )
    parts.append("</past_cases>")
    return "\n\n".join(parts)


def ask_llm(question: str, r: dict) -> str | None:
    if not settings.anthropic_api_key:
        return None
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=60, max_retries=1)
        resp = client.beta.messages.create(
            model=settings.anthropic_model,
            max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low"},
            system=SYSTEM,
            messages=[{"role": "user", "content": f"{_context(r)}\n\nTechnician question: {question}"}],
        )
        if resp.stop_reason == "refusal":
            log.warning("Copilot request declined (%s)", getattr(resp.stop_details, "category", None))
            return None
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return text or None
    except anthropic.APIStatusError as exc:
        log.warning("Claude API error %s — using retrieval-only answer", exc.status_code)
    except anthropic.APIConnectionError:
        log.warning("Claude API unreachable (offline) — using retrieval-only answer")
    return None


def answer(session: Session, question: str) -> dict:
    r = retrieve(session, question)
    text = ask_llm(question, r)
    mode = "llm" if text else ("retrieval" if not settings.anthropic_api_key else "retrieval-fallback")
    if not text:
        lines = []
        if r["causes"]:
            lines.append("Likely causes, most probable first:")
            lines += [
                f"{i + 1}. {c['cause']}"
                + (f" — seen in {c['past_cases']} similar past case(s)" if c["past_cases"] else "")
                for i, c in enumerate(r["causes"])
            ]
        if r["checks"]:
            lines.append("")
            lines.append("Recommended checks:")
            lines += [f"• {c}" for c in r["checks"]]
        if not r["causes"] and r["manual"]:
            lines.append(f"{r['manual'][0]['title']} [M1]:")
            lines += [ln.strip() for ln in r["manual"][0]["text"].splitlines() if ln.strip()][:4]
        if r["past_fixes"]:
            lines.append("")
            lines.append("What fixed similar past cases:")
            lines += [f"• {f['action']}" + (f" (×{f['count']})" if f["count"] > 1 else "") for f in r["past_fixes"]]
        if r["manual"]:
            lines.append("")
            lines.append(f"Reference: {r['manual'][0]['ref']} {r['manual'][0]['title']} [M1].")
        if not lines:
            lines = [
                "No manual section or past case closely matches this symptom. Describe the system, the indication and when it occurs."
            ]
        text = "\n".join(lines)
    return {
        "question": question,
        "mode": mode,
        "model": settings.anthropic_model if mode == "llm" else None,
        "answer": text,
        **r,
    }
