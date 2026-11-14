from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from uuid import uuid4
from starlette.exceptions import HTTPException
from .contracts import envelope
from .projects import router as projects_router

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import router as auth_router
from .config import Settings
from .database import Database
from .errors import ApiError
from .security import CredentialValidationError, validate_password, validate_username
from .users import router as users_router


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database = Database(app_settings.database_path)
        database.initialize()
        username = app_settings.bootstrap_admin_username
        password = app_settings.bootstrap_admin_password
        if bool(username) != bool(password):
            raise RuntimeError(
                "TEXTCAST_BOOTSTRAP_ADMIN_USERNAME 和 "
                "TEXTCAST_BOOTSTRAP_ADMIN_PASSWORD 必须同时配置"
            )
        if database.count_users() == 0 and username and password:
            try:
                database.create_user(
                    username=validate_username(username),
                    display_name=app_settings.bootstrap_admin_display_name.strip()
                    or "系统管理员",
                    password=password,
                    role="admin",
                )
            except CredentialValidationError as exc:
                raise RuntimeError(f"初始管理员配置不合法：{exc}") from exc
        yield

    app = FastAPI(
        title="TextCast API",
        version="0.1.0",
        description="文字转播客生成系统正式后端接口",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    def is_v1(request: Request) -> bool:
        return request.url.path == "/api/v1" or request.url.path.startswith("/api/v1/")

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        if is_v1(request):
            return JSONResponse(status_code=exc.status_code, content=envelope(
                request, code="NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
                message="资源不存在" if exc.status_code == 404 else "请求无法处理"), headers=exc.headers)
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logging.getLogger(__name__).error("Unhandled request %s", getattr(request.state, "request_id", "unknown"), exc_info=exc)
        return JSONResponse(status_code=500, content=envelope(request, code="INTERNAL_ERROR", message="服务器内部错误") if is_v1(request) else {"code": "INTERNAL_ERROR", "message": "服务器内部错误"})

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        if is_v1(request):
            return JSONResponse(status_code=exc.status_code, content=envelope(request, code=exc.code, message=exc.message))
        body: dict[str, object] = {"code": exc.code, "message": exc.message}
        if exc.details is not None:
            body["details"] = exc.details
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        if is_v1(request):
            return JSONResponse(status_code=422, content=envelope(request, code="INVALID_INPUT", message="请求参数不合法"))
        details = [
            {
                "field": ".".join(str(part) for part in item["loc"][1:]),
                "message": item["msg"],
            }
            for item in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "message": "请求参数不合法",
                "details": details,
            },
        )

    @app.get("/api/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "service": "TextCast API",
            "health": "/api/health",
            "docs": "/docs",
        }

    app.include_router(auth_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(projects_router, prefix="/api/v1")
    return app


app = create_app()
