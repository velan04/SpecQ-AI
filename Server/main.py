"""
QC Automation Pipeline — Main Entry Point
=========================================
LangGraph-orchestrated multi-agent pipeline:

  [START]
     │
     ▼
  load_inputs          (reads testcase.js, description.txt)
     │
     ▼
  ocr_extract          (optional — extracts base64 images from description)
     │
     ▼
  extract_testcases    (Agent 2 — Testcase Requirement Extractor)
     │
     ▼
  extract_description  (Agent 3 — Description Requirement Extractor)
     │
     ▼
  compare              (Agent 4 — Semantic Comparator)
     │
     ▼
  analyze_coverage     (Agent 5 — Coverage Analyzer)
     │
     ▼
  save_report          (writes reports/qc_report.json)
     │
     ▼
  [END]
"""

import json
import logging
import os
import sys
from typing import Any, Dict, TypedDict

# ── LangGraph ─────────────────────────────────────────────────────────────────
from langgraph.graph import StateGraph, END

# ── Project imports ───────────────────────────────────────────────────────────
from config.settings import (
    GROQ_API_KEY,
    OCR_ENABLED,
    TESTCASE_FILE,
    DESC_FILE,
    REPORT_FILE,
    VERBOSE,
)
from tools.parser_tool    import read_testcase, read_description
from tools.ocr_tool       import extract_base64_images_from_text
from tools.text_cleaner   import strip_base64_images
from pipeline.normalizer  import (
    normalize_testcase_requirements,
    normalize_description_requirements,
)
from pipeline.coverage_analyzer import CoverageAnalyzer
from agents.testcase_extractor_agent    import TestcaseExtractorAgent
from agents.description_extractor_agent import DescriptionExtractorAgent
from agents.comparator_agent            import ComparatorAgent

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if VERBOSE else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("qc_pipeline")


# ─────────────────────────────────────────────────────────────────────────────
# LangGraph State Schema
# ─────────────────────────────────────────────────────────────────────────────

class PipelineState(TypedDict, total=False):
    # ── Path hints (passed in initial state) ──────────────────────────────────
    testcase_path:        str
    description_path:     str
    report_path:          str

    # ── Raw inputs ────────────────────────────────────────────────────────────
    testcase_content:     str
    description_content:  str
    ocr_text:             str

    # ── Extracted (raw from LLM) ──────────────────────────────────────────────
    raw_testcase_reqs:    Dict[str, Any]
    raw_desc_reqs:        Dict[str, Any]

    # ── Normalised ────────────────────────────────────────────────────────────
    testcase_reqs:        Dict[str, Any]
    desc_reqs:            Dict[str, Any]

    # ── Comparator output ─────────────────────────────────────────────────────
    comparator_result:    Dict[str, Any]

    # ── Final report ──────────────────────────────────────────────────────────
    qc_report:            Dict[str, Any]

    # ── Error tracking ────────────────────────────────────────────────────────
    error:                str


# ─────────────────────────────────────────────────────────────────────────────
# Node Functions
# ─────────────────────────────────────────────────────────────────────────────

def node_load_inputs(state: PipelineState) -> PipelineState:
    """Node 1 — Load testcase.js and description.txt from disk."""
    logger.info("═══ Node: load_inputs ═══")
    try:
        tc_path   = state.get("testcase_path",    TESTCASE_FILE)
        desc_path = state.get("description_path", DESC_FILE)
        logger.info("Loading testcase from: %s", tc_path)
        logger.info("Loading description from: %s", desc_path)
        return {
            **state,
            "testcase_content":    read_testcase(tc_path),
            "description_content": read_description(desc_path),
        }
    except Exception as e:
        logger.error("load_inputs failed: %s", e)
        return {**state, "error": str(e)}


