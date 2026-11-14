from typing import Generic, TypeVar
from pydantic import BaseModel
from fastapi import Request
from .database import iso

T = TypeVar('T')

class Envelope(BaseModel, Generic[T]):
    code: str = 'OK'
    message: str = 'success'
    data: T | None
    request_id: str
    timestamp: str


def envelope(request: Request, data=None, *, code='OK', message='success') -> dict:
    return dict(code=code, message=message, data=data,
                request_id=request.state.request_id, timestamp=iso())
