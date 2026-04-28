"""
Image Store
===========
Handles S3 upload and pre-signed URL generation for description images.

Flow:
  1. extract_images_dom_order() — BeautifulSoup DOM-order extraction (preserves layout order)
  2. _compress_image()          — Pillow resize 1024px + JPEG Q80 before upload
  3. upload_images()            — put_object to S3, generate pre-signed URL per image
  4. delete_images()            — best-effort cleanup after pipeline completes

When IMAGE_UPLOAD_ENABLED=false (default), upload_images() returns [] and the
solution_generator_agent falls back to compressed base64.

Required .env keys when enabled:
  IMAGE_UPLOAD_ENABLED=true
  S3_BUCKET_NAME=my-qc-images
  S3_REGION=ap-south-1
  AWS_ACCESS_KEY_ID=AKIA...
  AWS_SECRET_ACCESS_KEY=...

Bucket setup (one-time, no public policy needed):
  - Keep Block Public Access ON (private bucket)
  - IAM user needs: s3:PutObject + s3:DeleteObject + s3:GetObject on the bucket
  - Pre-signed URLs bypass Block Public Access automatically
"""
import base64
import io
import logging
from typing import List, Optional
from uuid import uuid4

from bs4 import BeautifulSoup
from PIL import Image

from config.settings import (
    IMAGE_UPLOAD_ENABLED,
    S3_BUCKET_NAME,
    S3_REGION,
    AWS_ACCESS_KEY_ID_S3,
    AWS_SECRET_ACCESS_KEY_S3,
    S3_IMAGE_PREFIX,
    S3_PRESIGN_EXPIRES_SECS,
    MAX_IMAGES_SOLUTION,
)

logger = logging.getLogger(__name__)

# ── Compression constants (same as solution_generator_agent) ─────────────────
_MAX_SIDE_PX    = 1024
_MAX_SIZE_BYTES = 400_000
_JPEG_QUALITY   = 80

# Module-level key map for cleanup: presigned_url_prefix → s3_key
# We store the key portion only (before the "?" query string in presigned URLs)
_uploaded_keys: dict[str, str] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def extract_images_dom_order(html: str, max_images: int = MAX_IMAGES_SOLUTION) -> List[str]:
    """
    Extract up to max_images base64 data URIs from <img> tags in DOM order.

    Uses BeautifulSoup so the sequence matches the visual layout of the page
    (regex findall doesn't guarantee document order for complex HTML).

    Returns list of full data URIs: "data:image/TYPE;base64,XXXX..."
    """
    soup = BeautifulSoup(html, "lxml")
    results = []
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src.lower().startswith("data:image/"):
            results.append(src)
            if len(results) >= max_images:
                break
    logger.info("extract_images_dom_order: found %d image(s) in DOM order.", len(results))
    return results


