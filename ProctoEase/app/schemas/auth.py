"""Auth schemas — login, token response, refresh."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_slug: str = Field(
        ..., min_length=2, max_length=100,
        description="Identifies which tenant the user belongs to",
    )


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str
