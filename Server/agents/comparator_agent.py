"""Agent 4 — Semantic Comparator (fully generic, no hardcoded verdicts)"""
import json
import logging
import re
from typing import Any, Dict

from config.settings import (
    GROQ_API_KEYS, GROQ_MODEL_COMPARATOR, MAX_TOKENS_COMPARATOR,
    MAX_RETRIES, COMPARATOR_BATCH_SIZE,
)
from tools.key_rotator import KeyRotator
from prompts.comparator_prompt import COMPARATOR_SYSTEM, COMPARATOR_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)


class ComparatorAgent:

    def __init__(self):
        # Use MAX_TOKENS_COMPARATOR (not MAX_TOKENS_STRONG) so that
        # input_tokens + max_output_tokens stays under Groq's 12 000-token
        # per-request hard limit for llama-3.3-70b-versatile on the free tier.
        self.rotator = KeyRotator(GROQ_API_KEYS, GROQ_MODEL_COMPARATOR, MAX_TOKENS_COMPARATOR)
        logger.info("ComparatorAgent ready (%d key(s), max_tokens=%d)", len(GROQ_API_KEYS), MAX_TOKENS_COMPARATOR)

    def compare(
        self,
        testcase_requirements:    Dict[str, Any],
        description_requirements: Dict[str, Any],
    ) -> Dict[str, Any]:

        all_testcases  = testcase_requirements.get("testcases", [])
        total_count    = len(all_testcases)

        # ── Batch processing ──────────────────────────────────────────────────
        # Split testcases into chunks so each API call stays under the
        # 12 000-token combined (input + output) request limit.
        batches = [
            all_testcases[i : i + COMPARATOR_BATCH_SIZE]
            for i in range(0, max(total_count, 1), COMPARATOR_BATCH_SIZE)
        ]
        logger.info(
            "ComparatorAgent: %d testcase(s) split into %d batch(es) of ≤%d",
            total_count, len(batches), COMPARATOR_BATCH_SIZE,
        )

        all_coverage: list = []
        for batch_idx, batch in enumerate(batches, start=1):
            batch_reqs = {**testcase_requirements, "testcases": batch}
            batch_coverage = self._compare_batch(
                batch_idx, len(batches), batch_reqs, description_requirements
            )
            all_coverage.extend(batch_coverage)

        # ── Rebuild summary from merged coverage ──────────────────────────────
        covered  = [t for t in all_coverage if t.get("status") == "covered"]
        partial  = [t for t in all_coverage if t.get("status") == "partial"]
        not_desc = [t for t in all_coverage if t.get("status") == "not_in_description"]
        conflicts = [t for t in all_coverage if t.get("spec_conflict")]
        logger.info(
            "Comparison done — %d covered, %d partial, %d not_in_description",
            len(covered), len(partial), len(not_desc),
        )
        return {
            "testcase_coverage": all_coverage,
            "summary": {
                "total_testcases":        total_count,
                "covered_in_description": len(covered),
                "partial_in_description": len(partial),
                "not_in_description":     len(not_desc),
                "spec_conflicts":         len(conflicts),
            },
        }

    # ── Private helpers ───────────────────────────────────────────────────────

    def _compare_batch(
        self,
        batch_idx:                int,
        total_batches:            int,
        testcase_requirements:    Dict[str, Any],
        description_requirements: Dict[str, Any],
    ) -> list:
        """Run a single batch and return its testcase_coverage list."""
        testcase_count = len(testcase_requirements.get("testcases", []))

        user_msg = COMPARATOR_USER.format(
            testcase_count=testcase_count,
            testcase_requirements=json.dumps(testcase_requirements,    indent=2),
            description_requirements=json.dumps(description_requirements, indent=2),
        )
        messages = [
            SystemMessage(content=COMPARATOR_SYSTEM),
            HumanMessage(content=user_msg),
        ]

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info(
                    "ComparatorAgent batch %d/%d: attempt %d/%d (testcases=%d)",
                    batch_idx, total_batches, attempt, MAX_RETRIES, testcase_count,
                )
                raw    = self.rotator.invoke_with_rotation(messages)
                result = _parse_json_robust(raw)

                coverage = result.get("testcase_coverage", [])
                if len(coverage) < testcase_count:
                    logger.warning(
                        "Batch %d returned %d results for %d testcases — retrying",
                        batch_idx, len(coverage), testcase_count,
                    )
                    if attempt < MAX_RETRIES:
                        continue
                    else:
                        logger.warning("Proceeding with partial results after %d attempts", MAX_RETRIES)

                return coverage

            except Exception as e:
                logger.warning("Batch %d attempt %d failed: %s", batch_idx, attempt, e)
                if attempt == MAX_RETRIES:
                    raise RuntimeError(f"ComparatorAgent failed: {e}")

        return []


def _parse_json_robust(raw: str) -> Dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned, flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    repaired = _repair(cleaned)
    if repaired:
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass
    raise ValueError(f"JSON parse failed.\nFirst 300 chars:\n{raw[:300]}")


def _repair(text: str) -> str:
    text = re.sub(r",\s*$", "", text.rstrip())
    ob  = text.count("{") - text.count("}")
    ob2 = text.count("[") - text.count("]")
    last = text[-1] if text else ""
    if last not in ('"', "}", "]"):
        in_str = sum(1 for c in text if c == '"') % 2 == 1
        if in_str:
            text += '"'
    text = re.sub(r",\s*$", "", text.rstrip())
    text += "]" * max(0, ob2)
    text += "}" * max(0, ob)
    return text