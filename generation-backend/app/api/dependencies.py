from typing import Annotated
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request as UpstreamRequest, urlopen

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.common import BusinessError
from app.db.models import User, RoleProfile
from app.db.seed import ROLE_ID

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session


def get_session(request: Request):
    with request.app.state.database.sessions() as session:
        yield session


def current_user(request: Request):
    auth_url = os.environ.get("TEXTCAST_AUTH_URL")
    if not auth_url:
        return request.app.state.settings.development_user_id

    cookie = request.headers.get("cookie")
    if not cookie:
        raise BusinessError("AUTH_REQUIRED", "请先登录", 401)
    try:
        upstream = UpstreamRequest(auth_url.rstrip("/") + "/api/auth/me", headers={"Cookie": cookie})
        with urlopen(upstream, timeout=5) as response:
            identity = json.load(response)["user"]["id"]
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise BusinessError("AUTH_REQUIRED", "登录已失效", 401) from exc
        raise BusinessError("AUTH_UNAVAILABLE", "登录服务暂不可用", 503) from exc
    except (URLError, TimeoutError, ValueError, KeyError) as exc:
        raise BusinessError("AUTH_UNAVAILABLE", "登录服务暂不可用", 503) from exc

    account_key = f"auth:{identity}"
    with request.app.state.database.sessions() as session:
        lookup = select(User).where(User.username == account_key)
        user = session.scalar(lookup)
        if user is None:
            try:
                user = User(username=account_key)
                session.add(user)
                session.flush()
                template = session.get(RoleProfile, ROLE_ID)
                session.add(RoleProfile(user_id=user.id, name="主持人",
                    description="", voice_config=template.voice_config))
                session.commit()
            except IntegrityError:
                session.rollback()
                user = session.scalar(lookup)
                if user is None:
                    raise
        return user.id


def idempotency_key(value: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=128)]):
    return value


SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[int, Depends(current_user)]
IdempotencyDep = Annotated[str, Depends(idempotency_key)]
