"""
QC Automation Pipeline — Main Entry Point
=========================================
LangGraph-orchestrated multi-agent pipeline:

  [START]
     │
     ▼
  load_inputs          (reads testcase.js, description.txt; prepares scaffolding/)
     │
     ▼
  ocr_extract          (optional — extracts base64 images from description)
     │
     ▼
  generate_solution    (Agent 1 — AI writes index.html, style.css, script.js)
     │
     ▼
  run_tests            (HTTP server + node testcase.js → PASS/FAIL per test)
     │
     ▼
  analyze_failures     (Agent 2 — root-cause analysis for each failed test)
     │
     ▼
  generate_excel_report (writes reports/qc_report.xlsx + reports/qc_report.json)
     │
     ▼
  [END]
"""

import json
import logging
import os
import shutil
import sys
from typing import Any, Dict, List, TypedDict

# ── LangGraph ─────────────────────────────────────────────────────────────────
from langgraph.graph import StateGraph, END

# ── Project imports ───────────────────────────────────────────────────────────
from config.settings import (
    GROQ_API_KEY,
    OCR_ENABLED,
    IMAGE_UPLOAD_ENABLED,
    TESTCASE_FILE,
    DESC_FILE,
    EXCEL_REPORT_FILE,
    SCAFFOLDING_DIR,
    PUBLIC_DIR,
    VERBOSE,
)
from tools.parser_tool  import read_testcase, read_description
from tools.ocr_tool     import extract_base64_images_from_text
from tools.text_cleaner import strip_base64_images
from tools.test_runner  import TestRunner
from tools.excel_reporter import generate_excel_report
from agents.solution_generator_agent  import SolutionGeneratorAgent
from agents.failure_analyzer_agent    import FailureAnalyzerAgent
from agents.description_scorer_agent  import DescriptionScorerAgent

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
    # ── Path hints ────────────────────────────────────────────────────────────
    testcase_path:       str
    description_path:    str
    scaffolding_dir:     str
    report_path:         str

    # ── Raw inputs ────────────────────────────────────────────────────────────
    testcase_content:    str
    description_content: str
    ocr_text:            str
    image_urls:          List[str]   # pre-signed S3 URLs of description images

    # ── Generated solution ────────────────────────────────────────────────────
    generated_files:     Dict[str, str]   # {index.html, style.css, script.js}

    # ── Test execution results ────────────────────────────────────────────────
    test_results:        List[Dict]        # [{id, name, status, error_message}, ...]
    test_summary:        Dict              # {total, passed, failed, pass_rate}

    # ── Failure analysis ──────────────────────────────────────────────────────
    failure_analysis:    List[Dict]        # [{id, category, description_gap, ...}, ...]

    # ── Description quality score ─────────────────────────────────────────────
    description_score:   Dict             # {p1_score, p2_score, ..., overall_grade, params}

    # ── Raw test runner output (for debugging 0-result runs) ──────────────────
    raw_stdout:          str
    raw_stderr:          str

    # ── Error tracking ────────────────────────────────────────────────────────
    error:               str


# ─────────────────────────────────────────────────────────────────────────────
# Node Functions
# ─────────────────────────────────────────────────────────────────────────────

def node_load_inputs(state: PipelineState) -> PipelineState:
    """Node 1 — Load testcase.js and description.txt; prepare scaffolding folder."""
    logger.info("═══ Node: load_inputs ═══")
    try:
        tc_path   = state.get("testcase_path",    TESTCASE_FILE)
        desc_path = state.get("description_path", DESC_FILE)
        scaf_dir  = state.get("scaffolding_dir",  SCAFFOLDING_DIR)
        pub_dir   = os.path.join(scaf_dir, "public")

        logger.info("Loading testcase from:    %s", tc_path)
        logger.info("Loading description from: %s", desc_path)
        logger.info("Scaffolding dir:          %s", scaf_dir)

        # Ensure scaffolding/public/ exists with empty placeholder files
        os.makedirs(pub_dir, exist_ok=True)
        for fname in ("index.html", "style.css", "script.js"):
            fpath = os.path.join(pub_dir, fname)
            if not os.path.exists(fpath):
                open(fpath, "w").close()

        # Copy testcase.js into scaffolding dir (so Node can require puppeteer)
        scaf_tc = os.path.join(scaf_dir, "testcase.js")
        if os.path.abspath(tc_path) != os.path.abspath(scaf_tc):
            shutil.copy2(tc_path, scaf_tc)
            logger.info("Copied testcase.js → %s", scaf_tc)

        return {
            **state,
            "testcase_content":    read_testcase(tc_path),
            "description_content": read_description(desc_path),
        }
    except Exception as e:
        logger.error("load_inputs failed: %s", e)
        return {**state, "error": str(e)}


