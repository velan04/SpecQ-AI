"""Agent 2 — Testcase Requirement Extractor (with key rotation)"""
import json
import logging
import re
from typing import Any, Dict

from config.settings import GROQ_API_KEYS, GROQ_MODEL_FAST, MAX_TOKENS_FAST, MAX_RETRIES
from tools.key_rotator import KeyRotator
from prompts.testcase_prompt import TESTCASE_SYSTEM, TESTCASE_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)


class TestcaseExtractorAgent:

    def __init__(self):
        self.rotator = KeyRotator(GROQ_API_KEYS, GROQ_MODEL_FAST, MAX_TOKENS_FAST)
        logger.info("TestcaseExtractorAgent ready (%d key(s))", len(GROQ_API_KEYS))

    def extract(self, testcase_content: str) -> Dict[str, Any]:
        messages = [
            SystemMessage(content=TESTCASE_SYSTEM),
            HumanMessage(content=TESTCASE_USER.format(testcase_content=testcase_content)),
        ]
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info("TestcaseExtractorAgent: attempt %d/%d", attempt, MAX_RETRIES)
                raw    = self.rotator.invoke_with_rotation(messages)
                result = _parse_json_robust(raw)
                logger.info("Extracted %d testcase requirements.", len(result.get("testcases", [])))
                return result
            except Exception as e:
                logger.warning("Attempt %d failed: %s", attempt, e)
                if attempt == MAX_RETRIES:
                    raise RuntimeError(f"TestcaseExtractorAgent failed: {e}")
        return {"testcases": []}


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
    ob = text.count("{") - text.count("}")
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