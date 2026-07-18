"""Aggregate API router."""

from fastapi import APIRouter

from app.api.routes import (
    activity,
    admin_audit,
    auth,
    backups,
    documents,
    events,
    export_import,
    features,
    friends,
    gallery,
    geocode,
    invitations,
    jobs,
    legal,
    media,
    members,
    oauth,
    preferences,
    presence,
    quality,
    relation_types,
    search,
    settings,
    sse,
    statistics,
    stories,
    trees,
    users,
    virtual_views,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(admin_audit.router)
api_router.include_router(oauth.router)
api_router.include_router(users.router)
api_router.include_router(preferences.router)
api_router.include_router(settings.router)
api_router.include_router(features.router)
api_router.include_router(friends.router)
api_router.include_router(relation_types.router)
api_router.include_router(relation_types.admin_router)
api_router.include_router(search.router)
api_router.include_router(backups.router)
api_router.include_router(trees.router)
api_router.include_router(invitations.router)
api_router.include_router(invitations.global_router)
api_router.include_router(virtual_views.router)
api_router.include_router(export_import.router)
api_router.include_router(jobs.router)
api_router.include_router(members.router)
api_router.include_router(gallery.router)
api_router.include_router(events.router)
api_router.include_router(geocode.router)
api_router.include_router(stories.router)
api_router.include_router(documents.router)
api_router.include_router(activity.router)
api_router.include_router(presence.router)
api_router.include_router(quality.router)
api_router.include_router(statistics.router)
api_router.include_router(media.router)
api_router.include_router(sse.router)
api_router.include_router(legal.router)
