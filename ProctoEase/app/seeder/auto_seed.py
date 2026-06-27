"""Auto-seed wrapper for Docker startup.

Runs seeding only when the database has no tenant/user data.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import func, select

from app.core.database import async_session_factory
from app.models.tenant import Tenant
from app.models.user import User
from app.seeder import data_seeder


async def run() -> None:
    async with async_session_factory() as db:
        tenant_count = await db.scalar(select(func.count(Tenant.id)))
        user_count = await db.scalar(select(func.count(User.id)))

    tenant_count = int(tenant_count or 0)
    user_count = int(user_count or 0)

    if tenant_count == 0 and user_count == 0:
        print("Seeding started")
        await data_seeder.run()
    else:
        print("Seeding skipped (data exists)")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
