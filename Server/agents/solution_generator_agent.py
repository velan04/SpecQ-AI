"""
Solution Generator Agent
=========================
Reads description + OCR text + testcase.js content.
Extracts all CSS selectors from testcase.js as hints so the LLM knows
exactly which element IDs and classes must exist.

When the description contains base64-embedded images, extracts and compresses
them (Pillow: resize to 1024px, re-encode as JPEG) then passes them directly
to a Groq vision model so the LLM can see the actual design — not just OCR text.

Falls back to text-only model when no images are present or vision keys exhausted.

Generates complete index.html, style.css, script.js.
Writes generated files into scaffolding/public/.
"""
import base64
import io
import json
import logging
import os
import re
from typing import Dict, List, Optional

from PIL import Image

from config.settings import (
    GROQ_API_KEYS_SOLUTION, GROQ_MODEL_SOLUTION, MAX_TOKENS_SOLUTION, MAX_RETRIES,
    GROQ_MODEL_SOLUTION_VISION, MAX_IMAGES_SOLUTION,
    KIMI_ENABLED, KIMI_API_KEY, KIMI_API_BASE, KIMI_MODEL, KIMI_MAX_TOKENS,
)
from tools.key_rotator import KeyRotator
from tools.text_cleaner import strip_base64_images
from prompts.solution_generator_prompt import SOLUTION_SYSTEM, SOLUTION_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

# ── Image compression constants ───────────────────────────────────────────────
_MAX_SIDE_PX    = 1024      # resize to this on the longest dimension
_MAX_SIZE_BYTES = 400_000   # skip image if still larger than this after compression
_JPEG_QUALITY   = 80


