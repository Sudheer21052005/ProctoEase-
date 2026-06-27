import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.models.base import Base
from app.core.config import settings
import app.models  # Import all models to register metadata

engine = create_async_engine(settings.DATABASE_URL, echo=False)

async def clear_database():
    async with engine.begin() as conn:
        print("wiping old database schema...")
        await conn.run_sync(Base.metadata.drop_all)
        print("creating new database schema...")
        await conn.run_sync(Base.metadata.create_all)
        print("Database is now clean and empty.")

if __name__ == "__main__":
    asyncio.run(clear_database())
