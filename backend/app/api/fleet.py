from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.core.auth import require
from app.core.db import get_session
from app.models import Aircraft, Base

router = APIRouter(prefix="/api", tags=["fleet"])


class BaseOut(BaseModel):
    id: str
    name: str
    lat: float
    lon: float
    environment: str
    hangar_bays: int
    aircraft: int
    ready: int
    caution: int
    grounded: int
    readiness_pct: float


@router.get("/bases", response_model=list[BaseOut], dependencies=[Depends(require("shared"))])
def list_bases(session: Session = Depends(get_session)) -> list[BaseOut]:
    counts: dict[tuple[str, str], int] = {}
    rows = session.exec(
        select(Aircraft.base_id, Aircraft.status, func.count()).group_by(Aircraft.base_id, Aircraft.status)
    )
    for base_id, st, n in rows:
        counts[(base_id, st)] = n
    out = []
    for b in session.exec(select(Base).order_by(Base.name)).all():
        r, c, g = (counts.get((b.id, s), 0) for s in ("ready", "caution", "grounded"))
        total = r + c + g
        out.append(
            BaseOut(
                **b.model_dump(),
                aircraft=total,
                ready=r,
                caution=c,
                grounded=g,
                readiness_pct=round(100 * (r + c) / total, 1) if total else 0.0,
            )
        )
    return out


@router.get("/bases/{base_id}", response_model=BaseOut, dependencies=[Depends(require("shared"))])
def get_base(base_id: str, session: Session = Depends(get_session)) -> BaseOut:
    for b in list_bases(session):
        if b.id == base_id:
            return b
    raise HTTPException(404, f"Base {base_id} not found")
