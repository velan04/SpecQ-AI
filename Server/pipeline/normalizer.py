"""
Normalizer — cleans and standardises extracted requirement dicts
before they are passed to the comparator agent.
"""
import re
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def normalize_testcase_requirements(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise testcase requirement dicts."""
    testcases = raw.get("testcases", [])
    normalised = []
    for tc in testcases:
        normalised.append({
            "id":               _slugify(tc.get("id", "unknown")),
            "name":             tc.get("name", "").strip(),
            "category":         tc.get("category", "unknown").lower().strip(),
            "what_it_checks":   _ensure_list(tc.get("what_it_checks", [])),
            "selectors_used":   _ensure_list(tc.get("selectors_used", [])),
            "expected_values":  tc.get("expected_values", {}),
            "dom_interactions": _ensure_list(tc.get("dom_interactions", [])),
        })
    logger.info("Normalised %d testcase requirements.", len(normalised))
    return {"testcases": normalised}


def normalize_description_requirements(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalise description requirement dicts."""
    requirements = raw.get("requirements", [])
    normalised = []
    for req in requirements:
        normalised.append({
            "id":                    _slugify(req.get("id", "unknown")),
            "category":              req.get("category", "unknown").lower().strip(),
            "requirement":           req.get("requirement", "").strip(),
            "testable_assertion":    req.get("testable_assertion", "").strip(),
            "selectors_or_properties": _ensure_list(req.get("selectors_or_properties", [])),
            "expected_values":       req.get("expected_values", {}),
        })
    logger.info("Normalised %d description requirements.", len(normalised))
    return {"requirements": normalised}


# ── helpers ───────────────────────────────────────────────────────────────────

def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def _ensure_list(value: Any) -> List:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return [value] if value.strip() else []
    return []