def upload_images(html: str) -> List[str]:
    """
    Extract images from description HTML, compress them, upload to S3,
    and return a list of pre-signed HTTPS URLs.

    Returns [] if IMAGE_UPLOAD_ENABLED=false, S3 not configured, or boto3
    unavailable — callers fall back to compressed base64 in that case.
    """
    if not IMAGE_UPLOAD_ENABLED:
        logger.info("IMAGE_UPLOAD_ENABLED=false — skipping S3 upload.")
        return []

    if not S3_BUCKET_NAME:
        logger.warning("S3_BUCKET_NAME not set — skipping S3 upload.")
        return []

    try:
        import boto3  # lazy import — only needed when S3 enabled
    except ImportError:
        logger.warning("boto3 not installed — skipping S3 upload. Run: pip install boto3")
        return []

    raw_images = extract_images_dom_order(html, MAX_IMAGES_SOLUTION)
    if not raw_images:
        logger.info("No images found in description — nothing to upload.")
        return []

    s3 = _get_s3_client(boto3)
    presigned_urls: List[str] = []

    for idx, data_uri in enumerate(raw_images, start=1):
        jpeg_bytes = _compress_image(data_uri)
        if jpeg_bytes is None:
            logger.warning("Image %d: compression failed — skipping.", idx)
            continue

        key = f"{S3_IMAGE_PREFIX}{uuid4()}.jpg"
        try:
            s3.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=key,
                Body=jpeg_bytes,
                ContentType="image/jpeg",
            )
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET_NAME, "Key": key},
                ExpiresIn=S3_PRESIGN_EXPIRES_SECS,
            )
            # Store key for cleanup (strip query-string from URL for the dict key)
            url_base = url.split("?")[0]
            _uploaded_keys[url_base] = key

            presigned_urls.append(url)
            logger.info(
                "Image %d/%d uploaded → s3://%s/%s  (presigned, expires %ds)",
                idx, len(raw_images), S3_BUCKET_NAME, key, S3_PRESIGN_EXPIRES_SECS,
            )
        except Exception as exc:
            logger.warning("Image %d: S3 upload failed (%s) — skipping.", idx, exc)

    logger.info("S3 upload complete: %d/%d image(s) uploaded.", len(presigned_urls), len(raw_images))
    return presigned_urls


def delete_images(urls: List[str]) -> None:
    """
    Delete S3 objects for the given presigned URLs. Best-effort — errors are
    logged but never raised (cleanup must not break the pipeline result).
    """
    if not urls:
        return

    try:
        import boto3
    except ImportError:
        logger.warning("boto3 not installed — cannot clean up S3 images.")
        return

    s3 = _get_s3_client(boto3)
    deleted = 0
    for url in urls:
        url_base = url.split("?")[0]
        key = _uploaded_keys.get(url_base) or _key_from_url(url_base)
        if not key:
            logger.warning("delete_images: cannot resolve S3 key for URL — skipping.")
            continue
        try:
            s3.delete_object(Bucket=S3_BUCKET_NAME, Key=key)
            _uploaded_keys.pop(url_base, None)
            deleted += 1
        except Exception as exc:
            logger.warning("delete_images: failed to delete key=%s (%s).", key, exc)

    logger.info("S3 cleanup: deleted %d/%d image(s).", deleted, len(urls))


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_s3_client(boto3):
    return boto3.client(
        "s3",
        region_name=S3_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID_S3,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY_S3,
    )


def _key_from_url(url_base: str) -> Optional[str]:
    """
    Fallback: parse S3 key from the URL path when the module-level map misses it.
    Works for path-style URLs: https://bucket.s3.region.amazonaws.com/key
    """
    try:
        from urllib.parse import urlparse
        path = urlparse(url_base).path.lstrip("/")
        # For virtual-hosted URLs (bucket.s3.region.amazonaws.com/key)
        # the path IS the key
        return path if path else None
    except Exception:
        return None


def _compress_image(data_uri: str) -> Optional[bytes]:
    """
    Decode a base64 data URI, resize to _MAX_SIDE_PX on longest side,
    re-encode as JPEG quality=_JPEG_QUALITY.

    Returns raw JPEG bytes, or None if compression fails or result > _MAX_SIZE_BYTES.
    """
    try:
        _header, b64 = data_uri.split(",", 1)
        raw_bytes = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")

        w, h = img.size
        if max(w, h) > _MAX_SIDE_PX:
            scale = _MAX_SIDE_PX / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        compressed = buf.getvalue()

        if len(compressed) > _MAX_SIZE_BYTES:
            logger.warning(
                "_compress_image: %d bytes after compression exceeds limit — skipping.",
                len(compressed),
            )
            return None

        logger.debug(
            "_compress_image: %d → %d bytes (%.1f%% reduction)",
            len(raw_bytes), len(compressed),
            100.0 * (1 - len(compressed) / max(len(raw_bytes), 1)),
        )
        return compressed

    except Exception as exc:
        logger.warning("_compress_image failed: %s", exc)
        return None
