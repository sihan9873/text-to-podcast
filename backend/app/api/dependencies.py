from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session


def get_session(request: Request):
    with request.app.state.database.sessions() as session:
        yield session


def current_user(request: Request):
    """本地调研阶段固定开发用户；后续在此替换为会话鉴权。"""
    return request.app.state.settings.development_user_id


def idempotency_key(value: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]):
    return value


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[int, Depends(current_user)]
IdempotencyDep = Annotated[str, Depends(idempotency_key)]