class SolutionGeneratorAgent:

    def __init__(self):
        self.rotator = KeyRotator(
            GROQ_API_KEYS_SOLUTION,
            GROQ_MODEL_SOLUTION,
            MAX_TOKENS_SOLUTION,
        )
        self.rotator_vision = KeyRotator(
            GROQ_API_KEYS_SOLUTION,
            GROQ_MODEL_SOLUTION_VISION,
            MAX_TOKENS_SOLUTION,
        )
        if KIMI_ENABLED:
            masked = (KIMI_API_KEY[:6] + "..." + KIMI_API_KEY[-4:]) if len(KIMI_API_KEY) > 10 else "(too short!)"
            logger.info(
                "SolutionGeneratorAgent ready — text=Kimi(%s)  base=%s  key=%s  vision=Groq(%s)",
                KIMI_MODEL, KIMI_API_BASE, masked, GROQ_MODEL_SOLUTION_VISION,
            )
        else:
            logger.info(
                "SolutionGeneratorAgent ready (%d key(s)) — text=Groq(%s)  vision=Groq(%s)",
                len(GROQ_API_KEYS_SOLUTION), GROQ_MODEL_SOLUTION, GROQ_MODEL_SOLUTION_VISION,
            )

    def generate(
        self,
        description_content: str,
        ocr_text: str,
        testcase_content: str,
        public_dir: str,
        image_urls: Optional[List[str]] = None,
    ) -> Dict[str, str]:
        """
        Generate web solution files and write them to public_dir.

        image_urls: pre-signed S3 URLs from node_ocr_extract (preferred).
                    When None or empty, falls back to compressed base64 extraction.

        Retry strategy on 413 (payload too large):
            Drop the last image and retry, down to 1 image, then fall back to text-only.

        Returns:
            {"index.html": "<content>", "style.css": "<content>", "script.js": "<content>"}
        """
        # ── Step 1: resolve images — S3 URLs preferred, base64 as fallback ────
        if image_urls:
            images = list(image_urls)
            has_images = True
            logger.info("Using %d S3 pre-signed URL(s) for vision LLM.", len(images))
        else:
            # Fallback: DOM-order extraction + compress from description HTML
            from tools.image_store import extract_images_dom_order
            raw_images = extract_images_dom_order(description_content, MAX_IMAGES_SOLUTION)
            images = [c for img in raw_images if (c := _compress_image(img)) is not None]
            has_images = bool(images)
            logger.info(
                "S3 URLs not available — base64 fallback: %d/%d image(s) usable.",
                len(images), len(raw_images),
            )

        # ── Step 2: prepare text context (description + OCR + images only) ──
        clean_desc  = strip_base64_images(description_content)[:8000]
        ocr_trimmed = (ocr_text or "None")[:5000]

        logger.info(
            "Solution prompt: desc=%d chars, ocr=%d chars — testcase hidden from AI",
            len(clean_desc), len(ocr_trimmed),
        )

        image_notice = (
            f"DESIGN IMAGES: {len(images)} design image(s) are attached below. "
            "They are the authoritative visual reference — match colors, layout, "
            "spacing, and typography exactly as shown in the images."
        ) if has_images else "DESIGN IMAGES: No design images were found in the description."

        # ── Step 3: format prompt — testcase is completely hidden from AI ────
        user_text = SOLUTION_USER.format(
            description=clean_desc,
            ocr_text=ocr_trimmed,
            image_notice=image_notice,
        )

        # ── Step 4: Groq text messages (fallback only) ────────────────────────
        lc_messages = [
            SystemMessage(content=SOLUTION_SYSTEM),
            HumanMessage(content=user_text),
        ]

        # ── Step 5: invoke with retry chain ───────────────────────────────────
        _kimi_available = KIMI_ENABLED  # may be flipped False on connection error

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info("SolutionGeneratorAgent: attempt %d/%d", attempt, MAX_RETRIES)

                if _kimi_available:
                    # Kimi K2 handles EVERYTHING — text + images
                    raw = _call_kimi(SOLUTION_SYSTEM, user_text, images if has_images else [])
                else:
                    # Groq fallback (either KIMI_ENABLED=False or Kimi unreachable)
                    if has_images:
                        raw = self._invoke_vision_with_image_retry(images, user_text, lc_messages)
                    else:
                        raw = self.rotator.invoke_with_rotation(lc_messages)

                files = _parse_solution(raw)
                _write_files(files, public_dir)
                logger.info(
                    "Generated: index.html (%d chars), style.css (%d chars), script.js (%d chars)",
                    len(files.get("index.html", "")),
                    len(files.get("style.css",  "")),
                    len(files.get("script.js",  "")),
                )
                return files

            except Exception as e:
                err_str = str(e).lower()
                # Kimi unreachable / no balance / auth error → fall back to Groq immediately
                _kimi_fatal = (
                    "connection error" in err_str or "connectionerror" in err_str
                    or "connect" in err_str or "timeout" in err_str
                    or "name or service" in err_str
                    or "insufficient balance" in err_str or "suspended" in err_str
                    or "exceeded_current_quota" in err_str
                    or ("401" in err_str and "invalid" in err_str)
                )
                if _kimi_available and _kimi_fatal:
                    logger.warning(
                        "Kimi K2 unavailable (attempt %d): %s — "
                        "falling back to Groq for remaining attempts.", attempt, e
                    )
                    _kimi_available = False
                    continue  # retry immediately with Groq

                logger.warning("SolutionGeneratorAgent attempt %d failed: %s", attempt, e)
                if attempt == MAX_RETRIES:
                    raise RuntimeError(f"SolutionGeneratorAgent failed after {MAX_RETRIES} attempts: {e}")

        return {}

    def _invoke_vision_with_image_retry(
        self,
        images: List[str],
        user_text: str,
        lc_messages: list,
    ) -> str:
        """
        Groq vision fallback (used only when KIMI_ENABLED=False).
        Retries with N→N-1→1 images on 413, then falls back to Groq text.
        """
        imgs_to_try = list(images)

        while imgs_to_try:
            groq_msgs = _build_groq_messages(SOLUTION_SYSTEM, user_text, imgs_to_try)
            try:
                result = self.rotator_vision.invoke_vision_with_rotation(groq_msgs)
                logger.info("Groq vision succeeded with %d image(s).", len(imgs_to_try))
                return result
            except RuntimeError as ve:
                err = str(ve).lower()
                if "too large" in err or "413" in err:
                    imgs_to_try = imgs_to_try[:-1]
                    logger.warning("413 — retrying Groq vision with %d image(s).", len(imgs_to_try))
                elif "daily rate limit" in err:
                    logger.warning("Groq vision exhausted — falling back to Groq text.")
                    return self.rotator.invoke_with_rotation(lc_messages)
                else:
                    raise

        logger.warning("All Groq vision attempts failed — falling back to Groq text.")
        return self.rotator.invoke_with_rotation(lc_messages)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_selectors(testcase_content: str) -> list:
    """
    Statically extract all CSS selectors and IDs referenced in testcase.js.
    Used as hints for the AI so it generates matching elements.
    """
    patterns = [
        r'waitForSelector\([\'"]([^\'"]+)[\'"]\)',
        r'\$eval\([\'"]([^\'"]+)[\'"]\s*,',
        r'\.select\([\'"]([^\'"]+)[\'"]\s*,',
        r'\.type\([\'"]([^\'"]+)[\'"]\s*,',
        r'\.click\([\'"]([^\'"]+)[\'"]\)',
        r'querySelector\([\'"]([^\'"]+)[\'"]\)',
        r'\$\$eval\([\'"]([^\'"]+)[\'"]\s*,',
    ]
    found = []
    for pat in patterns:
        found.extend(re.findall(pat, testcase_content))

    # Deduplicate, preserve insertion order
    seen   = set()
    unique = []
    for s in found:
        if s not in seen:
            seen.add(s)
            unique.append(s)
    return unique


