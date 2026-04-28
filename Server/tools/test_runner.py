"""
Test Runner Tool
================
1. Starts a Python http.server serving scaffolding/public/ on a local port.
2. Reads testcase.js, replaces the hardcoded URL with http://localhost:<port>/.
3. Writes the URL-patched testcase to a temp file.
4. Spawns `node <tmp_testcase.js>` as a subprocess (cwd = scaffolding_dir so
   node_modules/puppeteer is resolved correctly).
5. Captures stdout; parses lines matching TESTCASE:id:success/failure.
6. Stops the HTTP server and cleans up the temp file.
7. Returns structured results + summary dict.
"""
import http.server
import logging
import os
import re
import socketserver
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional

from config.settings import TEST_SERVER_PORT, NODE_PATH

logger = logging.getLogger(__name__)

_TESTCASE_LINE_RE = re.compile(r'^TESTCASE:([^:]+):(success|failure)\s*$', re.IGNORECASE)

# Alternative formats (TAP / mocha-like / custom)
_TAP_PASS_RE   = re.compile(r'^ok\s+\d+\s+[-–]\s+(.+)$',      re.IGNORECASE)
_TAP_FAIL_RE   = re.compile(r'^not ok\s+\d+\s+[-–]\s+(.+)$',  re.IGNORECASE)
_TICK_PASS_RE  = re.compile(r'^\s*[✓✔√]\s+(.+)$')
_CROSS_FAIL_RE = re.compile(r'^\s*[✗✘×]\s+(.+)$')
_PASS_FAIL_RE  = re.compile(r'\b(PASS|FAIL)\b.*?:\s*(.+)$',   re.IGNORECASE)


