from datetime import datetime, timezone
from uuid import uuid4


def utcnow():
    """数据库使用无时区 UTC，避免 SQLite 与 MySQL 的时区差异。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(value):
    return value.isoformat(timespec="milliseconds") + "Z" if value else None


def new_token():
    """Opaque tracing/storage/lease token; business IDs come from the database."""
    return str(uuid4())


class BusinessError(Exception):
    def __init__(self, code, message, status=409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def envelope(request, data, message="success"):
    return {"code": "OK", "message": message, "data": data,
            "request_id": request.state.request_id, "timestamp": iso(utcnow())}