def _build_groq_messages(system: str, user_text: str, images: List[str]) -> list:
    """Build a Groq API native message list with text + image_url content blocks."""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": [
            {"type": "text", "text": user_text},
            *[{"type": "image_url", "image_url": {"url": img}} for img in images],
        ]},
    ]


def _compress_image(data_uri: str) -> Optional[str]:
    """
    Resize image to _MAX_SIDE_PX on its longest side and re-encode as JPEG.

    Returns a new data:image/jpeg;base64,... URI, or None if the image
    cannot be decoded, still exceeds _MAX_SIZE_BYTES after compression,
    or any other error occurs.

    Typical reduction: a 2–5 MB screen-capture PNG → 30–150 KB JPEG.
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
                "_compress_image: still %d bytes after compression — skipping image.",
                len(compressed),
            )
            return None

        new_b64 = base64.b64encode(compressed).decode()
        logger.info(
            "_compress_image: %d → %d bytes (%.1f%% reduction)",
            len(raw_bytes), len(compressed),
            100.0 * (1 - len(compressed) / max(len(raw_bytes), 1)),
        )
        return f"data:image/jpeg;base64,{new_b64}"

    except Exception as exc:
        logger.warning("_compress_image failed (%s) — skipping image.", exc)
        return None


def _call_kimi(system: str, user_text: str, images: Optional[List[str]] = None) -> str:
    """
    Call Kimi K2 via the OpenAI-compatible API.
    Kimi K2 is a coding-focused model — used as the primary generator
    when KIMI_ENABLED=true.

    When images (data-URI base64 strings or S3 URLs) are provided, they are
    passed as image_url content blocks so Kimi can see the visual design.
    """
    from openai import OpenAI
    client = OpenAI(api_key=KIMI_API_KEY, base_url=KIMI_API_BASE)

    if images:
        logger.info(
            "Calling Kimi K2 (%s) with %d image(s)  base_url=%s",
            KIMI_MODEL, len(images), KIMI_API_BASE,
        )
        user_content: object = [
            {"type": "text", "text": user_text},
            *[{"type": "image_url", "image_url": {"url": img}} for img in images],
        ]
    else:
        logger.info(
            "Calling Kimi K2 (%s) text-only  base_url=%s",
            KIMI_MODEL, KIMI_API_BASE,
        )
        user_content = user_text

    response = client.chat.completions.create(
        model=KIMI_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user_content},
        ],
        max_tokens=KIMI_MAX_TOKENS,
        temperature=1,
        top_p=0.95,
    )
    return response.choices[0].message.content.strip()


def _parse_solution(raw: str) -> Dict[str, str]:
    """
    Extract three file contents from the LLM response.

    Expected format (fenced code blocks tagged with filename):
        ```html [index.html]
        ...
        ```
        ```css [style.css]
        ...
        ```
        ```javascript [script.js]
        ...
        ```
    Falls back to JSON parsing if code blocks are not found.
    """
    files: Dict[str, str] = {}

    # Primary: named code blocks
    block_re = re.compile(
        r'```(?:html|css|javascript|js)?\s*\[?(index\.html|style\.css|script\.js)\]?\s*\n(.*?)```',
        re.DOTALL | re.IGNORECASE,
    )
    for m in block_re.finditer(raw):
        filename = m.group(1).lower()
        content  = m.group(2)
        files[filename] = content

    if len(files) < 3:
        # Fallback: unnamed code blocks in order html → css → js
        unnamed_re = re.compile(r'```(?:html|css|javascript|js)?\n(.*?)```', re.DOTALL)
        blocks = unnamed_re.findall(raw)
        suffixes = ["index.html", "style.css", "script.js"]
        for i, block in enumerate(blocks[:3]):
            key = suffixes[i]
            if key not in files:
                files[key] = block

    if len(files) < 3:
        # Last resort: JSON parsing
        try:
            cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
            cleaned = re.sub(r'\s*```\s*$', '', cleaned, flags=re.MULTILINE).strip()
            data = json.loads(cleaned)
            for key in ("index.html", "style.css", "script.js"):
                if key in data and key not in files:
                    files[key] = data[key]
        except Exception:
            pass

    if not files:
        raise ValueError(
            "SolutionGeneratorAgent: could not extract file contents from LLM response.\n"
            f"First 300 chars of response:\n{raw[:300]}"
        )

    return files


def _write_files(files: Dict[str, str], public_dir: str) -> None:
    os.makedirs(public_dir, exist_ok=True)
    for filename, content in files.items():
        path = os.path.join(public_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        logger.info("Wrote %s (%d chars)", path, len(content))
