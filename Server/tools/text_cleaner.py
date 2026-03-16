"""Text Cleaner — strips base64 image data from description text.
Called AFTER OCR extraction so OCR still sees the raw base64 images.
Called BEFORE sending description to the LLM to avoid 413 Payload Too Large.
"""
import re
import logging

logger = logging.getLogger(__name__)

# Match src="data:image/...;base64,<blob>"
_BASE64_SRC_RE = re.compile(
    r'(src=["\']?)data:[^;]+;base64,[A-Za-z0-9+/=]+'
    r'(["\']?)',
    re.IGNORECASE,
)

# Match any remaining raw data URIs (100+ base64 chars)
_RAW_BASE64_RE = re.compile(
    r'data:[^;]+;base64,[A-Za-z0-9+/=]{100,}',
    re.IGNORECASE,
)


def strip_base64_images(text: str) -> str:
    """
    Remove base64-encoded image data from text, replacing with a short placeholder.
    Call this AFTER OCR has already processed the raw description.
    """
    original_len = len(text)
    text = _BASE64_SRC_RE.sub(r'\1[IMAGE_BASE64_STRIPPED]\2', text)
    text = _RAW_BASE64_RE.sub('[IMAGE_BASE64_STRIPPED]', text)
    stripped_len = len(text)
    if stripped_len < original_len:
        logger.info(
            "Stripped %d chars of base64 data from description (%d → %d chars).",
            original_len - stripped_len, original_len, stripped_len,
        )
    return text