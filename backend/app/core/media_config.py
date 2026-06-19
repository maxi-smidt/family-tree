"""Definitions for media settings and storage invariants."""

MEBIBYTE = 1024 * 1024

DEFAULT_MAX_IMAGE_UPLOAD_MB = 10
MIN_MAX_IMAGE_UPLOAD_MB = 1
MAX_MAX_IMAGE_UPLOAD_MB = 100

DEFAULT_MAX_DOCUMENT_UPLOAD_MB = 25
MIN_MAX_DOCUMENT_UPLOAD_MB = 1
MAX_MAX_DOCUMENT_UPLOAD_MB = 500

DEFAULT_MAX_IMAGE_DIMENSION = 4096
MIN_MAX_IMAGE_DIMENSION = 256
MAX_MAX_IMAGE_DIMENSION = 16384

# Stored images are normalized to this display-oriented bounding box. These
# values are implementation invariants, not operator-facing settings.
STORED_IMAGE_WIDTH = 1920
STORED_IMAGE_HEIGHT = 1080

# Per-user storage quota defaults (0 = unlimited). The total is reported as
# tree + media, so it has no separate default.
DEFAULT_TREE_QUOTA_MB = 0
DEFAULT_MEDIA_QUOTA_MB = 0

# Gallery image storage mode: how uploaded gallery images are persisted.
DEFAULT_IMAGE_STORAGE_MODE = "compressed"
IMAGE_STORAGE_MODES = ("compressed", "original", "both")
