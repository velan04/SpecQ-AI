"""
Failure Analyzer Agent
======================
For each FAILED testcase, analyzes why it failed:
  - description_gap:     spec never mentioned this requirement
  - implementation_error: AI generated wrong/missing code
  - both:                spec gap AND implementation error
"""
import json
import logging
import re
from typing import Any, Dict, List

from config.settings import (
    GROQ_API_KEYS_FAILURE, GROQ_MODEL_FAILURE, MAX_TOKENS_FAILURE, MAX_RETRIES,
)
from tools.key_rotator import KeyRotator
from prompts.failure_analyzer_prompt import FAILURE_SYSTEM, FAILURE_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)


class FailureAnalyzerAgent:

    def __init__(self):
        self.rotator = KeyRotator(
            GROQ_API_KEYS_FAILURE,
            GROQ_MODEL_FAILURE,
            MAX_TOKENS_FAILURE,
        )
        logger.info("FailureAnalyzerAgent ready (%d key(s))", len(GROQ_API_KEYS_FAILURE))

    def analyze(
        self,
        failed_tests:        List[Dict],
        description_content: str,
        generated_files:     Dict[str, str],
        testcase_content:    str,
    ) -> List[Dict]:
        """
        Analyze each failed test.

        Args:
            failed_tests:        list of {id, name, status, error_message} dicts (FAIL only)
            description_content: clean description text (no base64)
            generated_files:     {"index.html": "...", "style.css": "...", "script.js": "..."}
            testcase_content:    raw testcase.js content

        Returns:
            List of dicts per failed test:
            [{id, name, category, description_gap, description_gap_detail,
              implementation_detail, code_snippet}, ...]
        """
        if not failed_tests:
            logger.info("No failures to analyze.")
            return []

        analyses = []
        for test in failed_tests:
            logger.info("Analyzing failure: %s", test["id"])
            result = self._analyze_one(
                test, description_content, generated_files, testcase_content
            )
            analyses.append(result)

        return analyses

    # ── Private ───────────────────────────────────────────────────────────────

    def _analyze_one(
        self,
        test:                Dict,
        description:         str,
        generated_files:     Dict[str, str],
        testcase_content:    str,
    ) -> Dict:
        tc_block = _extract_test_block(test["id"], testcase_content)

        user_msg = FAILURE_USER.format(
            test_id=test["id"],
            test_name=test["name"],
            error_message=test.get("error_message") or "No error captured",
            test_block=tc_block,
            generated_html=generated_files.get("index.html", "")[:3000],
            generated_css=generated_files.get("style.css", "")[:3000],
            generated_js=generated_files.get("script.js", "")[:2000],
            description=description[:5000],
        )
        messages = [
            SystemMessage(content=FAILURE_SYSTEM),
            HumanMessage(content=user_msg),
        ]

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                raw    = self.rotator.invoke_with_rotation(messages)
                result = _parse_analysis(raw)
                result["id"]   = test["id"]
                result["name"] = test["name"]
                return result
            except Exception as e:
                logger.warning(
                    "FailureAnalyzerAgent attempt %d/%d failed for %s: %s",
                    attempt, MAX_RETRIES, test["id"], e,
                )
                if attempt == MAX_RETRIES:
                    return _fallback_analysis(test)

        return _fallback_analysis(test)


# ── Module-level helpers ──────────────────────────────────────────────────────

def _extract_test_block(test_id: str, source: str) -> str:
    """Extract ~40 lines around the TESTCASE:test_id: log call in testcase.js."""
    lines   = source.splitlines()
    target  = f"TESTCASE:{test_id}:"
    found_at = None
    for i, line in enumerate(lines):
        if target in line:
            found_at = i
            break
    if found_at is None:
        return f"// Test block for '{test_id}' not found in testcase.js"

    start = max(0, found_at - 30)
    end   = min(len(lines), found_at + 10)
    return "\n".join(lines[start:end])


def _parse_analysis(raw: str) -> Dict:
    cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    m = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return _fallback_analysis({})


def _fallback_analysis(test: Dict) -> Dict:
    return {
        "id":                     test.get("id",   "unknown"),
        "name":                   test.get("name", "unknown"),
        "category":               "implementation_error",
        "description_gap":        False,
        "description_gap_detail": "",
        "implementation_detail":  "Analysis could not be completed automatically.",
        "fix_suggestion":         "Manual review required.",
        "code_snippet":           "",
    }