def node_ocr_extract(state: PipelineState) -> PipelineState:
    """Node 2 — OCR text extraction + S3 image upload for vision LLM."""
    logger.info("═══ Node: ocr_extract ═══")
    if state.get("error"):
        return state

    description_content = state.get("description_content", "")
    if not description_content:
        return {**state, "ocr_text": "", "image_urls": []}

    # ── OCR (kept as supplementary text context for the LLM) ─────────────────
    b64_text = ""
    if OCR_ENABLED:
        b64_text = extract_base64_images_from_text(description_content)
        if b64_text:
            logger.info("OCR: extracted %d chars from embedded images.", len(b64_text))
        else:
            logger.info("No base64 images found in description.")
    else:
        logger.info("OCR disabled — skipping.")

    # ── S3 upload (passes pre-signed URLs to vision LLM) ─────────────────────
    image_urls: List[str] = []
    if IMAGE_UPLOAD_ENABLED:
        from tools.image_store import upload_images
        image_urls = upload_images(description_content)
        logger.info("S3: uploaded %d image(s) for vision LLM.", len(image_urls))
    else:
        logger.info("S3 upload disabled (IMAGE_UPLOAD_ENABLED=false) — base64 fallback will be used.")

    return {**state, "ocr_text": b64_text, "image_urls": image_urls}


def node_generate_solution(state: PipelineState) -> PipelineState:
    """Node 3 — AI generates index.html, style.css, script.js from description."""
    logger.info("═══ Node: generate_solution (Agent 1) ═══")
    if state.get("error"):
        return state
    try:
        scaf_dir = state.get("scaffolding_dir", SCAFFOLDING_DIR)
        pub_dir  = os.path.join(scaf_dir, "public")

        agent = SolutionGeneratorAgent()
        files = agent.generate(
            description_content = state["description_content"],
            ocr_text            = state.get("ocr_text", ""),
            testcase_content    = state["testcase_content"],
            public_dir          = pub_dir,
            image_urls          = state.get("image_urls", []),
        )
        return {**state, "generated_files": files}
    except Exception as e:
        logger.error("generate_solution failed: %s", e)
        return {**state, "error": str(e)}


def node_run_tests(state: PipelineState) -> PipelineState:
    """Node 4 — Run Puppeteer testcase against generated solution."""
    logger.info("═══ Node: run_tests ═══")
    if state.get("error"):
        return state
    try:
        scaf_dir  = state.get("scaffolding_dir", SCAFFOLDING_DIR)
        tc_path   = os.path.join(scaf_dir, "testcase.js")

        runner  = TestRunner(scaffolding_dir=scaf_dir, testcase_path=tc_path)
        outcome = runner.run()

        summary = outcome["summary"]
        logger.info(
            "Tests complete — %d/%d passed (%.1f%%)",
            summary["passed"], summary["total"], summary["pass_rate"],
        )

        # When 0 results, surface the raw output prominently so user can diagnose
        if summary["total"] == 0:
            logger.warning(
                "⚠ 0 test results parsed. Possible causes:\n"
                "  1. puppeteer not in node_modules (check npm install above)\n"
                "  2. testcase.js doesn't print TESTCASE:<id>:success/failure\n"
                "  3. Node crashed — check STDERR above"
            )

        return {
            **state,
            "test_results":  outcome["results"],
            "test_summary":  summary,
            "raw_stdout":    outcome.get("raw_output", ""),
            "raw_stderr":    outcome.get("raw_stderr", ""),
        }
    except Exception as e:
        logger.error("run_tests failed: %s", e)
        return {**state, "error": str(e)}