class TestRunner:

    def __init__(
        self,
        scaffolding_dir: str,
        testcase_path:   str,
        port:            int = TEST_SERVER_PORT,
    ):
        # Always use absolute paths — Node.js resolves require() from the FILE's
        # location, and subprocess cwd doesn't help if paths are relative.
        self.scaffolding_dir = os.path.abspath(scaffolding_dir)
        self.public_dir      = os.path.join(self.scaffolding_dir, "public")
        self.testcase_path   = os.path.abspath(testcase_path)
        self.port            = port
        self._server: Optional[socketserver.TCPServer] = None
        self._server_thread: Optional[threading.Thread] = None

    # ── Public API ────────────────────────────────────────────────────────────

    def run(self) -> Dict[str, Any]:
        """
        Full run: ensure deps → start server → run tests → stop server.

        Returns:
            {
                "results":    [{id, name, status, error_message}, ...],
                "summary":    {total, passed, failed, pass_rate},
                "raw_output": str,
                "raw_stderr": str,
            }
        """
        self._ensure_dependencies()
        self._start_server()
        try:
            return self._execute_tests()
        finally:
            self._stop_server()

    # ── Dependency check ──────────────────────────────────────────────────────

    def _ensure_dependencies(self):
        """
        If node_modules/puppeteer is missing, try to run npm install.
        Gives a clear log message so the user understands what's happening.
        """
        puppeteer_path = os.path.join(self.scaffolding_dir, "node_modules", "puppeteer")
        package_json   = os.path.join(self.scaffolding_dir, "package.json")

        if os.path.exists(puppeteer_path):
            logger.info("✅ puppeteer found at %s", puppeteer_path)
            return

        logger.warning("⚠ node_modules/puppeteer NOT found in %s", self.scaffolding_dir)

        if not os.path.exists(package_json):
            logger.error(
                "❌ No package.json found in scaffolding dir. "
                "Upload a ZIP that contains package.json + node_modules (or at least package.json). "
                "Without puppeteer, testcases cannot run."
            )
            return

        # package.json exists — run npm install
        logger.info("📦 package.json found — running 'npm install' to install puppeteer…")
        try:
            proc = subprocess.run(
                ["npm", "install"],
                cwd=self.scaffolding_dir,
                capture_output=True,
                text=True,
                timeout=300,   # 5 min max for npm install
            )
            if proc.returncode == 0:
                logger.info("✅ npm install completed successfully.")
            else:
                logger.error("❌ npm install failed (exit %d):", proc.returncode)
                for line in (proc.stderr or "").splitlines()[:20]:
                    logger.error("  NPM: %s", line)
        except FileNotFoundError:
            logger.error(
                "❌ 'npm' command not found. Install Node.js / npm and make sure it is on PATH."
            )
        except subprocess.TimeoutExpired:
            logger.error("❌ npm install timed out after 300 seconds.")

    # ── Server lifecycle ──────────────────────────────────────────────────────

    def _start_server(self):
        public_dir = self.public_dir

        class _Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=public_dir, **kwargs)

            def log_message(self, fmt, *args):  # silence per-request logs
                logger.debug("HTTP: " + fmt % args)

        # Retry a few times in case the port is briefly occupied
        for attempt in range(5):
            try:
                self._server = socketserver.TCPServer(("", self.port), _Handler)
                self._server.allow_reuse_address = True
                break
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(1)

        self._server_thread = threading.Thread(
            target=self._server.serve_forever, daemon=True
        )
        self._server_thread.start()
        logger.info(
            "HTTP server started on port %d serving %s", self.port, self.public_dir
        )
        time.sleep(0.5)   # brief pause to ensure server is ready

    def _stop_server(self):
        if self._server:
            self._server.shutdown()
            self._server = None
            logger.info("HTTP server stopped.")

    # ── Test execution ────────────────────────────────────────────────────────

    def _execute_tests(self) -> Dict[str, Any]:
        base_url = f"http://localhost:{self.port}"

        # Read testcase.js and patch the URL constant
        with open(self.testcase_path, "r", encoding="utf-8") as f:
            source = f.read()

        # Patch any URL variable regardless of declaration keyword or variable name
        _url_pat = re.compile(
            r"((const|let|var)\s+\w*[Uu]rl\w*\s*=\s*)['\"]https?://[^'\"]+['\"]"
        )
        patched = _url_pat.sub(f"\\1'{base_url}/'", source)

        # Also patch page.goto('https://...') calls directly
        patched = re.sub(
            r"""(page\.goto\s*\(\s*)['\"]https?://[^'\"]+['\"]""",
            f"\\1'{base_url}/'",
            patched,
        )

        # Strip any previously appended extraction comment blocks
        patched = re.sub(
            r'/\*\s*EXTRACTED_TESTCASE_REQUIREMENTS.*?\*/',
            '',
            patched,
            flags=re.DOTALL,
        )

        if patched == source:
            logger.warning(
                "URL pattern not found in testcase.js — tests may navigate to wrong host. "
                "Expected pattern: const url = 'https://...'"
            )

        # ── Fix require('puppeteer') → absolute path ──────────────────────────
        # On Windows, bare require('puppeteer') fails even with cwd/NODE_PATH set
        # because Node resolves modules from the FILE location, not cwd.
        # Replacing with the absolute path always works.
        puppeteer_abs = os.path.join(self.scaffolding_dir, "node_modules", "puppeteer")
        # Use forward slashes in the JS string (Windows Node accepts them)
        puppeteer_abs_js = puppeteer_abs.replace("\\", "/")
        patched = patched.replace(
            "require('puppeteer')",
            f"require('{puppeteer_abs_js}')",
        ).replace(
            'require("puppeteer")',
            f'require("{puppeteer_abs_js}")',
        )
        logger.info("Patched require('puppeteer') → absolute path: %s", puppeteer_abs_js)

        # Write the patched testcase INSIDE scaffolding_dir so Node.js resolves
        # require('puppeteer') from scaffolding_dir/node_modules/puppeteer.
        # Writing to a system temp dir causes MODULE_NOT_FOUND because Node
        # walks up from the FILE location, not cwd, to find node_modules.
        tmp_path = os.path.join(self.scaffolding_dir, "_qc_testcase_runner.js")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(patched)

            node_modules_path = os.path.join(self.scaffolding_dir, "node_modules")
            run_env = os.environ.copy()
            # NODE_PATH tells Node where to find modules regardless of file location.
            # This is the most reliable way to resolve puppeteer from scaffolding_dir.
            existing_node_path = run_env.get("NODE_PATH", "")
            run_env["NODE_PATH"] = (
                node_modules_path + os.pathsep + existing_node_path
                if existing_node_path else node_modules_path
            )
            logger.info(
                "Running: %s %s (cwd=%s, NODE_PATH=%s)",
                NODE_PATH, tmp_path, self.scaffolding_dir, node_modules_path,
            )
            proc = subprocess.run(
                [NODE_PATH, tmp_path],
                capture_output=True,
                text=True,
                timeout=180,               # 3 minutes max for all Puppeteer tests
                cwd=self.scaffolding_dir,
                env=run_env,               # explicit NODE_PATH → always finds puppeteer
            )

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            logger.info(
                "Test run complete — stdout %d chars, stderr %d chars, returncode %d",
                len(stdout), len(stderr), proc.returncode,
            )

            # Always show stderr (critical for diagnosing failures)
            if stderr:
                for line in stderr.splitlines()[:30]:
                    logger.warning("STDERR: %s", line)

            results = self._parse_output(stdout, stderr)
            summary = self._build_summary(results)

            # If nothing was parsed, dump the raw stdout so it appears in the frontend logs
            if not results:
                logger.warning(
                    "No TESTCASE lines found in output. "
                    "Ensure testcase.js prints: console.log(`TESTCASE:<id>:success`) or :failure"
                )
                if stdout:
                    logger.info("─── Raw stdout (first 60 lines) ───")
                    for line in stdout.splitlines()[:60]:
                        logger.info("STDOUT: %s", line)
                else:
                    logger.warning("stdout was empty — Node may have exited before any output.")

            return {
                "results":    results,
                "summary":    summary,
                "raw_output": stdout,
                "raw_stderr": stderr,
            }

        except subprocess.TimeoutExpired:
            logger.error("Test run timed out after 180 seconds.")
            return {
                "results":    [],
                "summary":    {"total": 0, "passed": 0, "failed": 0, "pass_rate": 0.0},
                "raw_output": "",
                "raw_stderr": "TIMEOUT: tests did not complete within 180 seconds",
            }
        finally:
            # Clean up the temp runner file
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass

    # ── Output parsing ────────────────────────────────────────────────────────

    def _parse_output(self, stdout: str, stderr: str) -> List[Dict]:
        """
        Parse test results from stdout.
        Supports multiple output formats:
          1. TESTCASE:<id>:success/failure        (primary / custom format)
          2. ok N - <name> / not ok N - <name>   (TAP)
          3. ✓ <name> / ✗ <name>                 (mocha-like)
          4. PASS: <name> / FAIL: <name>          (simple)
        """
        seen: Dict[str, Dict] = {}
        tap_counter = 0

        for line in stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue

            # ── Format 1: TESTCASE:id:success/failure ──────────────────────────
            m = _TESTCASE_LINE_RE.match(stripped)
            if m:
                tc_id  = m.group(1).strip()
                status = "PASS" if m.group(2).lower() == "success" else "FAIL"
                if tc_id not in seen:
                    seen[tc_id] = {"id": tc_id, "name": _id_to_name(tc_id), "status": status, "error_message": None}
                    logger.info("[%s] %s", status, tc_id)
                continue

            # ── Format 2: TAP ok / not ok ────────────────────────────────────
            m = _TAP_PASS_RE.match(stripped)
            if m:
                tap_counter += 1
                tc_id = f"tc_{tap_counter}"
                name  = m.group(1).strip()
                if tc_id not in seen:
                    seen[tc_id] = {"id": tc_id, "name": name, "status": "PASS", "error_message": None}
                    logger.info("[PASS] %s", name)
                continue
            m = _TAP_FAIL_RE.match(stripped)
            if m:
                tap_counter += 1
                tc_id = f"tc_{tap_counter}"
                name  = m.group(1).strip()
                if tc_id not in seen:
                    seen[tc_id] = {"id": tc_id, "name": name, "status": "FAIL", "error_message": None}
                    logger.info("[FAIL] %s", name)
                continue

            # ── Format 3: ✓ / ✗ ──────────────────────────────────────────────
            m = _TICK_PASS_RE.match(stripped)
            if m:
                tap_counter += 1
                tc_id = f"tc_{tap_counter}"
                name  = m.group(1).strip()
                if tc_id not in seen:
                    seen[tc_id] = {"id": tc_id, "name": name, "status": "PASS", "error_message": None}
                    logger.info("[PASS] %s", name)
                continue
            m = _CROSS_FAIL_RE.match(stripped)
            if m:
                tap_counter += 1
                tc_id = f"tc_{tap_counter}"
                name  = m.group(1).strip()
                if tc_id not in seen:
                    seen[tc_id] = {"id": tc_id, "name": name, "status": "FAIL", "error_message": None}
                    logger.info("[FAIL] %s", name)
                continue

        # Attach stderr snippet to all failed tests as context
        if stderr:
            stderr_snippet = stderr[:1500]
            for result in seen.values():
                if result["status"] == "FAIL":
                    result["error_message"] = stderr_snippet

        return list(seen.values())

    @staticmethod
    def _build_summary(results: List[Dict]) -> Dict:
        total  = len(results)
        passed = sum(1 for r in results if r["status"] == "PASS")
        failed = total - passed
        rate   = round(passed / total * 100, 1) if total else 0.0
        return {"total": total, "passed": passed, "failed": failed, "pass_rate": rate}


# ── Utilities ─────────────────────────────────────────────────────────────────

def _id_to_name(tc_id: str) -> str:
    """Convert snake_case testcase id to Title Case name."""
    return " ".join(w.capitalize() for w in tc_id.split("_"))