def node_ocr_extract(state: PipelineState) -> PipelineState:
    """Node 1b — OCR extraction from base64 images embedded in description."""
    logger.info("═══ Node: ocr_extract ═══")
    if state.get("error"):
        return state
    if not OCR_ENABLED:
        logger.info("OCR disabled — skipping.")
        return {**state, "ocr_text": ""}

    description_content = state.get("description_content", "")
    if not description_content:
        return {**state, "ocr_text": ""}

    b64_text = extract_base64_images_from_text(description_content)
    if b64_text:
        logger.info("Base64 OCR: extracted %d chars from embedded images.", len(b64_text))
    else:
        logger.info("No base64 images found in description text.")

    return {**state, "ocr_text": b64_text}


def node_extract_testcases(state: PipelineState) -> PipelineState:
    """Node 2 — Testcase Requirement Extractor Agent."""
    logger.info("═══ Node: extract_testcases (Agent 2) ═══")
    if state.get("error"):
        return state
    try:
        agent  = TestcaseExtractorAgent()
        raw    = agent.extract(state["testcase_content"])
        normed = normalize_testcase_requirements(raw)
        return {**state, "raw_testcase_reqs": raw, "testcase_reqs": normed}
    except Exception as e:
        logger.error("extract_testcases failed: %s", e)
        return {**state, "error": str(e)}


def node_extract_description(state: PipelineState) -> PipelineState:
    """Node 3 — Description Requirement Extractor Agent."""
    logger.info("═══ Node: extract_description (Agent 3) ═══")
    if state.get("error"):
        return state
    try:
        agent  = DescriptionExtractorAgent()
        clean_description = strip_base64_images(state["description_content"])
        raw    = agent.extract(
            clean_description,
            state.get("ocr_text", ""),
        )
        normed = normalize_description_requirements(raw)
        return {**state, "raw_desc_reqs": raw, "desc_reqs": normed}
    except Exception as e:
        logger.error("extract_description failed: %s", e)
        return {**state, "error": str(e)}


def node_compare(state: PipelineState) -> PipelineState:
    """Node 4 — Semantic Comparator Agent."""
    logger.info("═══ Node: compare (Agent 4) ═══")
    if state.get("error"):
        return state
    try:
        agent  = ComparatorAgent()
        result = agent.compare(state["testcase_reqs"], state["desc_reqs"])
        return {**state, "comparator_result": result}
    except Exception as e:
        logger.error("compare failed: %s", e)
        return {**state, "error": str(e)}


def node_analyze_coverage(state: PipelineState) -> PipelineState:
    """Node 5 — Coverage Analyzer."""
    logger.info("═══ Node: analyze_coverage (Agent 5) ═══")
    if state.get("error"):
        return state
    try:
        analyzer = CoverageAnalyzer()
        report   = analyzer.analyze(
            state["comparator_result"],
            state["testcase_reqs"],
            state["desc_reqs"],
        )
        return {**state, "qc_report": report}
    except Exception as e:
        logger.error("analyze_coverage failed: %s", e)
        return {**state, "error": str(e)}


def node_save_report(state: PipelineState) -> PipelineState:
    """Node 6 — Save QC report to disk."""
    logger.info("═══ Node: save_report ═══")
    if state.get("error"):
        error_report = {"error": state["error"], "status": "PIPELINE_FAILED"}
        report_path  = state.get("report_path", REPORT_FILE)
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w") as f:
            json.dump(error_report, f, indent=2)
        logger.error("Pipeline failed. Error report saved.")
        return state

    report      = state.get("qc_report", {})
    report_path = state.get("report_path", REPORT_FILE)
    analyzer    = CoverageAnalyzer()
    analyzer.save_report(report, report_path)

    summary = report.get("summary", {})
    logger.info(
        "✅ QC Report saved → %s\n"
        "   Coverage: %.1f%% | Score: %.1f | Verdict: %s",
        report_path,
        summary.get("coverage_percent", 0),
        summary.get("quality_score",    0),
        summary.get("verdict", "N/A"),
    )
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Build LangGraph
# ─────────────────────────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    """Construct and compile the QC pipeline LangGraph."""
    graph = StateGraph(PipelineState)

    graph.add_node("load_inputs",         node_load_inputs)
    graph.add_node("ocr_extract",         node_ocr_extract)
    graph.add_node("extract_testcases",   node_extract_testcases)
    graph.add_node("extract_description", node_extract_description)
    graph.add_node("compare",             node_compare)
    graph.add_node("analyze_coverage",    node_analyze_coverage)
    graph.add_node("save_report",         node_save_report)

    graph.set_entry_point("load_inputs")
    graph.add_edge("load_inputs",         "ocr_extract")
    graph.add_edge("ocr_extract",         "extract_testcases")
    graph.add_edge("extract_testcases",   "extract_description")
    graph.add_edge("extract_description", "compare")
    graph.add_edge("compare",             "analyze_coverage")
    graph.add_edge("analyze_coverage",    "save_report")
    graph.add_edge("save_report",         END)

    return graph.compile()


