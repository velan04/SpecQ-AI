"""
Description Scorer Agent
========================
Scores the project description on four QC parameters (1–5 each).
Uses the same Groq key pool as the failure analyzer (runs sequentially, no conflict).
"""
import json
import logging
import re
from typing import Dict

from config.settings import (
    GROQ_API_KEYS_FAILURE, GROQ_MODEL_FAILURE, MAX_TOKENS_FAILURE, MAX_RETRIES,
)
from tools.key_rotator import KeyRotator
from tools.text_cleaner import strip_base64_images
from prompts.description_scorer_prompt import SCORER_SYSTEM, SCORER_USER
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

_PARAMS = [
    ("p1", "Milestone / Deliverable Def.", False),
    ("p2", "Expected Output Clarity",      False),
    ("p3", "Execution Instruction Clarity", True),   # ★ Critical
    ("p4", "Difficulty vs Effort Calibration", False),
]

_BANDS = {
    5: ("Excellent",   "A"),
    4: ("Good",        "A/B"),
    3: ("Acceptable",  "B/C"),
    2: ("Needs Work",  "C/D"),
    1: ("Reject",      "D only"),
}

_ACTIONS = {
    5: "None required",
    4: "Optional improvement",
    3: "Fix & re-review",
    2: "Return to author",
    1: "Reject / recreate",
}


class DescriptionScorerAgent:

    def __init__(self):
        self.rotator = KeyRotator(
            GROQ_API_KEYS_FAILURE,
            GROQ_MODEL_FAILURE,
            MAX_TOKENS_FAILURE,
        )
        logger.info("DescriptionScorerAgent ready (%d key(s))", len(GROQ_API_KEYS_FAILURE))

    def score(self, description_content: str) -> Dict:
        """
        Score the description on 4 parameters.

        Returns:
            {
              "p1_score": int, "p1_justification": str, "p1_action": str,
              "p2_score": int, "p2_justification": str, "p2_action": str,
              "p3_score": int, "p3_justification": str, "p3_action": str,
              "p4_score": int, "p4_justification": str, "p4_action": str,
              "overall_grade": str, "overall_summary": str,
              "params": [enriched param list for Excel]
            }
        """
        clean = strip_base64_images(description_content)[:6000]
        messages = [
            SystemMessage(content=SCORER_SYSTEM),
            HumanMessage(content=SCORER_USER.format(description=clean)),
        ]

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                raw    = self.rotator.invoke_with_rotation(messages)
                result = _parse_scores(raw)
                result["params"] = _enrich_params(result)
                logger.info(
                    "Description scored — P1:%d P2:%d P3:%d P4:%d  Grade:%s",
                    result["p1_score"], result["p2_score"],
                    result["p3_score"], result["p4_score"],
                    result["overall_grade"],
                )
                return result
            except Exception as e:
                logger.warning("DescriptionScorerAgent attempt %d/%d failed: %s", attempt, MAX_RETRIES, e)
                if attempt == MAX_RETRIES:
                    return _fallback_scores()

        return _fallback_scores()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_scores(raw: str) -> Dict:
    cleaned = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned, flags=re.MULTILINE).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if m:
            data = json.loads(m.group())
        else:
            return _fallback_scores()

    # Clamp all scores to 1-5
    for key in ("p1_score", "p2_score", "p3_score", "p4_score"):
        data[key] = max(1, min(5, int(data.get(key, 3))))

    # Re-derive grade from scores to ensure consistency
    data["overall_grade"] = _derive_grade(
        data["p1_score"], data["p2_score"], data["p3_score"], data["p4_score"]
    )
    return data


def _enrich_params(result: Dict) -> list:
    rows = []
    for code, name, critical in _PARAMS:
        score  = result.get(f"{code}_score", 3)
        band, max_grade = _BANDS.get(score, ("Acceptable", "B/C"))
        rows.append({
            "code":          code.upper(),
            "name":          name,
            "critical":      critical,
            "score":         score,
            "band":          band,
            "max_grade":     max_grade,
            "action":        _ACTIONS.get(score, "Fix & re-review"),
            "justification": result.get(f"{code}_justification", ""),
            "author_action": result.get(f"{code}_action", ""),
        })
    return rows


def _derive_grade(p1: int, p2: int, p3: int, p4: int) -> str:
    if p3 == 1:
        return "D"
    avg = (p1 + p2 + p3 + p4) / 4
    if avg >= 4.5:
        return "A"
    if avg >= 3.5:
        return "B"
    if avg >= 2.5:
        return "C"
    return "D"


def _fallback_scores() -> Dict:
    result = {
        "p1_score": 3, "p1_justification": "Could not be scored automatically.", "p1_action": "Manual review required",
        "p2_score": 3, "p2_justification": "Could not be scored automatically.", "p2_action": "Manual review required",
        "p3_score": 3, "p3_justification": "Could not be scored automatically.", "p3_action": "Manual review required",
        "p4_score": 3, "p4_justification": "Could not be scored automatically.", "p4_action": "Manual review required",
        "overall_grade": "C",
        "overall_summary": "Automated scoring failed — manual review required.",
    }
    result["params"] = _enrich_params(result)
    return result
