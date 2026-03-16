"""
Coverage Analyzer (Agent 5)
Builds the final QC report from comparator output.
Handles spec_conflict field from the updated strict comparator.
"""
import json
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class CoverageAnalyzer:

    def analyze(
        self,
        comparator_result:        Dict[str, Any],
        testcase_requirements:    Dict[str, Any],
        description_requirements: Dict[str, Any],
    ) -> Dict[str, Any]:

        testcase_coverage = comparator_result.get("testcase_coverage", [])

        if not testcase_coverage:
            testcase_coverage = _rebuild_from_old_format(comparator_result, testcase_requirements)

        covered      = [t for t in testcase_coverage if t.get("status") == "covered"]
        partial      = [t for t in testcase_coverage if t.get("status") == "partial"]
        not_in_desc  = [t for t in testcase_coverage if t.get("status") == "not_in_description"]
        conflicts    = [t for t in testcase_coverage if t.get("spec_conflict") is True]

        total_tc   = len(testcase_requirements.get("testcases", []))
        total_desc = len(description_requirements.get("requirements", []))

        coverage_pct = round(
            ((len(covered) + 0.5 * len(partial)) / max(total_tc, 1)) * 100, 1
        )

        # Score: deduct for not_in_description (10pts), partial (3pts), conflict (15pts)
        score = 100.0
        score -= len(not_in_desc) * 10
        score -= len(partial) * 3
        score -= len(conflicts) * 15
        # Don't double-penalise conflicts that are already in not_in_desc
        score += min(len(conflicts), len(not_in_desc)) * 10
        score = max(0.0, min(100.0, score))

        # ── Per-testcase ──────────────────────────────────────────────────
        per_testcase = []
        for tc in testcase_coverage:
            per_testcase.append({
                "id":                     tc.get("testcase_id", ""),
                "name":                   tc.get("testcase_name", tc.get("testcase_id", "")),
                "status":                 tc.get("status", "unknown"),
                "spec_conflict":          tc.get("spec_conflict", False),
                "conflict_detail":        tc.get("conflict_detail", ""),
                "what_testcase_checks":   tc.get("what_testcase_checks", ""),
                "found_in_description":   tc.get("found_in_description", ""),
                "missing_from_description": tc.get("missing_from_description", []),
                "matched_desc_ids":       tc.get("matched_desc_ids", []),
            })

        llm_summary = comparator_result.get("summary", {})
        report = {
            "meta": {
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "project":      "Product Stock Tracker",
                "pipeline":     "qc-automation v1.0",
            },
            "summary": {
                "total_testcases":          total_tc,
                "total_desc_requirements":  total_desc,
                "covered_in_description":   llm_summary.get("covered_in_description",  len(covered)),
                "partial_in_description":   llm_summary.get("partial_in_description",  len(partial)),
                "not_in_description":       llm_summary.get("not_in_description",       len(not_in_desc)),
                "spec_conflicts":           llm_summary.get("spec_conflicts",           len(conflicts)),
                "coverage_percent":         coverage_pct,
                "quality_score":            round(score, 1),
                "verdict":                  _verdict(score),
            },
            "per_testcase": per_testcase,
            "spec_conflicts": [
                {
                    "id":             t.get("testcase_id"),
                    "name":           t.get("testcase_name", t.get("testcase_id")),
                    "conflict_detail":t.get("conflict_detail", ""),
                    "what_testcase_checks": t.get("what_testcase_checks", ""),
                }
                for t in conflicts
            ],
            "not_in_description": [
                {
                    "id":                   t.get("testcase_id"),
                    "name":                 t.get("testcase_name", t.get("testcase_id")),
                    "what_testcase_checks": t.get("what_testcase_checks", ""),
                    "reason":               t.get("found_in_description", ""),
                }
                for t in not_in_desc
            ],
        }

        logger.info(
            "Coverage: %d covered, %d partial, %d not_in_desc, %d conflicts | Score=%.1f | %s",
            len(covered), len(partial), len(not_in_desc), len(conflicts),
            score, _verdict(score),
        )
        return report

    def save_report(self, report: Dict[str, Any], path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        logger.info("QC report saved to %s", path)


# ── helpers ───────────────────────────────────────────────────────────────────

def _rebuild_from_old_format(comparator_result: Dict, tc_reqs: Dict) -> List[Dict]:
    matches  = {m["testcase_id"]: m for m in comparator_result.get("matches", [])}
    partials = {p["testcase_id"]: p for p in comparator_result.get("partial_matches", [])}
    extras   = {e["testcase_id"]: e for e in comparator_result.get("extras", [])}
    result = []
    for tc in tc_reqs.get("testcases", []):
        tid = tc["id"]
        if tid in matches:
            result.append({"testcase_id": tid, "testcase_name": tc.get("name", tid),
                "status": "covered", "spec_conflict": False, "conflict_detail": "",
                "what_testcase_checks": ", ".join(tc.get("what_it_checks", [])),
                "found_in_description": matches[tid].get("coverage_note", ""),
                "matched_desc_ids": matches[tid].get("matched_desc_ids", []),
                "missing_from_description": []})
        elif tid in partials:
            result.append({"testcase_id": tid, "testcase_name": tc.get("name", tid),
                "status": "partial", "spec_conflict": False, "conflict_detail": "",
                "what_testcase_checks": partials[tid].get("what_is_covered", ""),
                "found_in_description": partials[tid].get("what_is_missing", ""),
                "matched_desc_ids": partials[tid].get("matched_desc_ids", []),
                "missing_from_description": []})
        elif tid in extras:
            result.append({"testcase_id": tid, "testcase_name": tc.get("name", tid),
                "status": "not_in_description", "spec_conflict": False, "conflict_detail": "",
                "what_testcase_checks": ", ".join(tc.get("what_it_checks", [])),
                "found_in_description": extras[tid].get("reason", ""),
                "matched_desc_ids": [], "missing_from_description": []})
        else:
            result.append({"testcase_id": tid, "testcase_name": tc.get("name", tid),
                "status": "covered", "spec_conflict": False, "conflict_detail": "",
                "what_testcase_checks": ", ".join(tc.get("what_it_checks", [])),
                "found_in_description": "Assumed covered",
                "matched_desc_ids": [], "missing_from_description": []})
    return result


def _verdict(score: float) -> str:
    if score >= 90: return "PASS"
    if score >= 70: return "PASS WITH WARNINGS"
    if score >= 50: return "NEEDS IMPROVEMENT"
    return "FAIL"