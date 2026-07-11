"""
DotNet Test Runner
==================
1. Locates nunit/run.sh (or any run.sh) inside the scaffolding dir.
2. Extracts the embedded tar.gz archive from run.sh (__ARCHIVE__ marker).
3. Places the AI-generated C# files into dotnetapp/ so dotnet can build them.
4. Runs `dotnet test -l "console;verbosity=normal"` directly (avoids run.sh
   platform assumptions about /home/coder/project/workspace).
5. Parses NUnit output into [{id, name, status, error_message}, ...].
"""
import logging
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from io import BytesIO
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# NUnit dotnet-test console output patterns
_PASSED_RE = re.compile(r'^\s*(?:Passed|passed)\s+(\S+)', re.IGNORECASE)
_FAILED_RE = re.compile(r'^\s*(?:Failed|failed)\s+(\S+)', re.IGNORECASE)

# "  Test_AddEvent_Success [PASS]" or "  [PASS] Test_AddEvent_Success"
_BRACKET_PASS_RE = re.compile(r'(?:\[PASS\]|\bPassed\b).*?(\b\w+Test\w*|\bTest_\w+)', re.IGNORECASE)
_BRACKET_FAIL_RE = re.compile(r'(?:\[FAIL\]|\bFailed\b).*?(\b\w+Test\w*|\bTest_\w+)', re.IGNORECASE)

# dotnet test summary line: "Failed!  - Failed:  1, Passed:  8, ..."
_SUMMARY_RE = re.compile(
    r'(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+)',
    re.IGNORECASE,
)


