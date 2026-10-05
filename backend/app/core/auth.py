"""Demo role-based access control.

The prototype uses a demo login: the client sends its role in the ``X-Role`` header
(or ``role`` query param for WebSockets). Every feature router declares which roles
may call it, so access is enforced on the API and not only hidden in the UI.
"""

from __future__ import annotations

from enum import StrEnum

from fastapi import Depends, Header, HTTPException, Query, status


class Role(StrEnum):
    commander = "commander"
    engineering_officer = "engineering_officer"
    technician = "technician"
    logistics = "logistics"
    auditor = "auditor"


ROLE_LABELS: dict[Role, str] = {
    Role.commander: "Commander",
    Role.engineering_officer: "Engineering Officer",
    Role.technician: "Technician",
    Role.logistics: "Logistics Officer",
    Role.auditor: "Auditor",
}

DEMO_USERS: dict[Role, str] = {
    Role.commander: "Gp Capt A. Rao",
    Role.engineering_officer: "Wg Cdr S. Menon",
    Role.technician: "Sgt R. Yadav",
    Role.logistics: "Sqn Ldr P. Iyer",
    Role.auditor: "Mr K. Bhatia",
}

ALL = frozenset(Role)
EO = Role.engineering_officer

# Feature area -> roles allowed. Engineering Officer sees everything.
ACCESS: dict[str, frozenset[Role]] = {
    "shared": ALL,
    "overview": frozenset({Role.commander, EO}),
    "fleet": frozenset({Role.commander, EO, Role.technician, Role.logistics}),
    "health": frozenset({Role.commander, EO, Role.technician}),
    "health_write": frozenset({EO, Role.technician}),
    "schedule": frozenset({Role.commander, EO}),
    "schedule_write": frozenset({EO}),
    "whatif": frozenset({Role.commander, EO}),
    "missions": frozenset({Role.commander, EO}),
    "spares": frozenset({EO, Role.logistics}),
    "approvals": frozenset({EO}),
    "agencies": frozenset({EO, Role.logistics}),
    "copilot": frozenset({EO, Role.technician}),
    "records": frozenset({EO, Role.auditor}),
    "datahub": frozenset({EO, Role.auditor, Role.logistics}),
    "reports": frozenset({Role.commander, EO}),
}


def current_role(
    x_role: str | None = Header(default=None, alias="X-Role"),
    role: str | None = Query(default=None, include_in_schema=False),
) -> Role:
    raw = x_role or role or Role.engineering_officer.value
    try:
        return Role(raw)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Unknown role '{raw}'") from exc


def require(area: str):
    allowed = ACCESS[area]

    def _dep(r: Role = Depends(current_role)) -> Role:
        if r not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{ROLE_LABELS[r]}' is not permitted to access '{area}'.",
            )
        return r

    return _dep
