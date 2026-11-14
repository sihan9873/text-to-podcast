"""FastAPI API进程；后台任务单独运行 python -m app.worker。"""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import configuration, generation, projects, resources
from app.core.common import BusinessError, iso, new_token, utcnow
from app.core.config import Settings
from app.db.database import Database
from app.db.models import User
from app.storage import LocalStorage

logger = logging.getLogger(__name__)


def create_app(settings=None):
    settings = settings or Settings.from_env()
    database = Database(settings.database_url)

    @asynccontextmanager
    async def lifespan(application):
        yield
        database.engine.dispose()

    app = FastAPI(title="TextCast 后端最小闭环（模拟服务）", version="0.3.0", lifespan=lifespan,
        description="本地单用户调研框架。固定开发身份，无登录认证。脚本与音频生成各等待10秒后返回内置测试结果。")
    app.state.settings, app.state.database = settings, database
    app.state.storage = LocalStorage(settings.storage_dir)
    app.add_middleware(CORSMiddleware, allow_origins=[settings.cors_origin], allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Idempotency-Key"], expose_headers=["X-Request-Id", "Location", "Retry-After"])

    @app.middleware("http")
    async def request_id(request, call_next):
        request.state.request_id = new_token()
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    def error(request, code, message, status):
        return JSONResponse(status_code=status, content={"code": code, "message": message, "data": None,
            "request_id": getattr(request.state, "request_id", new_token()), "timestamp": iso(utcnow())})

    @app.exception_handler(BusinessError)
    async def business_error(request, exc):
        return error(request, exc.code, exc.message, exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error(request, "INVALID_INPUT", "请求参数格式、范围或必填字段不正确", 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        code = "RESOURCE_NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return error(request, code, "请求的接口或资源不可用", exc.status_code)

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        return error(request, "STATE_CONFLICT", "数据状态冲突，请刷新后重试", 409)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        logger.error("Database error request=%s type=%s", request.state.request_id, type(exc).__name__)
        return error(request, "SERVICE_UNAVAILABLE", "数据库不可用，请检查连接并执行初始化", 503)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        logger.error("Unhandled error request=%s type=%s", request.state.request_id, type(exc).__name__)
        return error(request, "INTERNAL_ERROR", "内部处理失败，请提供请求ID排查", 500)

    @app.get("/api/health/live", tags=["系统"], summary="存活检查")
    @app.get("/api/v1/health/live", tags=["系统"], summary="存活检查")
    def live():
        return {"status": "ok", "checkedAt": iso(utcnow())}

    @app.get("/api/v1/health/ready", tags=["系统"], summary="数据库和初始化数据检查")
    def ready():
        with database.sessions() as session:
            session.execute(text("SELECT 1"))
            user = session.scalar(select(User).where(User.id == settings.development_user_id))
            if user is None:
                raise BusinessError("NOT_INITIALIZED", "请先执行 python -m app.bootstrap", 503)
        return {"status": "ready", "provider": "mock", "authentication": "fixed_development_user"}

    app.include_router(projects.router)
    app.include_router(generation.router)
    app.include_router(resources.router)
    app.include_router(configuration.router)
    return app


app = create_app()
