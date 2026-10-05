from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import Part, Scenario
from app.services import whatif as W
from app.services.hashchain import append

router = APIRouter(prefix="/api/whatif", tags=["what-if"])


class RunIn(BaseModel):
    actions: list[dict] = Field(min_length=1, max_length=8)
    mission_aware: bool = True

    @field_validator("actions")
    @classmethod
    def _known(cls, v: list[dict]) -> list[dict]:
        for a in v:
            if a.get("type") not in W.ACTION_TYPES:
                raise ValueError(f"Unknown action type {a.get('type')!r}")
        return v


class SaveIn(RunIn):
    name: str = Field(min_length=1, max_length=80)


@router.post("/run", dependencies=[Depends(require("whatif"))])
def run(body: RunIn, session: Session = Depends(get_session)) -> dict:
    try:
        return W.run(session, body.actions, body.mission_aware)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, f"Invalid scenario: {exc}") from exc


@router.get("/scenarios", dependencies=[Depends(require("whatif"))])
def list_scenarios(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.exec(select(Scenario).order_by(Scenario.created_at.desc())).all()  # type: ignore[union-attr]
    return [
        {
            "id": r.id,
            "name": r.name,
            "actions": r.actions,
            "result": r.result,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/scenarios")
def save_scenario(
    body: SaveIn, role: Role = Depends(require("whatif")), session: Session = Depends(get_session)
) -> dict:
    result = W.run(session, body.actions, body.mission_aware)
    sc = Scenario(name=body.name, actions=result["actions"], result=result, created_by=DEMO_USERS[role])
    session.add(sc)
    session.flush()
    append(
        session,
        actor=DEMO_USERS[role],
        role=role.value,
        action="scenario.save",
        entity_type="scenario",
        entity_id=str(sc.id),
        summary=f"What-if scenario saved: {body.name}",
        payload={"name": body.name, "actions": [a["label"] for a in result["actions"]]},
    )
    session.commit()
    return {
        "id": sc.id,
        "name": sc.name,
        "actions": sc.actions,
        "result": result,
        "created_by": sc.created_by,
        "created_at": sc.created_at.isoformat(),
    }


@router.delete("/scenarios/{scenario_id}", dependencies=[Depends(require("whatif"))])
def delete_scenario(scenario_id: int, session: Session = Depends(get_session)) -> dict:
    sc = session.get(Scenario, scenario_id)
    if sc is None:
        raise HTTPException(404, "Scenario not found")
    session.delete(sc)
    session.commit()
    return {"deleted": scenario_id}


@router.get("/options", dependencies=[Depends(require("whatif"))])
def options(session: Session = Depends(get_session)) -> dict:
    """Pick-lists for the scenario builder."""
    from app.models import Aircraft, Base

    return {
        "aircraft": [
            {"tail": a.tail, "type": a.type, "base_id": a.base_id}
            for a in session.exec(select(Aircraft).order_by(Aircraft.tail)).all()
        ],
        "bases": [
            {"id": b.id, "name": b.name, "bays": b.hangar_bays}
            for b in session.exec(select(Base).order_by(Base.name)).all()
        ],
        "parts": [
            {"part_number": p.part_number, "name": p.name, "lead_time_days": p.lead_time_days}
            for p in session.exec(select(Part).order_by(Part.part_number)).all()
        ],
        "types": ["Fighter Type-A", "Transport Type-C", "Trainer Type-T"],
    }
