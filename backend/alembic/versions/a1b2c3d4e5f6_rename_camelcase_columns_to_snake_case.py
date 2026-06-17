"""Rename camelCase columns to snake_case in members and gallery_images tables.

The DB columns are renamed; camelCase is preserved at the API boundary via
Pydantic aliases in the schema layer, so the frontend JSON contract is unchanged.

Tables and column renames:

  members:
    firstName      → first_name
    lastName       → last_name
    academicTitle  → academic_title
    middleNames    → middle_names
    baptismalName  → baptismal_name
    maidenName     → maiden_name
    imageData      → image_data
    dateOfBirth    → date_of_birth
    dateOfDeath    → date_of_death
    additionalData → additional_data
    placesLived    → places_lived
    isCollapsed    → is_collapsed
    positionX      → position_x
    positionY      → position_y

  gallery_images:
    imageData  → image_data
    createdAt  → created_at
    uploadedAt → uploaded_at

Revision ID: a1b2c3d4e5f6
Revises: f8c1d2e3a4b5
Create Date: 2026-06-17

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f8c1d2e3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- members table ---
    op.alter_column("members", "firstName", new_column_name="first_name")
    op.alter_column("members", "lastName", new_column_name="last_name")
    op.alter_column("members", "academicTitle", new_column_name="academic_title")
    op.alter_column("members", "middleNames", new_column_name="middle_names")
    op.alter_column("members", "baptismalName", new_column_name="baptismal_name")
    op.alter_column("members", "maidenName", new_column_name="maiden_name")
    op.alter_column("members", "imageData", new_column_name="image_data")
    op.alter_column("members", "dateOfBirth", new_column_name="date_of_birth")
    op.alter_column("members", "dateOfDeath", new_column_name="date_of_death")
    op.alter_column("members", "additionalData", new_column_name="additional_data")
    op.alter_column("members", "placesLived", new_column_name="places_lived")
    op.alter_column("members", "isCollapsed", new_column_name="is_collapsed")
    op.alter_column("members", "positionX", new_column_name="position_x")
    op.alter_column("members", "positionY", new_column_name="position_y")

    # --- gallery_images table ---
    op.alter_column("gallery_images", "imageData", new_column_name="image_data")
    op.alter_column("gallery_images", "createdAt", new_column_name="created_at")
    op.alter_column("gallery_images", "uploadedAt", new_column_name="uploaded_at")


def downgrade() -> None:
    # --- gallery_images table ---
    op.alter_column("gallery_images", "uploaded_at", new_column_name="uploadedAt")
    op.alter_column("gallery_images", "created_at", new_column_name="createdAt")
    op.alter_column("gallery_images", "image_data", new_column_name="imageData")

    # --- members table ---
    op.alter_column("members", "position_y", new_column_name="positionY")
    op.alter_column("members", "position_x", new_column_name="positionX")
    op.alter_column("members", "is_collapsed", new_column_name="isCollapsed")
    op.alter_column("members", "places_lived", new_column_name="placesLived")
    op.alter_column("members", "additional_data", new_column_name="additionalData")
    op.alter_column("members", "date_of_death", new_column_name="dateOfDeath")
    op.alter_column("members", "date_of_birth", new_column_name="dateOfBirth")
    op.alter_column("members", "image_data", new_column_name="imageData")
    op.alter_column("members", "maiden_name", new_column_name="maidenName")
    op.alter_column("members", "baptismal_name", new_column_name="baptismalName")
    op.alter_column("members", "middle_names", new_column_name="middleNames")
    op.alter_column("members", "academic_title", new_column_name="academicTitle")
    op.alter_column("members", "last_name", new_column_name="lastName")
    op.alter_column("members", "first_name", new_column_name="firstName")
