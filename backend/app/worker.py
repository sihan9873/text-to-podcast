"""启动：python -m app.worker。独立进程扫描数据库，不依赖 Redis。"""
import logging
from copy import deepcopy
from threading import Event, Thread

from sqlalchemy.exc import SQLAlchemyError

from app.core.common import BusinessError
from app.core.config import Settings
from app.db.database import Database
from app.integrations.contracts import AudioGenerator, ScriptGenerator
from app.integrations.local_llm import script_generator_for_snapshot
from app.integrations.local_tts import generator_for_snapshot
from app.jobs import repository
from app.jobs.handlers import publish_audio, publish_script
from app.storage import LocalStorage

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, database, settings, script_generator: ScriptGenerator | None = None,
                 audio_generator: AudioGenerator | None = None):
        self.database, self.settings = database, settings
        self.storage = LocalStorage(settings.storage_dir)
        self.script_generator = script_generator
        self.audio_generator = audio_generator

    def renew(self, job, stopped):
        while not stopped.wait(max(1, self.settings.lease_seconds / 3)):
            try:
                repository.heartbeat(self.database, job["id"], job["token"], self.settings)
            except SQLAlchemyError:
                logger.error("Heartbeat failed: task=%s", job["id"])

    def run_once(self):
        repository.recover_expired(self.database)
        job = repository.claim(self.database, self.settings)
        if job is None:
            return False
        stopped = Event()
        heart = Thread(target=self.renew, args=(job, stopped), daemon=True)
        heart.start()
        try:
            if job["task_type"] == "script":
                generator = self.script_generator if self.script_generator is not None else script_generator_for_snapshot(job["snapshot"])
                result = generator.generate(deepcopy(job["snapshot"]))
                publish_script(self.database, job, result)
            else:
                # 按提交时的配置快照分派，不让 .env 改动改变已排队任务的模型。
                generator = self.audio_generator if self.audio_generator is not None else generator_for_snapshot(job["snapshot"])
                result = generator.generate(deepcopy(job["snapshot"]))
                publish_audio(self.database, self.storage, job, result)
            logger.info("Task completed: id=%s type=%s", job["id"], job["task_type"])
        except KeyboardInterrupt:
            repository.fail(self.database, job["id"], job["token"], "WORKER_INTERRUPTED", "Worker 已停止，请重新提交当前阶段")
            raise
        except BusinessError as exc:
            repository.fail(self.database, job["id"], job["token"], exc.code, exc.message)
        except Exception as exc:
            logger.error("Task failed: id=%s exception_type=%s", job["id"], type(exc).__name__)
            repository.fail(self.database, job["id"], job["token"], "GENERATION_FAILED", "生成服务处理失败，请重新提交当前阶段")
        finally:
            stopped.set()
            heart.join(timeout=5)
        return True

    def run_forever(self):
        stopped = Event()
        logger.info("Database worker started; script/audio providers selected from each task snapshot")
        try:
            while True:
                try:
                    if not self.run_once():
                        stopped.wait(self.settings.poll_seconds)
                except SQLAlchemyError:
                    logger.error("Database unavailable; check initialization and connection; retrying")
                    stopped.wait(2)
        except KeyboardInterrupt:
            logger.info("Worker stopped")


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings.from_env()
    database = Database(settings.database_url)
    try:
        Worker(database, settings).run_forever()
    finally:
        database.engine.dispose()


if __name__ == "__main__":
    main()
