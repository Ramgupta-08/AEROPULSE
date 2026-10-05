from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import fleet, meta
from app.core.db import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="AeroPulse API",
    version="0.1.0",
    description=(
        "Predictive maintenance & fleet availability platform (SIH26249). "
        "Integration-ready REST + WebSocket API. All fleet data is simulated."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (meta.router, fleet.router):
    app.include_router(r)
