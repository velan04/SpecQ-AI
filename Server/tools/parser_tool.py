"""Parser Tool — reads testcase.js and description.txt from disk.
NOTE: Does NOT strip base64 images. OCR needs the raw content.
      Base64 stripping happens in main.py AFTER OCR runs (via text_cleaner.py).
"""
import os
import logging

logger = logging.getLogger(__name__)


def read_file(filepath: str) -> str:
    """Read a file and return its contents as a string."""
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    logger.info("Read %d chars from %s", len(content), filepath)
    return content


def read_testcase(testcase_path: str) -> str:
    return read_file(testcase_path)


def read_description(description_path: str) -> str:
    """Read description file as-is. Base64 stripping happens AFTER OCR."""
    return read_file(description_path)