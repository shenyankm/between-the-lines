"""Concrete database resource used by the API lifespan and standalone CLIs."""

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .config import Settings


class Database:
    def __init__(self, settings: Settings):
        self.engine = create_async_engine(
            settings.database_url,
            pool_size=10,
            max_overflow=20,
            pool_timeout=5,
            connect_args={"timeout": 5, "command_timeout": 10},
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def close(self) -> None:
        await self.engine.dispose()
