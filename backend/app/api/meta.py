from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.auth import ACCESS, DEMO_USERS, ROLE_LABELS, Role, current_role
from app.core.db import get_session
from app.models import Meta

router = APIRouter(prefix="/api", tags=["meta"])


class Ping(BaseModel):
    status: str
    service: str


class RoleInfo(BaseModel):
    id: str
    label: str
    user: str
    areas: list[str]


class MetaOut(BaseModel):
    as_of: str | None
    engine_data_source: str | None
    fleet_data: str
    llm_enabled: bool
    deployment: str
    role: RoleInfo
    roles: list[RoleInfo]


def _role_info(r: Role) -> RoleInfo:
    return RoleInfo(
        id=r.value,
        label=ROLE_LABELS[r],
        user=DEMO_USERS[r],
        areas=sorted(a for a, roles in ACCESS.items() if r in roles),
    )


@router.get("/ping", response_model=Ping)
def ping() -> Ping:
    return Ping(status="ok", service="aeropulse")


@router.get("/meta", response_model=MetaOut)
def meta(role: Role = Depends(current_role), session: Session = Depends(get_session)) -> MetaOut:
    from app.core.config import settings

    kv = {m.key: m.value for m in session.exec(select(Meta)).all()}
    return MetaOut(
        as_of=kv.get("as_of"),
        engine_data_source=kv.get("engine_data_source"),
        fleet_data="simulated",
        llm_enabled=settings.anthropic_api_key is not None,
        deployment="on-premise / offline",
        role=_role_info(role),
        roles=[_role_info(r) for r in Role],
    )