def node_analyze_failures(state: PipelineState) -> PipelineState:
    """Node 5 — AI root-cause analysis for each failed test."""
    logger.info("═══ Node: analyze_failures (Agent 2) ═══")
    if state.get("error"):
        return state
    try:
        test_results = state.get("test_results", [])
        failed       = [r for r in test_results if r["status"] == "FAIL"]

        if not failed:
            logger.info("All tests passed — skipping failure analysis.")
            return {**state, "failure_analysis": []}

        logger.info("Analyzing %d failure(s)…", len(failed))
        agent    = FailureAnalyzerAgent()
        analyses = agent.analyze(
            failed_tests        = failed,
            description_content = strip_base64_images(state["description_content"]),
            generated_files     = state.get("generated_files", {}),
            testcase_content    = state["testcase_content"],
        )
        return {**state, "failure_analysis": analyses}
    except Exception as e:
        logger.error("analyze_failures failed: %s", e)
        return {**state, "error": str(e)}


def node_score_description(state: PipelineState) -> PipelineState:
    """Node 6 — AI scores the description on 4 QC parameters (1–5 each)."""
    logger.info("═══ Node: score_description (Agent 3) ═══")
    if state.get("error"):
        return state
    try:
        agent  = DescriptionScorerAgent()
        result = agent.score(state.get("description_content", ""))
        logger.info(
            "Description scored — Grade: %s  (P1:%d P2:%d P3:%d P4:%d)",
            result["overall_grade"],
            result["p1_score"], result["p2_score"],
            result["p3_score"], result["p4_score"],
        )
        return {**state, "description_score": result}
    except Exception as e:
        logger.warning("score_description failed (non-fatal): %s", e)
        return {**state, "description_score": {}}


def node_generate_excel_report(state: PipelineState) -> PipelineState:
    """Node 6 — Build Excel report and save JSON summary."""
    logger.info("═══ Node: generate_excel_report ═══")

    report_path = state.get("report_path", EXCEL_REPORT_FILE)

    if state.get("error"):
        # Save an error-only JSON so the API /report endpoint returns something
        _save_json_summary(
            {"error": state["error"], "status": "PIPELINE_FAILED"},
            report_path,
        )
        logger.error("Pipeline failed — error report saved.")
        return state

    test_results     = state.get("test_results",    [])
    test_summary     = state.get("test_summary",    {})
    failure_analysis = state.get("failure_analysis", [])

    # ── Excel ─────────────────────────────────────────────────────────────────
    generate_excel_report(
        test_results      = test_results,
        test_summary      = test_summary,
        failure_analysis  = failure_analysis,
        report_path       = report_path,
        description_score = state.get("description_score"),
    )

    # ── JSON summary (for /api/report endpoint) ───────────────────────────────
    json_report = {
        "summary":            test_summary,
        "test_results":       test_results,
        "failure_analysis":   failure_analysis,
        "description_score":  state.get("description_score", {}),
    }
    # Include raw node output when 0 tests parsed — helps user diagnose format issues
    if test_summary.get("total", 0) == 0:
        json_report["raw_stdout"] = state.get("raw_stdout", "")
        json_report["raw_stderr"] = state.get("raw_stderr", "")
    _save_json_summary(json_report, report_path)

    logger.info(
        "✅ QC Report saved → %s\n   Passed: %d/%d  (%.1f%%)",
        report_path,
        test_summary.get("passed", 0),
        test_summary.get("total",  0),
        test_summary.get("pass_rate", 0.0),
    )

    # ── S3 cleanup — delete uploaded images after pipeline completes ──────────
    s3_urls = state.get("image_urls", [])
    if s3_urls:
        try:
            from tools.image_store import delete_images
            delete_images(s3_urls)
            logger.info("S3 cleanup: deleted %d uploaded image(s).", len(s3_urls))
        except Exception as _cleanup_err:
            logger.warning("S3 cleanup failed (non-fatal): %s", _cleanup_err)

    return state


def _save_json_summary(data: dict, excel_path: str) -> None:
    """Write qc_report.json alongside the Excel file."""
    json_path = excel_path.replace(".xlsx", ".json")
    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ─────────────────────────────────────────────────────────────────────────────
