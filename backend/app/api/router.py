"""Aggregate API router."""

from fastapi import APIRouter

from app.api.routes import (
    activity,
    auth,
    events,
    export_import,
    gallery,
    members,
    oauth,
    settings,
    stories,
    trees,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(oauth.router)
api_router.include_router(users.router)
api_router.include_router(settings.router)
api_router.include_router(trees.router)
api_router.include_router(export_import.router)
api_router.include_router(members.router)
api_router.include_router(gallery.router)
api_router.include_router(events.router)
api_router.include_router(stories.router)
api_router.include_router(activity.router)
