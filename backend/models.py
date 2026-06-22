from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime
import uuid


class Base(DeclarativeBase):
    pass


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    douyin_url = Column(String, nullable=False)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)


class StepRun(Base):
    __tablename__ = "step_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String, nullable=False)
    step = Column(String, nullable=False)
    status = Column(String, default="pending")
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    error_msg = Column(Text, nullable=True)