class DotNetTestRunner:

    def __init__(self, scaffolding_dir: str):
        self.scaffolding_dir = os.path.abspath(scaffolding_dir)

    def run(self, generated_files: Dict[str, str], weights: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """
        Full run: find run.sh → extract NUnit project → inject generated C# → dotnet test.

        generated_files: { 'Program.cs': '...', 'EventManager.cs': '...', ... }
                         Keys are filenames; they are written into dotnetapp/
        """
        work_dir = tempfile.mkdtemp(prefix="qc_dotnet_")
        logger.info("DotNet work dir: %s", work_dir)
        try:
            # 1. Find run.sh in the scaffolding dir
            run_sh_path = self._find_run_sh()
            if not run_sh_path:
                return self._error_result("run.sh not found in scaffolding ZIP — make sure nunit/run.sh is included.")

            # 2. Extract the embedded tar.gz from run.sh
            nunit_dir = os.path.join(work_dir, "nunits")
            ok = self._extract_tar_from_run_sh(run_sh_path, work_dir)
            if not ok:
                return self._error_result("Failed to extract tar archive from run.sh.")

            # 3. Locate dotnetapp/ and TestProject/ inside extracted dir
            dotnetapp_dir   = self._find_dir(work_dir, "dotnetapp")
            test_project    = self._find_dir(work_dir, "TestProject")
            solution_file   = self._find_file(work_dir, ".sln")

            if not dotnetapp_dir:
                return self._error_result("dotnetapp/ directory not found after extracting run.sh archive.")
            if not test_project:
                return self._error_result("TestProject/ directory not found after extracting run.sh archive.")

            # 4. Save TestProject .cs files so Code Space can display them
            self._save_testcase_files(test_project)

            # 5-renamed. Inject AI-generated C# files into dotnetapp/
            self._inject_generated_files(dotnetapp_dir, generated_files)

            # 5. Fix TestProject.csproj ProjectReference path to dotnetapp.csproj
            self._fix_csproj_reference(test_project, dotnetapp_dir)

            # 6. Build and run NUnit tests (via NUnit Console Runner, not VSTest).
            stdout, stderr, returncode, result_xml = self._run_dotnet_test(test_project)

            # 8. Parse results — prefer NUnit XML (exact pass/fail per test), fall back to stdout
            results = self._parse_nunit_xml(result_xml) or self._parse_output(stdout, stderr)
            if not results:
                logger.warning("No test results parsed from dotnet test output — dumping stdout")
                for line in stdout.splitlines()[:40]:
                    logger.info("STDOUT: %s", line)

            summary = self._build_summary(results, weights)

            return {
                "results":    results,
                "summary":    summary,
                "raw_output": stdout,
                "raw_stderr": stderr,
            }

        except Exception as e:
            logger.exception("DotNetTestRunner crashed: %s", e)
            return self._error_result(str(e))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    # ── Helpers ───────────────────────────────────────────────────────────────

    @classmethod
    def read_nunit_tests(cls, scaffolding_dir: str) -> str:
        """
        Extract run.sh archive and return the content of all TestProject .cs files
        concatenated as a string.  Called BEFORE AI generation so the agent knows
        the exact class names, method names, and signatures the tests expect.
        Returns empty string on any failure (non-fatal).
        """
        runner = cls(scaffolding_dir=scaffolding_dir)
        run_sh = runner._find_run_sh()
        if not run_sh:
            return ""
        tmp = tempfile.mkdtemp(prefix="qc_dotnet_peek_")
        try:
            if not runner._extract_tar_from_run_sh(run_sh, tmp):
                return ""
            test_project = runner._find_dir(tmp, "TestProject")
            if not test_project:
                return ""
            parts = []
            for root, _dirs, files in os.walk(test_project):
                for fname in sorted(files):
                    if fname.endswith(".cs"):
                        fpath = os.path.join(root, fname)
                        with open(fpath, encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        parts.append(f"// === {fname} ===\n{content}")
            result = "\n\n".join(parts)
            logger.info("read_nunit_tests: read %d test file(s) (%d chars)", len(parts), len(result))
            return result
        except Exception as e:
            logger.warning("read_nunit_tests failed (non-fatal): %s", e)
            return ""
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    @classmethod
    def read_template_source_files(cls, scaffolding_dir: str) -> dict:
        """
        Extract run.sh archive and return {filename: content} for all .cs files
        in dotnetapp/ (the student template), excluding test directories.
        Called BEFORE AI generation so the agent follows the correct structure.
        Returns empty dict on any failure (non-fatal).
        """
        TEST_DIRS = {"nunit", "junit", "test", "testproject", "__tests__"}
        runner = cls(scaffolding_dir=scaffolding_dir)
        run_sh = runner._find_run_sh()
        if not run_sh:
            return {}
        tmp = tempfile.mkdtemp(prefix="qc_dotnet_tmpl_")
        try:
            if not runner._extract_tar_from_run_sh(run_sh, tmp):
                return {}
            dotnetapp_dir = runner._find_dir(tmp, "dotnetapp")
            if not dotnetapp_dir:
                return {}
            result = {}
            for root, dirs, files in os.walk(dotnetapp_dir):
                dirs[:] = [d for d in dirs if d.lower() not in TEST_DIRS]
                for fname in sorted(files):
                    if not fname.endswith(".cs"):
                        continue
                    fpath = os.path.join(root, fname)
                    with open(fpath, encoding="utf-8", errors="ignore") as f:
                        result[fname] = f.read()
            logger.info("read_template_source_files: found %s", list(result.keys()))
            return result
        except Exception as e:
            logger.warning("read_template_source_files failed (non-fatal): %s", e)
            return {}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _find_run_sh(self) -> Optional[str]:
        for root, _dirs, files in os.walk(self.scaffolding_dir):
            for f in files:
                if f == "run.sh":
                    path = os.path.join(root, f)
                    logger.info("Found run.sh at %s", path)
                    return path
        return None

    def _extract_tar_from_run_sh(self, run_sh_path: str, dest_dir: str) -> bool:
        """Find __ARCHIVE__ marker, extract everything after it as tar.gz."""
        with open(run_sh_path, "rb") as f:
            content = f.read()

        marker = b"__ARCHIVE__\n"
        idx = content.find(marker)
        if idx == -1:
            marker = b"__ARCHIVE__\r\n"
            idx = content.find(marker)
        if idx == -1:
            logger.error("__ARCHIVE__ marker not found in run.sh")
            return False

        tar_data = content[idx + len(marker):]
        logger.info("Extracted %d bytes of tar.gz from run.sh", len(tar_data))

        try:
            with tarfile.open(fileobj=BytesIO(tar_data), mode="r:gz") as tf:
                tf.extractall(dest_dir)
            logger.info("tar extracted to %s", dest_dir)
            return True
        except Exception as e:
            logger.error("tarfile extraction failed: %s", e)
            return False

    def _find_dir(self, base: str, name: str) -> Optional[str]:
        for root, dirs, _files in os.walk(base):
            if name in dirs:
                return os.path.join(root, name)
        return None

    def _find_file(self, base: str, ext: str) -> Optional[str]:
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.endswith(ext):
                    return os.path.join(root, f)
        return None

    def _save_testcase_files(self, test_project_dir: str):
        """Copy TestProject .cs files to data/dotnet_testcases/ so Code Space can read them."""
        save_dir = os.path.join(os.getcwd(), "data", "dotnet_testcases")
        os.makedirs(save_dir, exist_ok=True)
        for f in os.listdir(save_dir):
            if f.endswith(".cs"):
                os.remove(os.path.join(save_dir, f))
        for root, _dirs, files in os.walk(test_project_dir):
            for fname in files:
                if fname.endswith(".cs"):
                    src = os.path.join(root, fname)
                    dst = os.path.join(save_dir, fname)
                    shutil.copy2(src, dst)
                    logger.info("Saved testcase file → data/dotnet_testcases/%s", fname)

    def _inject_generated_files(self, dotnetapp_dir: str, generated_files: Dict[str, str]):
        """
        Replace all .cs files in dotnetapp/ with the AI-generated ones.
        We delete existing stubs first so scaffold placeholders don't cause
        duplicate-class compilation errors (CS0101).
        """
        # Remove every .cs file already in the directory (scaffold stubs)
        for fname in os.listdir(dotnetapp_dir):
            if fname.endswith(".cs"):
                old = os.path.join(dotnetapp_dir, fname)
                os.remove(old)
                logger.info("Removed scaffold stub: %s", fname)

        # Write AI-generated files
        for filename, content in generated_files.items():
            dest = os.path.join(dotnetapp_dir, filename)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(content)
            logger.info("Injected generated file → %s (%d chars)", dest, len(content))

    def _fix_csproj_reference(self, test_project_dir: str, dotnetapp_dir: str):
        """
        TestProject.csproj references '../dotnetapp/dotnetapp.csproj'.
        Make that path absolute-ish relative to the test project's actual location.
        """
        csproj = self._find_file(test_project_dir, ".csproj")
        if not csproj:
            return
        with open(csproj, "r", encoding="utf-8") as f:
            content = f.read()
        # Compute relative path from TestProject dir to dotnetapp dir
        rel = os.path.relpath(dotnetapp_dir, start=test_project_dir)
        rel_csproj = os.path.join(rel, "dotnetapp.csproj").replace("\\", "/")
        # Replace any existing reference pattern
        patched = re.sub(
            r'<ProjectReference\s+Include="[^"]*dotnetapp\.csproj"',
            f'<ProjectReference Include="{rel_csproj}"',
            content,
        )
        if patched != content:
            with open(csproj, "w", encoding="utf-8") as f:
                f.write(patched)
            logger.info("Fixed csproj reference → %s", rel_csproj)

    def _find_dotnet_exe(self) -> str:
        """Return 'dotnet' if on PATH, otherwise try well-known install locations."""
        import shutil
        if shutil.which("dotnet"):
            return "dotnet"
        # Windows default install path
        candidates = [
            r"C:\Program Files\dotnet\dotnet.exe",
            r"C:\Program Files (x86)\dotnet\dotnet.exe",
            os.path.expanduser(r"~\.dotnet\dotnet.exe"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                logger.info("Found dotnet at %s", c)
                return c
        return "dotnet"  # will fail with clear error

    def _run_dotnet_test(self, work_dir: str):
        """Build and run NUnit tests. Returns (stdout, stderr, returncode, xml_path).

        Uses NUnit Console Runner (dotnet-nunit) instead of VSTest to avoid
        the protocol negotiation timeout that plagues slow containers.
        """
        logger.info("Running dotnet tests in %s", work_dir)
        dotnet = self._find_dotnet_exe()

        csproj = self._find_file(work_dir, ".csproj")
        target = csproj or work_dir
        logger.info("dotnet build target: %s", target)

        env = os.environ.copy()
        env["COMPlus_EnableDiagnostics"] = "0"
        env["COMPlus_TieredCompilation"] = "0"
        env["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1"
        env["DOTNET_NOLOGO"] = "1"

        # Step 1 — restore
        try:
            subprocess.run(
                [dotnet, "restore", target],
                capture_output=True, text=True, timeout=120, cwd=work_dir, env=env,
            )
        except Exception:
            pass

        # Step 2 — build
        build_result = None
        try:
            build_result = subprocess.run(
                [dotnet, "build", target, "--no-restore", "-c", "Debug"],
                capture_output=True, text=True, timeout=180, cwd=work_dir, env=env,
            )
            logger.info("dotnet build exit=%d", build_result.returncode)
            if build_result.returncode != 0:
                err = (build_result.stdout or "") + (build_result.stderr or "")
                return "", err, 1, ""
        except subprocess.TimeoutExpired:
            return "", "dotnet build timed out after 180 seconds", 1, ""
        except FileNotFoundError:
            return "", f"dotnet not found (tried: {dotnet})", 1, ""

        # Step 3 — find built DLL
        dll = self._find_test_dll(work_dir)
        if not dll:
            return "", "TestProject.dll not found after build", 1, ""
        logger.info("Test DLL: %s", dll)

        # Step 4 — run with NUnit Console (no VSTest, no protocol negotiation)
        result_xml = os.path.join(work_dir, "nunit_result.xml")
        try:
            proc = subprocess.run(
                ["dotnet-nunit", dll, f"--result={result_xml}", "--labels=All"],
                capture_output=True, text=True, timeout=120, cwd=work_dir, env=env,
            )
            logger.info("dotnet-nunit exit=%d stdout=%d", proc.returncode, len(proc.stdout))
            if proc.stderr:
                for line in proc.stderr.splitlines()[:10]:
                    logger.warning("NUNIT STDERR: %s", line)
            return proc.stdout, proc.stderr, proc.returncode, result_xml
        except FileNotFoundError:
            logger.warning("dotnet-nunit not found — falling back to dotnet test")
            return self._run_dotnet_test_vstest(work_dir, target, env)
        except subprocess.TimeoutExpired:
            return "", "dotnet-nunit timed out after 120 seconds", 1, ""

    def _run_dotnet_test_vstest(self, work_dir: str, target: str, env: dict):
        """Fallback: run dotnet test (VSTest) if NUnit Console is not installed."""
        try:
            env["VSTEST_CONNECTION_TIMEOUT"] = "300"
            proc = subprocess.run(
                ["dotnet", "test", target, "--no-build", "--no-restore", "-l", "console;verbosity=normal"],
                capture_output=True, text=True, timeout=300, cwd=work_dir, env=env,
            )
            return proc.stdout, proc.stderr, proc.returncode, ""
        except subprocess.TimeoutExpired:
            return "", "dotnet test timed out after 300 seconds", 1, ""

    def _find_test_dll(self, work_dir: str) -> str:
        """Find the built TestProject DLL in bin/Debug/."""
        for root, _dirs, files in os.walk(work_dir):
            for fname in files:
                if fname == "TestProject.dll" and "bin" in root:
                    return os.path.join(root, fname)
        return ""

    def _parse_nunit_xml(self, xml_path: str) -> List[Dict]:
        """Parse NUnit XML result file produced by dotnet-nunit --result=file.xml."""
        import xml.etree.ElementTree as ET
        if not xml_path or not os.path.exists(xml_path):
            return []
        try:
            root = ET.parse(xml_path).getroot()
            results = []
            for tc in root.iter("test-case"):
                fullname = tc.get("fullname", "") or tc.get("name", "")
                tc_id = fullname.split(".")[-1] if "." in fullname else fullname
                result = tc.get("result", "")
                status = "PASS" if result == "Passed" else "FAIL"
                error_msg = None
                failure = tc.find("failure")
                if failure is not None:
                    msg_el = failure.find("message")
                    error_msg = msg_el.text.strip() if msg_el is not None and msg_el.text else None
                results.append({"id": tc_id, "name": _id_to_name(tc_id), "status": status, "error_message": error_msg})
                logger.info("[%s] %s", status, tc_id)
            logger.info("Parsed %d test results from NUnit XML", len(results))
            return results
        except Exception as e:
            logger.warning("Failed to parse NUnit XML %s: %s", xml_path, e)
            return []

    def _parse_output(self, stdout: str, stderr: str) -> List[Dict]:
        """
        Parse NUnit3 dotnet test console output.
        Handles:
          - "  Passed Test_AddEvent_Success"
          - "  Failed Test_UpdateEvent_NotFound"
          - NUnit adapter lines with [PASS]/[FAIL]
          - dotnet test summary table
        """
        results: Dict[str, Dict] = {}

        for line in stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue

            # "Passed Test_XYZ" / "Failed Test_XYZ"
            m = re.match(r'^(Passed|Failed)\s+(\S+)', stripped, re.IGNORECASE)
            if m:
                status = "PASS" if m.group(1).lower() == "passed" else "FAIL"
                raw_id = m.group(2).strip()
                tc_id  = raw_id.split(".")[-1]   # strip namespace prefix
                if tc_id not in results:
                    results[tc_id] = {"id": tc_id, "name": _id_to_name(tc_id), "status": status, "error_message": None}
                    logger.info("[%s] %s", status, tc_id)
                continue

            # NUnit adapter: "Test Passed: dotnetapp.ProgramTests.Test_XYZ"
            m = re.match(r'NUnit.*?Test\s+(Passed|Failed):\s*(\S+)', stripped, re.IGNORECASE)
            if m:
                status = "PASS" if m.group(1).lower() == "passed" else "FAIL"
                raw_id = m.group(2).strip()
                tc_id  = raw_id.split(".")[-1]
                if tc_id not in results:
                    results[tc_id] = {"id": tc_id, "name": _id_to_name(tc_id), "status": status, "error_message": None}
                    logger.info("[%s] %s", status, tc_id)
                continue

        # Attach error context to failed tests
        if stderr:
            snippet = stderr[:1500]
            for r in results.values():
                if r["status"] == "FAIL":
                    r["error_message"] = snippet

        return list(results.values())

    @staticmethod
    def _build_summary(results: List[Dict], weights: Optional[Dict[str, float]] = None) -> Dict:
        total  = len(results)
        passed = sum(1 for r in results if r["status"] == "PASS")
        failed = total - passed
        rate   = round(passed / total * 100, 1) if total else 0.0

        summary: Dict[str, Any] = {
            "total": total, "passed": passed, "failed": failed, "pass_rate": rate,
        }

        if weights:
            weighted_passed = sum(weights.get(r["id"], 0.0) for r in results if r["status"] == "PASS")
            total_weight    = sum(weights.get(r["id"], 0.0) for r in results)
            summary["weighted_score"] = round(weighted_passed / total_weight * 100, 1) if total_weight else 0.0

        return summary

    @staticmethod
    def _error_result(msg: str) -> Dict[str, Any]:
        logger.error("DotNetTestRunner error: %s", msg)
        return {
            "results":    [],
            "summary":    {"total": 0, "passed": 0, "failed": 0, "pass_rate": 0.0},
            "raw_output": "",
            "raw_stderr": msg,
        }


def _id_to_name(tc_id: str) -> str:
    return " ".join(w.capitalize() for w in tc_id.split("_"))
