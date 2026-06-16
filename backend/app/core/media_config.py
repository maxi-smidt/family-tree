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
