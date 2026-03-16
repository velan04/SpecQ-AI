"""Agent 4 — Semantic Comparator (fully generic, no hardcoded verdicts)"""
import json
import logging
import re
from typing import Any, Dict

from config.settings import GROQ_API_KEYS, GROQ_MODEL_STRONG, MAX_TOKENS_STRONG, MAX_RETRIES
from tools.key_rotator import KeyRotator
from prompts.comparator_prompt import COMPARATOR_SYSTEM, COMPARATOR_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)


class ComparatorAgent:

    def __init__(self):
        self.rotator = KeyRotator(GROQ_API_KEYS, GROQ_MODEL_STRONG, MAX_TOKENS_STRONG)
        logger.info("ComparatorAgent ready (%d key(s))", len(GROQ_API_KEYS))

    def compare(
        self,
        testcase_requirements:    Dict[str, Any],
        description_requirements: Dict[str, Any],
    ) -> Dict[str, Any]:

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
                logger.info("ComparatorAgent: attempt %d/%d (testcases=%d)", attempt, MAX_RETRIES, testcase_count)
                raw    = self.rotator.invoke_with_rotation(messages)
                result = _parse_json_robust(raw)

                # Validate all testcases were processed
                coverage = result.get("testcase_coverage", [])
                if len(coverage) < testcase_count:
                    logger.warning(
                        "ComparatorAgent returned %d results for %d testcases — retrying",
                        len(coverage), testcase_count
                    )
                    if attempt < MAX_RETRIES:
                        continue
                    else:
                        logger.warning("Proceeding with partial results after %d attempts", MAX_RETRIES)

                covered  = [t for t in coverage if t.get("status") == "covered"]
                partial  = [t for t in coverage if t.get("status") == "partial"]
                not_desc = [t for t in coverage if t.get("status") == "not_in_description"]
                logger.info(
                    "Comparison done — %d covered, %d partial, %d not_in_description",
                    len(covered), len(partial), len(not_desc),
                )
                return result

            except Exception as e:
                logger.warning("Attempt %d failed: %s", attempt, e)
                if attempt == MAX_RETRIES:
                    raise RuntimeError(f"ComparatorAgent failed: {e}")

        return {"testcase_coverage": [], "summary": {}}


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