# Build LangGraph
# ─────────────────────────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    graph = StateGraph(PipelineState)

    graph.add_node("load_inputs",            node_load_inputs)
    graph.add_node("ocr_extract",            node_ocr_extract)
    graph.add_node("generate_solution",      node_generate_solution)
    graph.add_node("run_tests",              node_run_tests)
    graph.add_node("analyze_failures",       node_analyze_failures)
    graph.add_node("score_description",      node_score_description)
    graph.add_node("generate_excel_report",  node_generate_excel_report)

    graph.set_entry_point("load_inputs")
    graph.add_edge("load_inputs",           "ocr_extract")
    graph.add_edge("ocr_extract",           "generate_solution")
    graph.add_edge("generate_solution",     "run_tests")
    graph.add_edge("run_tests",             "analyze_failures")
    graph.add_edge("analyze_failures",      "score_description")
    graph.add_edge("score_description",     "generate_excel_report")
    graph.add_edge("generate_excel_report", END)

    return graph.compile()


# ─────────────────────────────────────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline(
    testcase_path:    str = TESTCASE_FILE,
    description_path: str = DESC_FILE,
    scaffolding_dir:  str = SCAFFOLDING_DIR,
    report_path:      str = EXCEL_REPORT_FILE,
    cancel_event=None,
) -> Dict[str, Any]:
    """
    Run the full QC automation pipeline.

    Args:
        testcase_path:    Path to testcase.js
        description_path: Path to description.txt
        scaffolding_dir:  Path to scaffolding folder (contains public/ and package.json)
        report_path:      Output path for qc_report.xlsx
        cancel_event:     Optional threading.Event; set to abort between nodes.

    Returns:
        Final pipeline state dict.
    """
    if not GROQ_API_KEY:
        logger.error("GROQ_API_KEY is not set. Add it to your .env file.")
        sys.exit(1)

    graph = build_graph()

    initial_state: PipelineState = {
        "testcase_path":    testcase_path,
        "description_path": description_path,
        "scaffolding_dir":  scaffolding_dir,
        "report_path":      report_path,
    }

    logger.info("🚀 Starting QC Automation Pipeline")
    logger.info("   Testcase    : %s", testcase_path)
    logger.info("   Description : %s", description_path)
    logger.info("   Scaffolding : %s", scaffolding_dir)
    logger.info("   Report      : %s", report_path)

    if cancel_event and cancel_event.is_set():
        logger.info("Pipeline cancelled before start.")
        return {}

    final_state = graph.invoke(initial_state)

    if final_state.get("error"):
        logger.error("Pipeline finished with error: %s", final_state["error"])
    else:
        summary = final_state.get("test_summary", {})
        results = final_state.get("test_results", [])
        print("\n" + "═" * 60)
        print("  QC AUTOMATION REPORT SUMMARY")
        print("═" * 60)
        print(f"  Total Tests   : {summary.get('total',     '?')}")
        print(f"  Passed        : {summary.get('passed',    '?')}")
        print(f"  Failed        : {summary.get('failed',    '?')}")
        print(f"  Pass Rate     : {summary.get('pass_rate', '?')}%")
        print("═" * 60)
        for r in results:
            icon = "✅" if r["status"] == "PASS" else "❌"
            print(f"  {icon}  {r['id']}")
        print("═" * 60)
        print(f"  Full report saved → {report_path}\n")

    return final_state


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="QC Automation Pipeline")
    parser.add_argument("--testcase",     default=TESTCASE_FILE,    help="Path to testcase.js")
    parser.add_argument("--description",  default=DESC_FILE,        help="Path to description.txt")
    parser.add_argument("--scaffolding",  default=SCAFFOLDING_DIR,  help="Path to scaffolding folder")
    parser.add_argument("--report",       default=EXCEL_REPORT_FILE, help="Output path for qc_report.xlsx")
    args = parser.parse_args()

    run_pipeline(
        testcase_path    = args.testcase,
        description_path = args.description,
        scaffolding_dir  = args.scaffolding,
        report_path      = args.report,
    )
