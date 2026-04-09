"""
OCR Tool — extracts text from base64-encoded images embedded in description HTML.
Supports base64-encoded images embedded in description HTML (data:image/... URIs).
"""
import os
import re
import logging
import time

import requests

logger = logging.getLogger(__name__)

# ── HuggingFace PaddleOCR API ─────────────────────────────────────────────────
OCR_API_URL   = os.getenv("OCR_API_URL", "https://velan2904-image-ocr.hf.space/ocr")
HF_TOKEN      = os.getenv("HF_TOKEN", "")          # required for private Spaces
MAX_RETRIES   = 4
BASE_DELAY_S  = 5   # 5s, 10s, 15s, 20s
TIMEOUT_S     = 120 # covers cold start + queue wait


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

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
    headers = {"Content-Type": "application/json"}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    else:
        logger.warning("[OCR] HF_TOKEN not set — request may fail for private Spaces.")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("[OCR] Image %d — attempt %d/%d", index, attempt, MAX_RETRIES)
            resp = requests.post(
                OCR_API_URL,
                json={"image": pure_b64},
                headers=headers,
                timeout=TIMEOUT_S,
            )

            if resp.status_code == 200:
                text = (resp.json().get("text") or "").strip()
                logger.info("[OCR] Image %d done ✓ (%d chars)", index, len(text))
                return text

            elif resp.status_code == 404:
                # Endpoint doesn't exist — retrying won't help
                logger.error(
                    "[OCR] Image %d: endpoint returned 404 (not found). "
                    "Check OCR_API_URL in settings. Skipping OCR.",
                    index,
                )
                return ""

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