# ─────────────────────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline(
    testcase_path:    str = TESTCASE_FILE,
    description_path: str = DESC_FILE,
    report_path:      str = REPORT_FILE,
) -> Dict[str, Any]:
    """
    Run the full QC automation pipeline.

    Args:
        testcase_path:    Path to testcase.js
        description_path: Path to description.txt
        report_path:      Output path for qc_report.json

    Returns:
        Final pipeline state dict (includes qc_report)
    """
    if not GROQ_API_KEY:
        logger.error("GROQ_API_KEY is not set. Add it to your .env file.")
        sys.exit(1)

    graph = build_graph()

    initial_state: PipelineState = {
        "testcase_path":    testcase_path,
        "description_path": description_path,
        "report_path":      report_path,
    }

    logger.info("🚀 Starting QC Automation Pipeline")
    logger.info("   Testcase   : %s", testcase_path)
    logger.info("   Description: %s", description_path)
    logger.info("   Report     : %s", report_path)

    final_state = graph.invoke(initial_state)

    if final_state.get("error"):
        logger.error("Pipeline finished with error: %s", final_state["error"])
    else:
        report  = final_state.get("qc_report", {})
        summary = report.get("summary", {})
        print("\n" + "═" * 60)
        print("  QC AUTOMATION REPORT SUMMARY")
        print("═" * 60)
        print(f"  Total Testcases           : {summary.get('total_testcases', '?')}")
        print(f"  Desc Requirements         : {summary.get('total_desc_requirements', '?')}")
        print(f"  Covered in Description    : {summary.get('covered_in_description', '?')}")
        print(f"  Partial in Description    : {summary.get('partial_in_description', '?')}")
        print(f"  NOT in Description        : {summary.get('not_in_description', '?')}")
        print(f"  Spec Conflicts            : {summary.get('spec_conflicts', '?')} ⚠")
        print(f"  Coverage %                : {summary.get('coverage_percent', '?')}%")
        print(f"  Quality Score             : {summary.get('quality_score', '?')}/100")
        print(f"  Verdict                   : {summary.get('verdict', '?')}")
        if report.get("spec_conflicts"):
            print(f"")
            print(f"  SPEC CONFLICTS (testcase contradicts description):")
            for c in report["spec_conflicts"]:
                print(f"  ⚠  {c['id']}: {c['conflict_detail']}")
        print("═" * 60)
        print(f"  Full report saved → {report_path}\n")

    return final_state


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="QC Automation Pipeline")
    parser.add_argument("--testcase",    default=TESTCASE_FILE,  help="Path to testcase.js")
    parser.add_argument("--description", default=DESC_FILE,      help="Path to description.txt")
    parser.add_argument("--report",      default=REPORT_FILE,    help="Output path for qc_report.json")
    args = parser.parse_args()

    run_pipeline(
        testcase_path    = args.testcase,
        description_path = args.description,
        report_path      = args.report,
    )