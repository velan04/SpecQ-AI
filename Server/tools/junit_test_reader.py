"""
JUnit Test Reader
=================
Extracts .java test files from the embedded tar.gz archive inside junit.sh.

Archive layout (inside tar):
  junits/test/java/com/examly/*.java   ← test files we want
  junits/junit.sh                      ← inner runner (ignored)
  junits/Report/...                    ← report tooling (ignored)
"""
import logging
import os
import shutil
import tarfile
import tempfile
from io import BytesIO
from typing import Dict

logger = logging.getLogger(__name__)


def read_junit_tests(scaffolding_dir: str) -> Dict[str, str]:
    """
    Walk scaffolding_dir for junit.sh, extract its embedded tar.gz,
    and return { filename: content } for every .java file under
    junits/test/.
    Returns empty dict on any failure (non-fatal).
    """
    junit_sh = _find_junit_sh(scaffolding_dir)
    if not junit_sh:
        logger.info("read_junit_tests: no junit.sh found in %s", scaffolding_dir)
        return {}

    with open(junit_sh, "rb") as f:
        raw = f.read()

    marker = b"__ARCHIVE__\n"
    idx = raw.find(marker)
    if idx == -1:
        marker = b"__ARCHIVE__\r\n"
        idx = raw.find(marker)
    if idx == -1:
        logger.warning("read_junit_tests: __ARCHIVE__ marker not found in %s", junit_sh)
        return {}

    tar_data = raw[idx + len(marker):]
    tmp = tempfile.mkdtemp(prefix="qc_junit_peek_")
    try:
        with tarfile.open(fileobj=BytesIO(tar_data), mode="r:gz") as tf:
            tf.extractall(tmp)

        result = {}
        test_root = _find_test_dir(tmp)
        if not test_root:
            logger.warning("read_junit_tests: no test/ directory found in archive")
            return {}

        for root, _dirs, files in os.walk(test_root):
            for fname in sorted(files):
                if fname.endswith(".java"):
                    fpath = os.path.join(root, fname)
                    with open(fpath, encoding="utf-8", errors="ignore") as fh:
                        result[fname] = fh.read()
                    logger.info("read_junit_tests: found %s", fname)

        logger.info("read_junit_tests: total %d file(s)", len(result))
        return result

    except Exception as e:
        logger.warning("read_junit_tests failed (non-fatal): %s", e)
        return {}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _find_junit_sh(base: str) -> str:
    for root, _dirs, files in os.walk(base):
        for f in files:
            if f == "junit.sh":
                path = os.path.join(root, f)
                logger.info("Found junit.sh at %s", path)
                return path
    return ""


def _find_test_dir(base: str) -> str:
    """Return the first directory named 'test' anywhere under base."""
    for root, dirs, _files in os.walk(base):
        if "test" in dirs:
            return os.path.join(root, "test")
    return ""
