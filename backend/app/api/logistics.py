from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import CannibalisationAction, Component
from app.services import agencies as A
from app.services import health as H
from app.services import planning as P
from app.services import spares as S
from app.services.hashchain import append

router = APIRouter(prefix="/api", tags=["spares & agencies"])


@router.get("/spares", dependencies=[Depends(require("spares"))])
def spares(base_id: str | None = None, status: str | None = None, session: Session = Depends(get_session)) -> dict:
    state = P.load_state(session)
    rows = S.inventory(session, state, base_id)
    if status:
        rows = [r for r in rows if r["status"] == status]
    all_rows = S.inventory(session, state, base_id)
    return {
        "items": rows,
        "summary": {
            "lines": len(all_rows),
            "shortfall": sum(1 for r in all_rows if r["status"] == "shortfall"),
            "reorder": sum(1 for r in all_rows if r["status"] == "reorder"),
            "transfer": sum(1 for r in all_rows if r["status"] == "transfer"),
            "demand_30d": sum(r["demand_30d"] for r in all_rows),
            "stock_value_lakh": round(sum(r["on_hand"] * r["unit_cost"] for r in all_rows), 1),
        },
    }


@router.get("/spares/transfers", dependencies=[Depends(require("spares"))])
def transfers(session: Session = Depends(get_session)) -> list[dict]:
    return S.transfers(P.load_state(session))


@router.get("/spares/cannibalisation", dependencies=[Depends(require("spares"))])
def cannibalisation(session: Session = Depends(get_session)) -> dict:
    return S.cannibalisation(session, P.load_state(session))


class ApproveIn(BaseModel):
    recipient: str
    donor: str


@router.post("/spares/cannibalisation/approve")
def approve(
    body: ApproveIn, role: Role = Depends(require("approvals")), session: Session = Depends(get_session)
) -> dict:
    """Engineering Officer approval is mandatory (enforced by role)."""
    try:
        act = S.approve_cannibalisation(session, P.load_state(session), body.recipient, body.donor)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    act.approved_by = DEMO_USERS[role]
    session.flush()
    append(
        session,
        actor=DEMO_USERS[role],
        role=role.value,
        action="approval.cannibalisation",
        entity_type="cannibalisation",
        entity_id=str(act.id),
        tail=body.recipient,
        summary=f"Approved robbing {act.part_number} S/N {act.serial} from {body.donor} for {body.recipient}",
        payload={
            "donor": body.donor,
            "recipient": body.recipient,
            "part_number": act.part_number,
            "serial": act.serial,
        },
    )
    session.commit()
    return {"id": act.id, "status": act.status}


@router.post("/spares/cannibalisation/{action_id}/replaced")
def mark_replaced(
    action_id: int, role: Role = Depends(require("approvals")), session: Session = Depends(get_session)
) -> dict:
    act = session.get(CannibalisationAction, action_id)
    if act is None:
        raise HTTPException(404, "Not found")
    act.status = "replaced"
    comp = session.exec(select(Component).where(Component.serial == act.serial)).first()
    if comp:
        comp.robbed = False
        session.add(comp)
    session.add(act)
    append(
        session,
        actor=DEMO_USERS[role],
        role=role.value,
        action="cannibalisation.replaced",
        entity_type="cannibalisation",
        entity_id=str(act.id),
        tail=act.donor_tail,
        summary=f"Robbed {act.part_number} replaced on {act.donor_tail}",
        payload={"donor": act.donor_tail, "serial": act.serial},
    )
    session.commit()
    return {"id": act.id, "status": act.status}


@router.get("/spares/batch-watch", dependencies=[Depends(require("spares"))])
def batch_watch(session: Session = Depends(get_session)) -> list[dict]:
    return S.batch_watch(session, H.as_of(session))


@router.get("/agencies/scorecard", dependencies=[Depends(require("agencies"))])
def agency_scorecard(session: Session = Depends(get_session)) -> dict:
    return A.scorecard(session, H.as_of(session))
