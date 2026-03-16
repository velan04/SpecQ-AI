"""
OCR Tool — extracts text from images using HuggingFace PaddleOCR API.
Supports:
  1. Base64-encoded images embedded in description HTML (data:image/... URIs)
  2. Image files in a directory (ocr_images/)
"""
import os
import re
import glob
import base64
import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# ── HuggingFace PaddleOCR API ─────────────────────────────────────────────────
OCR_API_URL   = os.getenv("OCR_API_URL", "https://velan2904-image-ocr.hf.space/ocr")
MAX_RETRIES   = 4
BASE_DELAY_S  = 5   # 5s, 10s, 15s, 20s
TIMEOUT_S     = 120 # covers cold start + queue wait


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_images(images_dir: str) -> str:
    """Extract text from image FILES in a directory via HuggingFace OCR."""
    if not os.path.isdir(images_dir):
        logger.warning("OCR images directory not found: %s", images_dir)
        return ""

    image_files = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp"):
        image_files.extend(glob.glob(os.path.join(images_dir, ext)))

    if not image_files:
        logger.info("No image files found for OCR.")
        return ""

    logger.info("Found %d image(s) for OCR.", len(image_files))
    combined = []
    for img_path in sorted(image_files):
        text = _ocr_file(img_path)
        if text.strip():
            combined.append(f"[Image: {Path(img_path).name}]\n{text.strip()}")
    return "\n\n".join(combined)


def extract_base64_images_from_text(html: str) -> str:
    """
    Find all base64-encoded <img> tags in HTML description text,
    send each to HuggingFace PaddleOCR, and return combined extracted text.
    Sequential — one image at a time to avoid overloading the queue.
    """
    # Match <img ... src="data:image/TYPE;base64,DATA" ...>
    img_tag_re = re.compile(r'<img\b[^>]*>', re.IGNORECASE)
    src_re     = re.compile(
        r'src=["\']?(data:image/[^"\';\s]+;base64,[A-Za-z0-9+/=]+)["\']?',
        re.IGNORECASE
    )

    img_tags = img_tag_re.findall(html)
    if not img_tags:
        logger.info("No base64 images found embedded in description text.")
        return ""

    logger.info("Found %d image(s) embedded in description.", len(img_tags))
    results = []

    for idx, img_tag in enumerate(img_tags, start=1):
        src_match = src_re.search(img_tag)
        if not src_match:
            logger.debug("Image %d: no src data URI found, skipping.", idx)
            continue

        data_url = src_match.group(1)
        # Extract pure base64 from data:image/TYPE;base64,DATA
        pure_b64 = data_url.split(",", 1)[1] if "," in data_url else data_url

        text = _ocr_base64_api(pure_b64, idx)
        if text.strip():
            results.append(f"[Image {idx} OCR Text:\n{text.strip()}]")
            logger.info("Image %d: extracted %d chars.", idx, len(text))
        else:
            logger.warning("Image %d: OCR returned empty text.", idx)

    combined = "\n\n".join(results)
    logger.info("Base64 OCR total: %d chars from %d image(s).", len(combined), len(results))
    return combined


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ocr_base64_api(pure_b64: str, index: int = 1) -> str:
    """Send pure base64 string to HuggingFace PaddleOCR API with retry."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("[OCR] Image %d — attempt %d/%d", index, attempt, MAX_RETRIES)
            resp = requests.post(
                OCR_API_URL,
                json={"image": pure_b64},
                headers={"Content-Type": "application/json"},
                timeout=TIMEOUT_S,
            )

            if resp.status_code == 200:
                text = (resp.json().get("text") or "").strip()
                logger.info("[OCR] Image %d done ✓ (%d chars)", index, len(text))
                return text

            elif resp.status_code == 503:
                logger.warning("[OCR] Image %d: queue full (503), retrying...", index)
            elif resp.status_code in (502, 504):
                logger.warning("[OCR] Image %d: gateway timeout (%d), retrying...", index, resp.status_code)
            else:
                logger.warning("[OCR] Image %d: unexpected status %d", index, resp.status_code)

        except requests.Timeout:
            logger.warning("[OCR] Image %d: request timed out, retrying...", index)
        except requests.RequestException as e:
            logger.warning("[OCR] Image %d: request error: %s", index, e)

        if attempt < MAX_RETRIES:
            delay = BASE_DELAY_S * attempt
            logger.info("[OCR] Retrying image %d in %ds...", index, delay)
            time.sleep(delay)

    logger.error("[OCR] Image %d: all %d attempts failed.", index, MAX_RETRIES)
    return ""


def _ocr_file(img_path: str) -> str:
    """Read an image file, encode as base64, send to HuggingFace OCR API."""
    try:
        with open(img_path, "rb") as f:
            raw = f.read()
        pure_b64 = base64.b64encode(raw).decode("utf-8")
        return _ocr_base64_api(pure_b64, index=0)
    except Exception as e:
        logger.warning("Failed to read/encode image file %s: %s", img_path, e)
        return ""