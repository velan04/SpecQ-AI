# api.py
import asyncio
import io
import json
import logging
import os
import queue
import shutil
import threading
import zipfile
from typing import Optional

import base64
import re
import subprocess

import httpx
import uvicorn
from bs4 import BeautifulSoup
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Shared pipeline state ─────────────────────────────────────────────────────
pipeline_status = {"running": False, "error": None}
log_queue:    queue.Queue     = queue.Queue()
cancel_event: threading.Event = threading.Event()


# ── WebSocket log handler ─────────────────────────────────────────────────────
class QueueLogHandler(logging.Handler):
    def emit(self, record):
        try:
            log_queue.put_nowait(self.format(record))
        except Exception:
            pass

_formatter = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s — %(message)s", "%H:%M:%S"
)
_ws_handler = QueueLogHandler()
_ws_handler.setFormatter(_formatter)

root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.addHandler(_ws_handler)


@app.get("/")
def root():
    return {"status": "ok"}


# ── POST /api/run ─────────────────────────────────────────────────────────────
@app.post("/api/run")
async def run(
    testcase:        UploadFile        = File(...),
    description:     UploadFile        = File(...),
    scaffolding_zip: UploadFile        = File(default=None),
):
    if pipeline_status["running"]:
        return {"status": "already_running"}

    os.makedirs("data", exist_ok=True)
    os.makedirs("data/scaffolding/public", exist_ok=True)

    # Write uploaded testcase.js and description.txt
    testcase_bytes    = await testcase.read()
    description_bytes = await description.read()

    with open("data/testcase.js",     "w", encoding="utf-8") as f:
        f.write(testcase_bytes.decode("utf-8"))
    with open("data/description.txt", "w", encoding="utf-8") as f:
        f.write(description_bytes.decode("utf-8"))

    # Handle optional scaffolding ZIP
    scaffolding_dir = "data/scaffolding"
    if scaffolding_zip and scaffolding_zip.filename:
        zip_bytes = await scaffolding_zip.read()

        # ── Preserve node_modules so we never re-download puppeteer ──────────
        # shutil.rmtree would wipe node_modules on every run; instead we save
        # it, nuke the rest, re-extract the ZIP, then restore it.
        nm_dir    = os.path.join(scaffolding_dir, "node_modules")
        nm_backup = scaffolding_dir + "_nm_backup"
        nm_exists = os.path.exists(nm_dir)
        if nm_exists:
            shutil.move(nm_dir, nm_backup)
            logging.getLogger("qc_pipeline").info("node_modules preserved (moved to backup)")

        if os.path.exists(scaffolding_dir):
            shutil.rmtree(scaffolding_dir)
        os.makedirs(scaffolding_dir, exist_ok=True)

        # Restore node_modules immediately so npm install is skipped
        if nm_exists and os.path.exists(nm_backup):
            shutil.move(nm_backup, nm_dir)
            logging.getLogger("qc_pipeline").info("node_modules restored — npm install skipped")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            members = zf.infolist()

            # Detect and strip a single root folder (e.g. "streamzip/")
            # so that package.json lands at scaffolding_dir/package.json
            # instead of scaffolding_dir/streamzip/package.json.
            all_names = [m.filename for m in members]
            prefix = ""
            if all_names:
                first_parts = all_names[0].split("/")
                if len(first_parts) > 1:
                    candidate = first_parts[0] + "/"
                    if all(n.startswith(candidate) or n == candidate.rstrip("/") for n in all_names):
                        prefix = candidate

            for member in members:
                rel = member.filename[len(prefix):]   # strip root folder
                if not rel:                            # root folder entry itself
                    continue
                # Never overwrite restored node_modules with ZIP contents
                if rel.startswith("node_modules/") or rel == "node_modules":
                    continue
                target = os.path.join(scaffolding_dir, rel.replace("/", os.sep))
                if member.filename.endswith("/"):      # directory entry
                    os.makedirs(target, exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with zf.open(member) as src, open(target, "wb") as dst:
                        dst.write(src.read())

        # ── Upgrade package.json to use puppeteer compatible with Node v24 ───
        pkg_path = os.path.join(scaffolding_dir, "package.json")
        if os.path.exists(pkg_path):
            import json as _json
            with open(pkg_path, "r", encoding="utf-8") as f:
                pkg = _json.load(f)
            deps = pkg.get("dependencies", {})
            if "puppeteer" in deps and not deps["puppeteer"].startswith("^2"):
                deps["puppeteer"] = "^21.11.0"   # last v21 — stable on Node v24
                pkg["dependencies"] = deps
                with open(pkg_path, "w", encoding="utf-8") as f:
                    _json.dump(pkg, f, indent=2)
                logging.getLogger("qc_pipeline").info(
                    "Updated package.json: puppeteer → ^21.11.0 (Node v24 compatible)"
                )

        logging.getLogger("qc_pipeline").info(
            "Scaffolding ZIP extracted to %s (prefix stripped: '%s')",
            scaffolding_dir, prefix,
        )
    else:
        # No ZIP provided — ensure skeleton public/ files exist
        os.makedirs("data/scaffolding/public", exist_ok=True)
        for fname in ("index.html", "style.css", "script.js"):
            fpath = f"data/scaffolding/public/{fname}"
            if not os.path.exists(fpath):
                open(fpath, "w").close()

    tc_size   = os.path.getsize("data/testcase.js")
    desc_size = os.path.getsize("data/description.txt")
    print(f"[DEBUG] CWD={os.getcwd()} | tc={tc_size}B | desc={desc_size}B")

    # Clear leftover logs from previous run
    while not log_queue.empty():
        try:
            log_queue.get_nowait()
        except queue.Empty:
            break

    log_queue.put_nowait(
        f"00:00:00 [INFO] qc_pipeline — Files received — "
        f"testcase: {tc_size}B | description: {desc_size}B"
    )

    pipeline_status["running"] = True
    pipeline_status["error"]   = None
    cancel_event.clear()

    def _run():
        _logger = logging.getLogger("qc_pipeline")
        if _ws_handler not in _logger.handlers:
            _logger.addHandler(_ws_handler)
        try:
            _logger.info("Pipeline thread started — importing modules…")
            from main import run_pipeline
            run_pipeline(
                testcase_path    = "data/testcase.js",
                description_path = "data/description.txt",
                scaffolding_dir  = scaffolding_dir,
                cancel_event     = cancel_event,
            )
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            pipeline_status["error"] = str(e)
            log_queue.put_nowait(f"[ERROR] Pipeline crashed: {e}")
            for line in tb.splitlines():
                log_queue.put_nowait(f"[ERROR] {line}")
        finally:
            pipeline_status["running"] = False
            log_queue.put_nowait("__DONE__")

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


# ── GET /api/status ───────────────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    return {
        "running": pipeline_status["running"],
        "error":   pipeline_status["error"],
    }


# ── POST /api/cancel ──────────────────────────────────────────────────────────
@app.post("/api/cancel")
def cancel_pipeline():
    if not pipeline_status["running"]:
        return {"status": "not_running"}

    cancel_event.set()
    pipeline_status["running"] = False
    pipeline_status["error"]   = "Cancelled by user"
    log_queue.put_nowait("[INFO] Pipeline cancelled by user.")
    log_queue.put_nowait("__DONE__")
    return {"status": "cancelled"}


# ── GET /api/report ───────────────────────────────────────────────────────────
@app.get("/api/report")
def get_report():
    """Return JSON summary report (generated alongside the Excel file)."""
    report_path = "reports/qc_report.json"
    if not os.path.exists(report_path):
        return JSONResponse(
            {"error": "Report not found. Run the pipeline first."},
            status_code=404,
        )
    with open(report_path, encoding="utf-8") as f:
        return json.load(f)


# ── GET /api/report/excel ─────────────────────────────────────────────────────
@app.get("/api/report/excel")
def download_excel_report():
    """Download the Excel QC report."""
    report_path = "reports/qc_report.xlsx"
    if not os.path.exists(report_path):
        return JSONResponse(
            {"error": "Excel report not found. Run the pipeline first."},
            status_code=404,
        )
    return FileResponse(
        report_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="qc_report.xlsx",
    )


# ── WS /api/logs ──────────────────────────────────────────────────────────────
@app.websocket("/api/logs")
async def websocket_logs(ws: WebSocket):
    await ws.accept()
    ping_counter = 0

    try:
        while True:
            while True:
                try:
                    msg = log_queue.get_nowait()
                    await ws.send_text(msg)
                    if msg == "__DONE__":
                        return
                except queue.Empty:
                    break

            await asyncio.sleep(0.1)
            ping_counter += 1
            if ping_counter >= 50:
                ping_counter = 0
                try:
                    await ws.send_text("__PING__")
                except Exception:
                    break

    except WebSocketDisconnect:
        if pipeline_status["running"]:
            cancel_event.set()
            pipeline_status["running"] = False
            pipeline_status["error"]   = "Client disconnected"
            while not log_queue.empty():
                try:
                    log_queue.get_nowait()
                except queue.Empty:
                    break


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _fetch_api(api_url: str, raw_token: str) -> dict:
    """
    Fetch JSON from the examly platform API.
    Tries multiple auth strategies (raw token → Bearer prefix → no auth)
    then falls back to curl (WinHTTP) on any network-level failure.
    """
    _log = logging.getLogger("qc_pipeline")

    # Thunder Client sends these exact headers — match them precisely.
    def _make_headers(auth_value: str) -> dict:
        h = {
            "accept":          "application/json, text/plain, */*",
            "origin":          "https://admin.orchard.iamneo.in",
            "referer":         "https://admin.orchard.iamneo.in/",
            "user-agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "accept-language": "en-US,en;q=0.9",
            "accept-encoding": "gzip, deflate, br",
        }
        if auth_value:
            h["authorization"] = auth_value
        return h

    # Strategy list: raw token first (matches Thunder Client exactly), then Bearer, then no auth
    strategies = []
    if raw_token:
        strategies.append(("raw token",    raw_token))
        strategies.append(("Bearer token", f"Bearer {raw_token}"))
    strategies.append(("no auth", ""))

    last_status = None
    last_text   = ""

    try:
        async with httpx.AsyncClient(
            timeout=30, verify=False,
            follow_redirects=True,
        ) as client:
            for label, auth_val in strategies:
                hdrs = _make_headers(auth_val)
                _log.info("httpx attempt [%s] → %s", label, api_url)
                _log.debug("HEADERS SENT: %s", {
                    k: (v[:20] + "…" if k == "authorization" and len(v) > 20 else v)
                    for k, v in hdrs.items()
                })
                try:
                    res = await client.get(api_url, headers=hdrs)
                    last_status = res.status_code
                    last_text   = res.text[:400]
                    _log.info("STATUS: %d | RESPONSE[:200]: %s", res.status_code, res.text[:200])
                    if res.status_code == 200:
                        return res.json()
                    _log.warning("Strategy [%s] → HTTP %d — trying next", label, res.status_code)
                except Exception as exc:
                    _log.warning("Strategy [%s] → request error: %s", label, exc)
    except Exception as outer:
        _log.warning("httpx client setup failed: %s — falling back to curl", outer)

    # ── curl fallback (WinHTTP — same stack as Chrome / Thunder Client) ───────
    _log.info("Falling back to curl for %s", api_url)
    # Use raw token exactly like Thunder Client does (no "Bearer " prefix)
    curl_auth = raw_token or ""
    curl_cmd = [
        "curl", "-s", "--max-time", "30",
        "--compressed",   # accept gzip/br
        "--insecure",     # skip SSL verify (same as verify=False)
        "-X", "GET", api_url,
        "-H", f"authorization: {curl_auth}",
        "-H", "accept: application/json, text/plain, */*",
        "-H", "origin: https://admin.orchard.iamneo.in",
        "-H", "referer: https://admin.orchard.iamneo.in/",
        "-H", "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "accept-language: en-US,en;q=0.9",
        "-w", "\n__STATUS__%{http_code}",
    ]
    proc = await asyncio.to_thread(
        lambda: subprocess.run(curl_cmd, capture_output=True, text=True, timeout=35)
    )
    _log.info("curl returncode=%d | stderr: %s", proc.returncode, proc.stderr[:300])

    if proc.returncode != 0:
        raise RuntimeError(
            f"curl failed (rc={proc.returncode}): {proc.stderr[:200]}\n"
            f"Last httpx → status={last_status} body={last_text}"
        )

    if "__STATUS__" not in proc.stdout:
        raise RuntimeError(f"Unexpected curl output (no status marker): {proc.stdout[:300]}")

    body, status_str = proc.stdout.rsplit("__STATUS__", 1)
    status = int(status_str.strip()) if status_str.strip().isdigit() else 0
    _log.info("curl HTTP %d | body[:300]: %s", status, body[:300])

    if status != 200:
        raise RuntimeError(
            f"Platform API returned HTTP {status}.\n"
            f"Body: {body[:400]}\n"
            f"→ Check question ID and token (last httpx status: {last_status})"
        )

    return json.loads(body)


async def _fetch_image_b64(client: httpx.AsyncClient, url: str, raw_token: str):
    """
    Fetch one image and return (url, data_uri) or (url, None) on failure.
    Tries multiple auth strategies so S3 / CDN protected images are handled.
    """
    _log = logging.getLogger("qc_pipeline")

    # Build ordered strategy list: auth variants first, then no-auth
    strategies = []
    if raw_token:
        strategies.append(("raw token",    {"User-Agent": "Mozilla/5.0", "Referer": "https://admin.orchard.iamneo.in/", "authorization": raw_token}))
        strategies.append(("Bearer token", {"User-Agent": "Mozilla/5.0", "Referer": "https://admin.orchard.iamneo.in/", "authorization": f"Bearer {raw_token}"}))
    strategies.append(("no auth", {"User-Agent": "Mozilla/5.0", "Referer": "https://admin.orchard.iamneo.in/"}))

    for label, hdrs in strategies:
        try:
            res = await client.get(url, headers=hdrs)
            ct = res.headers.get("content-type", "")
            _log.info("IMG [%s] STATUS=%d CT=%s URL=%s", label, res.status_code, ct[:40], url[-60:])
            if res.status_code == 200 and res.content:
                # Reject HTML error pages masquerading as 200
                if "text/html" in ct:
                    _log.warning("IMG [%s] → got HTML instead of image — skipping this strategy", label)
                    continue
                mime = ct.split(";")[0].strip() or "image/png"
                if not mime.startswith("image/"):
                    mime = "image/png"
                b64 = base64.b64encode(res.content).decode()
                _log.info("IMG [%s] → embedded %d bytes as %s", label, len(res.content), mime)
                return url, f"data:{mime};base64,{b64}"
            _log.warning("IMG [%s] → HTTP %d — trying next strategy", label, res.status_code)
        except Exception as exc:
            _log.warning("IMG [%s] → error: %s", label, exc)

    _log.warning("IMG → ALL strategies failed for %s", url[-80:])
    return url, None


async def _process_description(description_html: str, raw_token: str) -> tuple:
    """Embed all external images as base64 using BeautifulSoup + asyncio.gather."""
    _log = logging.getLogger("qc_pipeline")
    soup = BeautifulSoup(description_html, "lxml")
    img_tags = soup.find_all("img")
    img_urls = [img.get("src") for img in img_tags if (img.get("src") or "").startswith("http")]

    _log.info("Found %d image(s) to embed", len(img_urls))
    for u in img_urls:
        _log.info("  IMG URL: %s", u[:100])

    async with httpx.AsyncClient(timeout=30, follow_redirects=True, verify=False) as client:
        results = await asyncio.gather(
            *[_fetch_image_b64(client, url, raw_token) for url in img_urls],
            return_exceptions=True,
        )

    replaced = 0
    url_to_b64 = {}
    for result in results:
        if isinstance(result, tuple):
            url, b64 = result
            if b64:
                url_to_b64[url] = b64
                replaced += 1

    for img in img_tags:
        src = img.get("src", "")
        if src in url_to_b64:
            img["src"] = url_to_b64[src]

    _log.info("Images: %d/%d embedded successfully", replaced, len(img_urls))
    return str(soup), replaced, len(img_urls)


async def _download_zip(zip_url: str, raw_token: str = "") -> bool:
    """
    Download boilerplate ZIP from S3.

    Root cause confirmed via DevTools: the S3 bucket uses CORS — it only requires
      Origin: https://admin.orchard.iamneo.in
    No Authorization / cookies needed. Sending extra auth headers causes S3 to reject.

    Exact headers mirrored from the successful browser request.
    """
    _log = logging.getLogger("qc_pipeline")
    zip_path = "data/imported_boilerplate.zip"

    # Mirror exact browser headers — NO auth header (S3 CORS needs Origin only)
    hdrs = {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "Accept":          "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin":          "https://admin.orchard.iamneo.in",
        "Referer":         "https://admin.orchard.iamneo.in/",
        "Cache-Control":   "no-cache",
        "Pragma":          "no-cache",
    }

    _log.info("ZIP download → %s", zip_url[:100])

    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True, verify=False) as client:
            res = await client.get(zip_url, headers=hdrs)

        ct   = res.headers.get("content-type", "")
        size = len(res.content)
        _log.info("ZIP STATUS=%d | SIZE=%d | CT=%s", res.status_code, size, ct[:60])

        if res.status_code == 200 and size > 0:
            if res.content[:4] != b'PK\x03\x04':
                _log.warning("ZIP → not a real ZIP (magic=%s) — response body: %s",
                             res.content[:4], res.content[:200])
                # Fall through to curl
            else:
                os.makedirs("data", exist_ok=True)
                with open(zip_path, "wb") as f:
                    f.write(res.content)
                _log.info("ZIP saved: %d bytes ✅", size)
                return True
        else:
            _log.warning("ZIP → HTTP %d / empty — trying curl", res.status_code)

    except Exception as e:
        _log.warning("ZIP httpx error: %s — trying curl", e)

    # ── curl fallback — same headers, no auth ─────────────────────────────────
    _log.info("ZIP curl fallback → %s", zip_url[:100])
    curl_cmd = [
        "curl", "-s", "-L", "--insecure", "--max-time", "60",
        "--compressed",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "Accept: */*",
        "-H", "Accept-Language: en-US,en;q=0.9",
        "-H", "Origin: https://admin.orchard.iamneo.in",
        "-H", "Referer: https://admin.orchard.iamneo.in/",
        "-H", "Cache-Control: no-cache",
        "-o", zip_path,
        zip_url,
    ]
    proc = await asyncio.to_thread(
        lambda: subprocess.run(curl_cmd, capture_output=True, timeout=65)
    )
    _log.info("ZIP curl rc=%d | stderr: %s", proc.returncode, (proc.stderr or b"")[:200])

    if proc.returncode == 0 and os.path.exists(zip_path):
        size = os.path.getsize(zip_path)
        with open(zip_path, "rb") as f:
            magic = f.read(4)
        if magic != b'PK\x03\x04':
            _log.warning("ZIP curl → not a real ZIP (magic=%s size=%d) — body: %s",
                         magic, size, open(zip_path, "rb").read(200))
            return False
        _log.info("ZIP curl saved: %d bytes ✅", size)
        return True

    _log.warning("ZIP curl failed (rc=%d)", proc.returncode)
    return False


# ── POST /api/search-questionbanks ───────────────────────────────────────────
@app.post("/api/search-questionbanks")
async def search_questionbanks(body: dict):
    """
    Search examly question banks by name.
    Body: { "search_term": "...", "token": "..." }
    Calls POST https://api.examly.io/api/v2/questionbanks and returns
    { questionbanks: [...], count: N }
    """
    search_term = (body.get("search_term") or "").strip()
    token       = (body.get("token")       or "").strip()

    if not search_term:
        return JSONResponse({"error": "search_term is required"}, status_code=400)
    if not token:
        return JSONResponse({"error": "token is required"}, status_code=400)

    raw_token = token[7:] if token.lower().startswith("bearer ") else token
    _log = logging.getLogger("qc_pipeline")

    api_url = "https://api.examly.io/api/v2/questionbanks"
    payload = {
        "branch_id":          "all",
        "page":               1,
        "limit":              25,
        "visibility":         "All",
        "search":             search_term,
        "department_id":      [
    "617346bd-b9c8-468d-9099-12170fb3b570",
    "8c9bb195-1e81-4506-bc39-c48e6450c2a0",
    "58efa904-a695-4c14-8335-124c9ec5e95a",
    "4b375029-26ec-4d20-bf46-1122dfc584ae",
    "d40c4d09-8ac5-4a26-b969-ce9cc8685180",
    "e0f02ce1-486b-4122-8f1b-d80f7076bee3",
    "04c14795-d8b2-41c0-9c41-997a5630f455",
    "074cbc54-a20f-4a5d-9c02-1ca6a1bed28f",
    "da3f5269-34b1-49c4-8d38-30c18b4f6598",
    "f04c0f04-f6d7-434d-b8c9-5c356805ffab",
    "f0b8af1b-288a-4b41-97b1-27447014ada3",
    "2b60843d-7972-4235-82cb-0ebc33d75d63",
    "78b66861-c946-4d83-9754-75c32925b5a9",
    "5d1e18e7-b9aa-4d43-93b3-eb0a7a3df0d6",
    "82208516-6d07-4fc0-8ee4-4205601c6695",
    "b55a5b74-7f4a-428e-a59b-377dd8c7e4ba",
    "35700f99-19f6-42c2-a336-d32687690e4a",
    "c47b433a-7f1d-4014-a5b9-415187ed118b",
    "fb751a89-c97a-47a6-9795-a33b3ba2eede",
    "c02099c7-354a-48a9-867c-91cd16c6de38",
    "4bb74161-364a-4012-9122-be5597db9f9e",
    "a9ac9b80-daf9-45c3-aa4e-3aecd0a3820b",
    "91f6683d-2512-416a-a355-2c6eefe9507b",
    "6aa4e718-9fd9-4911-85c0-b900eed73547",
    "2d24fa30-2621-418b-9597-0442ff8997df",
    "5d4d3d63-73cd-4b04-a579-6c4f9fdf7473",
    "55faaca8-4375-4bc6-874e-740dbf3dd22e",
    "e100cac4-4586-4f3a-b598-24ee8d6c7a92",
    "ffa1501f-1747-4ea7-9b83-22b3ab409d51",
    "97c0a54a-67d2-4bc6-87b6-74b369e15889",
    "627f1e5a-3e5e-4e14-b948-eab0baf714c4",
    "d7d9bd6a-7bdc-46aa-8929-458e674f94c5",
    "c3d1f72d-aa83-4276-9976-c5fcb06f70f8",
    "4bf536a6-a9fa-4215-a803-056f0074e3e7",
    "2680fe23-89dc-4035-a7a6-eb1869630f81",
    "1dce25ce-cb7a-4826-a7e4-ab4c189bf436",
    "e641144f-f801-4f79-8f3b-cff27ab3a123",
    "7296cb61-76ce-4064-8928-328f2a545666",
    "48942306-1e80-4db5-bd3b-e3075202d9b8",
    "0ba8c5fa-9754-4d7f-851a-aa4791b9b445",
    "8b0329c3-626e-4644-b6f4-dcb0424ed9fa",
    "969b5384-e5ac-46aa-996b-547e5c77c3bf",
    "41b64d5f-bb55-47a7-ad77-208e27ccae80",
    "0400731b-2ab3-4644-828e-7c1618b23aac",
    "e024b5b6-d6db-4fe6-a445-8b49facf10bb",
    "d5c3f38f-fc70-4ac8-af83-372cd006396f",
    "09f0cbe3-5c20-4c75-9c50-b4ee6fa6d09a",
    "8154bcaa-3ee6-423f-938e-e4ccfe6002a7",
    "4d037902-f46b-4fcf-824a-8f65376dbdcc",
    "4ced5ede-47de-42b8-a5e3-a5af9d0ce415",
    "566994d3-6a6f-4174-899a-700468f4bc7a",
    "ebd40260-e32b-4367-8b8f-c606793e423b",
    "6adf26cd-4949-4501-99c4-336401d84b49",
    "64195871-472d-4520-839b-be0b8cbf2a94",
    "4af00c09-f6a8-4099-8699-1c6a57db677b",
    "0eb0005e-01b2-412a-a325-d0ea0ab9d64c",
    "282bae70-ecb4-469a-94d0-8df0917b6ed4",
    "62024afb-ea1e-4a6b-ad01-cbf1e592ed3c",
    "662bd1f5-9c20-411a-aad0-e00e1881a6f2",
    "54d15165-fc20-4e2e-bc1a-19e46c6a6f30",
    "3f3711bd-ba73-404a-b72a-dee82166d2b4",
    "a17c1837-80dd-4d0f-9a05-629e8f00eeb5",
    "617ce4f5-33ec-4ff6-b1a6-1c74220be379",
    "bf6ce3d6-8552-4959-bc65-9068c8f7738b",
    "3f0fd32e-4290-488f-8e93-ba49d4dc1ecd",
    "51827123-a24e-4aac-a23b-cbf3b95177e5",
    "7a309bfc-d490-4269-8c36-f2899e02de65",
    "9a64ffc7-47af-4f28-8dfa-31718a16ea7b",
    "bd3777c4-635f-435a-94da-3426f786d592",
    "6204bdfd-9a00-42b5-b951-0ab9a7a22105",
    "173df851-7e75-43f1-9185-19028621a66f",
    "e9fecb8e-8553-4d23-ac96-eca3da15af90",
    "8eeae087-ce46-4d8a-9d0d-aefef190f0cd",
    "00522911-f5fa-48fd-acb2-333b40117b82",
    "41698284-bb61-4f6c-aaf1-591182d9025d",
    "901ff1b8-cc03-4bb3-96b9-42bb53e86701",
    "5c490195-95f7-4577-a9cb-3096d940af5d",
    "1b18fbbf-a4ca-45df-ab78-75480a154b4a",
    "ef6771c4-b9f5-4593-b4f6-ae9cd8845ec2",
    "b073f250-c7eb-4d6b-829e-3af6ceb94037",
    "78dc3377-b4a2-4338-b17e-6d8dde7cfeb1",
    "ba75398b-44ce-487a-9dcd-f57339241e8d",
    "a09496c9-0412-4649-944f-2edca43cb252",
    "756c5ccf-535e-4b26-8d5f-3acc607e9a81",
    "34c1f447-25af-4a75-9abf-be10d1626076",
    "82156a68-a333-4217-8ac6-4863dd04d457",
    "e329730f-6efb-47d0-a86c-04e764487a28",
    "47e36ac4-0185-41c2-992c-d18c57d4a331",
    "9783c0ce-d618-4909-adf9-79b2c9d2f10e",
    "55cd2a51-53b1-47a3-9869-56e3d6bba559",
    "c5758329-0590-4b1f-8447-f64d20c21b96",
    "1abc3b49-cb7a-4d1d-a507-69fd139e57ae",
    "61164b98-a492-4009-b2a9-9c94f01ef8a8",
    "f650e3df-80fa-4e27-b254-3dd802a071a7",
    "015b365f-9bcd-41c4-92fd-9e3e475cbdac",
    "281d8e09-ea24-4aee-9d62-bb945c33fc7a",
    "9f1b6c5b-ff23-4c7e-b3e6-576f36f893d5",
    "3610abcc-b6f4-4a8e-b593-77c165755778",
    "9697e209-d83d-41f3-a51b-8de4de0bbe54",
    "9a4a2f10-f5bd-420f-a71c-3e25f70c2ceb",
    "cfeff396-511e-472b-bd3f-288dff86a343",
    "151656b3-5b14-4397-a293-8c8962ef1075",
    "c8f816f8-836d-4fe6-9ad6-d48fe5fd372d",
    "5473cf88-4fca-4b1c-a978-b1c25589654c",
    "b7ec2e38-e5e8-44f1-9427-229b4c15c443",
    "8f5f4ff5-6322-414f-a26d-38a2ebaaaf58",
    "ad35005d-9bb8-4e59-8df6-c4a164d4be1f",
    "9c95a180-5ae6-4109-b5bf-ca28b3f45c53",
    "c1323b4a-12ec-4906-86d2-fcbc4cc261be",
    "5eba9f0f-94be-45c5-b811-b351b9e81a2d",
    "d4dee91f-ee3f-4153-a78f-2114bf3e5b56",
    "b5c43777-62fb-4841-8044-df9635e168a5",
    "b55f9101-3379-4f7d-8ee5-be8c4662b73d",
    "705909cd-368f-4d89-8bc4-b88e545448aa",
    "6591339a-64fd-419b-82a2-01b4198184f7",
    "e9280c07-148f-4634-86fd-566e2b99ca95",
    "7ce72cef-ca43-47b2-ab98-b98e08c3fd86",
    "48a4f5de-81d3-414d-95c7-b5697e4ec0c7",
    "cb36e5e9-8a8e-4986-9a66-f5f42449042c",
    "c7952fcf-7717-455a-bde4-c91cb60049af",
    "e57f0a5b-0175-4515-afdc-03b328c10d67",
    "b2fa115a-7a45-44da-801c-db58b8bca7fc",
    "7ef066c2-1ec3-4d01-bc63-9bb6656db39d",
    "2bdda40a-c0bd-45df-8a82-746c2b20b2da",
    "bacc7663-1f43-42f6-b8dc-4c66acb4297b",
    "27f62bde-822a-4c0f-ad8e-045040b8e934",
    "31ae9c6f-27fe-4663-9990-73386e96629a",
    "8505dbb5-5f20-4ecd-8f48-7420ae03f534",
    "c2115608-5c5e-43bb-81ed-bcbe6abd5ea4",
    "a7cf5456-3f82-4806-bf09-6f44e1fcab21",
    "79240270-23db-4198-8725-d1089f9318d2",
    "14fcae52-23a2-438b-bb43-39d46e3ea893",
    "6216ec5f-4fbb-49e5-a254-c860c6d1e140",
    "bb0e3364-9e7b-406c-a9d4-02a08704328e",
    "222eaa3f-45f9-41b1-bada-696b546cfb9d",
    "2dd8ea99-5949-489a-9285-2c8b5b85753a",
    "31f8d373-cfbd-43a2-ab82-eb58092c8c97",
    "7b2996dd-8a2c-4f10-acc2-ea5fea34560e",
    "31e5ede1-4cd7-4553-8eef-a1e6f844473b",
    "01260f18-169c-4282-a488-5e3754b791d5",
    "a7ddc1d2-ff9c-465f-85b4-2392dca7bb9e",
    "417d7e8e-b67f-4876-8b49-465edfa3fea5",
    "cdf9e40b-4a7e-4997-9d18-76881e841388",
    "01700388-139b-4619-9912-e9dd256ad138",
    "a4a6b6e8-ee6d-4fcf-9b45-588bca3e9a4c",
    "f7ea2ee2-21fd-4d68-bc6e-09130e4094db",
    "59cd174c-9db8-4d9d-969a-9e512088e070",
    "d8438731-8bbf-43f2-8fab-77e0fd8d648d",
    "09595055-f58b-4553-9c83-5c4b3ea0ccd6",
    "7173c6bb-5ddd-4be4-8d90-c0ca20d026dd",
    "9d6c825d-a33f-4ed8-a655-82d1aeb04f15",
    "14d1d827-d1a4-4987-bebe-fd130d4d6cae",
    "f1bef9fc-7143-496e-b93d-ab012331827c",
    "915ab31b-d6cb-4f46-82be-8b4fd479f3de",
    "94bd5479-d7f3-4dd0-9dae-dedc4c6fa012",
    "3400dd35-a7a0-4698-8f52-cf5a9482137c",
    "8dc7ae8e-a0ca-4145-97dc-081bcdf57ee6",
    "68b78a7d-69e2-4da0-b3e8-f725529b5fb4",
    "85772620-880b-490e-9e48-43802d87fde0",
    "a6fcc1f1-33fd-44d0-9108-ebb4fde83812",
    "cedf9edb-da95-4f11-b2ec-ac4cffaad082",
    "100339e6-fd74-4788-aaa7-7b71393f853b",
    "4e105e28-1ff3-4a0d-a478-edd9cf6f8f19",
    "15a62605-ef22-4abd-9419-f2a774dfd698",
    "fd0c3941-6627-43ad-aef9-ce70ae8e53e0",
    "16cce3db-a5e5-421a-a0fa-77413e6b7060",
    "d0213c8f-ce30-4e1e-bf3a-4ed7b5eac816",
    "57179013-211d-4cd4-8dc0-e7ac67b2e9f0",
    "5f356b4a-3b4e-4dce-876e-053204b8e230",
    "40c0ad24-4542-45f4-ac62-65d3bab424c8",
    "fac7cd78-8b9a-4e25-b42d-fadd6583ee7c",
    "d529028c-3078-46cb-a738-657a6e50e262",
    "e8f57bbe-c013-4218-a264-4e81c5931d3c",
    "facf2af9-736a-4000-a110-90c4635ea36b",
    "89125fd5-2012-4136-ad39-d37df6ed7a78",
    "c16ef372-33dd-4b20-8c7b-2be4772722c9",
    "a1a1e135-11aa-479a-bd55-168fa6141b10",
    "3b5b124f-043e-4069-89b5-b57651c138f3",
    "c2901b26-f8eb-4f96-be7d-47eb644f9680",
    "52352d83-2b00-43c8-a0aa-9e1c2a6a9abd",
    "ed3ee737-a0a6-4013-8634-bd7d71fd0f2c",
    "a41e7dc1-5ef3-4f19-99c6-a9ca573f3b97",
    "9189f6e9-5f5f-4a31-adc1-5a86c23193cd",
    "1fc7d3b0-4729-4917-84b9-65094ff1009a",
    "d48f544c-58a4-4964-9333-dba210753bd2",
    "b833ff49-b040-435c-8011-1e4114c25c32",
    "a1075450-cc65-43d2-9ab9-434f5b7ce915",
    "044dee11-7458-4bc1-8d00-6f6a283ab29f",
    "723fc88c-b62b-40d0-9bff-5b025164e861",
    "544418dd-dc1e-46b2-bc7d-14e800edbeb2",
    "fe740dc8-9f92-4bcb-be96-460f701d3ade",
    "abc4c56f-ca12-4e30-aeb0-4b3b26a47feb",
    "103613db-d963-4296-a2c7-ad7dea7a65e5",
    "8e25e053-8dca-427f-b741-ced1bb04ccc5",
    "b57301f2-c40f-40d0-9526-b0411c2bf5ad",
    "5f27abb2-00c3-4df3-95d7-fbd7cb802d6d",
    "7480295d-0923-475e-a54b-8c8bdcce6984",
    "21f2438a-e000-40cd-a6eb-3ee38c29a563",
    "1ea36c05-0eb3-425e-9cb2-ca9a662d9d3d",
    "5354feb0-d71d-4ebf-b2d2-da9ef2263f6f"
],
        "mainDepartmentUser": True,
    }
    headers = {
        "accept":          "application/json, text/plain, */*",
        "content-type":    "application/json",
        "authorization":   raw_token,
        "origin":          "https://admin.orchard.iamneo.in",
        "referer":         "https://admin.orchard.iamneo.in/",
        "user-agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "accept-language": "en-US,en;q=0.9",
    }

    try:
        async with httpx.AsyncClient(timeout=30, verify=False, follow_redirects=True, trust_env=True) as client:
            res = await client.post(api_url, headers=headers, json=payload)
            _log.info("search-questionbanks HTTP %d | body[:200]: %s", res.status_code, res.text[:200])
            if res.status_code != 200:
                return JSONResponse(
                    {"error": f"Platform API returned HTTP {res.status_code}. Check your token."},
                    status_code=502,
                )
            data = res.json()
    except Exception as exc:
        _log.error("search-questionbanks error: %s", exc)
        return JSONResponse({"error": str(exc)}, status_code=502)

    results  = data.get("results", {})
    qbanks   = results.get("questionbanks", [])
    count    = results.get("count", len(qbanks))
    return {"questionbanks": qbanks, "count": count}


# ── POST /api/questions-in-bank ───────────────────────────────────────────────
@app.post("/api/questions-in-bank")
async def questions_in_bank(body: dict):
    qb_id = (body.get("qb_id") or "").strip()
    token = (body.get("token") or "").strip()

    if not qb_id:
        return JSONResponse({"error": "qb_id is required"}, status_code=400)
    if not token:
        return JSONResponse({"error": "token is required"}, status_code=400)

    raw_token = token[7:] if token.lower().startswith("bearer ") else token

    url = "https://api.examly.io/api/v2/questionfilter"

    payload = {
        "qb_id": qb_id,
        "type": "Single",   # 🔥 important
        "page": 1,
        "limit": 50
    }

    headers = {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "authorization": raw_token,
        "origin": "https://admin.orchard.iamneo.in",
        "referer": "https://admin.orchard.iamneo.in/",
        "user-agent": "Mozilla/5.0"
    }

    _log = logging.getLogger("qc_pipeline")

    try:
        async with httpx.AsyncClient(timeout=30, verify=False, follow_redirects=True) as client:
            res = await client.post(url, headers=headers, json=payload)
            _log.info("questions-in-bank HTTP %d | body[:200]: %s", res.status_code, res.text[:200])

            if res.status_code != 200:
                return JSONResponse({
                    "status": res.status_code,
                    "error":  res.text[:400],
                }, status_code=502)

            data = res.json()

    except Exception as e:
        _log.error("questions-in-bank error: %s", e)
        return JSONResponse({"error": str(e)}, status_code=502)

    raw_qs = data.get("non_group_questions", [])

    # Normalise: extract question_id + a readable project title from the HTML
    questions = []
    for q in raw_qs:
        q_id = q.get("q_id", "")
        html  = q.get("question_data", "")

        # Try to find "Project Title: ..." in the raw HTML
        title_m = re.search(r'Project Title[:\s\u00a0]*([^<\n\r]{3,120})', html, re.IGNORECASE)
        if title_m:
            name = title_m.group(1).strip().rstrip('&nbsp;').strip()
        else:
            # Fallback: strip all tags, grab first 80 meaningful chars
            plain = re.sub(r'<[^>]+>', ' ', html)
            plain = re.sub(r'\s+', ' ', plain).strip()
            name  = plain[:80] if plain else f"Question {q_id[:8]}"

        questions.append({
            "question_id":   q_id,   # used by /api/import-question
            "question_name": name,
        })

    return {
        "questions": questions,
        "count":     data.get("number_of_questions", len(questions)),
    }


# ── POST /api/import-question ────────────────────────────────────────────────
@app.post("/api/import-question")
async def import_question(body: dict):
    """
    Fetch question from examly platform API by question_id + JWT token.
    Accepts optional question_data (description HTML) from the frontend —
    because question_data lives in the questionfilter response, not in
    /api/project_question/:id, the frontend passes it directly.
    """
    question_id   = (body.get("question_id")   or "").strip()
    token         = (body.get("token")         or "").strip()
    question_data = (body.get("question_data") or "").strip()

    if not question_id:
        return JSONResponse({"error": "question_id is required"}, status_code=400)
    if not token:
        return JSONResponse({"error": "token is required"}, status_code=400)

    raw_token = token[7:] if token.lower().startswith("bearer ") else token

    api_url = f"https://api.examly.io/api/project_question/{question_id}"
    logging.getLogger("qc_pipeline").info("Importing question: %s", api_url)

    # 1. Fetch question JSON (tries raw token, Bearer prefix, no-auth, then curl)
    try:
        data = await _fetch_api(api_url, raw_token)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    return await _build_import_response(data, raw_token, question_data_override=question_data)


# ── POST /api/import-from-json ───────────────────────────────────────────────
@app.post("/api/import-from-json")
async def import_from_json(body: dict):
    """
    Import by passing the raw platform API JSON + optional question_data.
    question_data (description HTML) comes from the questionsInBank response —
    it is not present in the /api/project_question/:id response.
    """
    platform_json = body.get("platform_json")
    token         = (body.get("token")         or "").strip()
    question_data = (body.get("question_data") or "").strip()

    if not platform_json:
        return JSONResponse({"error": "platform_json is required"}, status_code=400)

    raw_token = token[7:] if token.lower().startswith("bearer ") else token

    return await _build_import_response(platform_json, raw_token, question_data_override=question_data)


async def _build_import_response(data: dict, auth_header: str, question_data_override: str = ""):
    """Shared logic: extract fields, embed images, download ZIP, save description."""
    _logger = logging.getLogger("qc_pipeline")

    learning    = data.get("learning", {})
    answer      = data.get("answer",   {})
    boilerplate = answer.get("boilerPlate", {})
    zip_url     = boilerplate.get("url", "")
    zip_filename = boilerplate.get("file", "boilerplate.zip")
    configs     = answer.get("config", [{}])
    testcases   = configs[0].get("testcases", []) if configs else []

    # question_data lives in the questionfilter response, not in project_question.
    # Frontend passes it via question_data_override; fall back to learning.question_data.
    description_html = question_data_override or learning.get("question_data", "")

    if not description_html:
        return JSONResponse({"error": "No question_data found. Pass question_data in the request body."}, status_code=422)

    # 2. Embed images
    enriched_html, images_embedded, images_total = await _process_description(description_html, auth_header)

    # 3. Save description.txt
    os.makedirs("data", exist_ok=True)
    with open("data/description.txt", "w", encoding="utf-8") as f:
        f.write(enriched_html)
    _logger.info("Saved description.txt (%d chars)", len(enriched_html))

    # 4. Download ZIP — S3 needs Origin header only, no auth token
    zip_saved = await _download_zip(zip_url) if zip_url else False

    return {
        "description":     enriched_html,
        "testcases":       testcases,
        "zip_url":         zip_url,
        "zip_filename":    zip_filename,
        "zip_saved":       zip_saved,
        "images_embedded": images_embedded,
        "images_total":    images_total,
    }


# ── GET /api/imported-zip ─────────────────────────────────────────────────────
@app.get("/api/imported-zip")
def get_imported_zip():
    """Download the boilerplate ZIP fetched by /api/import-question."""
    path = "data/imported_boilerplate.zip"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No imported ZIP found. Run import-question first.")
    return FileResponse(path, media_type="application/zip", filename="boilerplate.zip")


# ── POST /api/fetch-image ─────────────────────────────────────────────────────
@app.post("/api/fetch-image")
async def fetch_image(body: dict):
    """
    Fetch an external image and return it as base64.
    Body: {
        "url":         "https://...",
        "token":       "your_token_value",          (optional)
        "header_name": "Authorization",             (optional, default: try multiple)
        "cookie_name": "token",                     (optional, e.g. "session", "auth_token")
    }
    Strategy: tries multiple approaches in order until one succeeds.
    """
    import base64
    import httpx

    url         = body.get("url", "").strip()
    token       = body.get("token", "").strip()
    header_name = body.get("header_name", "").strip()   # e.g. "Authorization", "X-Auth-Token"
    cookie_name = body.get("cookie_name", "").strip()   # e.g. "session", "token"

    if not url:
        return JSONResponse({"error": "url is required"}, status_code=400)

    base_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": url,
    }

    # Build list of header sets to try in order
    attempts = []

    if token:
        if header_name:
            # User explicitly specified the header — try it first
            attempts.append({**base_headers, header_name: token})
        else:
            # Try cookie strategies (best for S3 / CDN URLs that use session cookies)
            for cname in [cookie_name or "token", "auth_token", "session", "access_token"]:
                attempts.append({**base_headers, "Cookie": f"{cname}={token}"})
            # Try Authorization header variants
            attempts.append({**base_headers, "Authorization": f"Bearer {token}"})
            attempts.append({**base_headers, "Authorization": token})
            attempts.append({**base_headers, "X-Auth-Token": token})

    # Always try without auth too (maybe public URL)
    attempts.append(base_headers)

    last_status = None
    last_body   = None

    async with httpx.AsyncClient(timeout=30, follow_redirects=True, verify=False) as client:
        for hdrs in attempts:
            try:
                resp = await client.get(url, headers=hdrs)
                logging.getLogger("qc_pipeline").debug(
                    "fetch-image attempt headers=%s → status=%d",
                    list(hdrs.keys()), resp.status_code,
                )
                if resp.status_code == 200:
                    content_type = resp.headers.get("content-type", "image/png").split(";")[0].strip()
                    if not content_type.startswith("image/"):
                        content_type = "image/png"
                    b64 = base64.b64encode(resp.content).decode()
                    return {
                        "data_url":     f"data:{content_type};base64,{b64}",
                        "content_type": content_type,
                        "size_bytes":   len(resp.content),
                    }
                last_status = resp.status_code
                last_body   = resp.text[:300]
            except Exception as exc:
                last_body = str(exc)

    return JSONResponse(
        {
            "error":       f"All fetch attempts failed. Last HTTP status: {last_status}",
            "detail":      last_body,
            "hint":        (
                "If the image is behind a login, open DevTools → Network tab → "
                "find the image request → copy the exact Cookie header value and "
                "paste it into the 'Cookie header value' field."
            ),
        },
        status_code=422,
    )


# ── GET /api/description ─────────────────────────────────────────────────────
@app.get("/api/description")
def get_description():
    """Return the description.txt that was used for the last AI generation."""
    path = "data/description.txt"
    if not os.path.exists(path):
        return JSONResponse({"error": "description.txt not found. Run the pipeline first."}, status_code=404)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    return {"content": content}


# ── GET /api/testcase ─────────────────────────────────────────────────────────
@app.get("/api/testcase")
def get_testcase():
    """Return the testcase.js used for the last pipeline run."""
    path = "data/testcase.js"
    if not os.path.exists(path):
        return JSONResponse({"error": "testcase.js not found. Run the pipeline first."}, status_code=404)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    return {"content": content}


# ── GET /api/solution-files ───────────────────────────────────────────────────
@app.get("/api/solution-files")
def get_solution_files():
    """Return AI-generated index.html, style.css, script.js as JSON."""
    public_dir = "data/scaffolding/public"
    result = {}
    for fname in ("index.html", "style.css", "script.js"):
        fpath = os.path.join(public_dir, fname)
        try:
            with open(fpath, encoding="utf-8") as f:
                result[fname] = f.read()
        except FileNotFoundError:
            result[fname] = ""
    return result


# ── PUT /api/solution-files ───────────────────────────────────────────────────
@app.put("/api/solution-files")
async def save_solution_files(body: dict):
    """Save edited solution files back to disk."""
    public_dir = "data/scaffolding/public"
    os.makedirs(public_dir, exist_ok=True)
    saved = []
    for fname in ("index.html", "style.css", "script.js"):
        if fname in body:
            with open(os.path.join(public_dir, fname), "w", encoding="utf-8") as f:
                f.write(body[fname])
            saved.append(fname)
    return {"status": "saved", "files": saved}


# ── GET /api/preview/{filename} ───────────────────────────────────────────────
@app.get("/api/preview/{filename}")
def preview_solution_file(filename: str):
    """Serve generated files so the preview iframe can load them with correct MIME types."""
    allowed = {"index.html", "style.css", "script.js"}
    if filename not in allowed:
        raise HTTPException(status_code=404, detail="File not found")
    fpath = os.path.join("data/scaffolding/public", filename)
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="File not generated yet")
    media = {
        "index.html": "text/html",
        "style.css":  "text/css",
        "script.js":  "application/javascript",
    }
    return FileResponse(fpath, media_type=media[filename])


# ── POST /api/run-tests ───────────────────────────────────────────────────────
@app.post("/api/run-tests")
async def run_tests_only():
    """Re-run Puppeteer tests against the current AI-generated solution (no regeneration)."""
    if pipeline_status["running"]:
        return {"status": "already_running"}

    scaffolding_dir = "data/scaffolding"
    testcase_path   = os.path.join(scaffolding_dir, "testcase.js")
    if not os.path.exists(testcase_path):
        return JSONResponse(
            {"error": "testcase.js not found — run the full pipeline first."},
            status_code=404,
        )

    # Clear previous logs
    while not log_queue.empty():
        try:
            log_queue.get_nowait()
        except queue.Empty:
            break

    pipeline_status["running"] = True
    pipeline_status["error"]   = None
    cancel_event.clear()

    def _run():
        _logger = logging.getLogger("qc_pipeline")
        if _ws_handler not in _logger.handlers:
            _logger.addHandler(_ws_handler)
        try:
            from tools.test_runner           import TestRunner
            from agents.failure_analyzer_agent import FailureAnalyzerAgent
            from tools.text_cleaner          import strip_base64_images
            from tools.excel_reporter        import generate_excel_report
            from config.settings             import EXCEL_REPORT_FILE
            import json

            _logger.info("═══ Node: run_tests ═══")
            runner  = TestRunner(scaffolding_dir=scaffolding_dir, testcase_path=testcase_path)
            outcome = runner.run()
            test_results = outcome["results"]
            test_summary = outcome["summary"]
            _logger.info(
                "Tests complete — %d/%d passed (%.1f%%)",
                test_summary["passed"], test_summary["total"], test_summary["pass_rate"],
            )

            # Failure analysis for any failures
            failure_analysis = []
            failed = [r for r in test_results if r["status"] == "FAIL"]
            if failed:
                _logger.info("═══ Node: analyze_failures ═══")
                public_dir = os.path.join(scaffolding_dir, "public")
                generated  = {}
                for fname in ("index.html", "style.css", "script.js"):
                    fp = os.path.join(public_dir, fname)
                    if os.path.exists(fp):
                        with open(fp, encoding="utf-8") as f:
                            generated[fname] = f.read()
                with open("data/description.txt", encoding="utf-8") as f:
                    desc = strip_base64_images(f.read())
                with open("data/testcase.js", encoding="utf-8") as f:
                    tc = f.read()
                agent = FailureAnalyzerAgent()
                failure_analysis = agent.analyze(failed, desc, generated, tc)

            # Save Excel + JSON report
            generate_excel_report(test_results, test_summary, failure_analysis, EXCEL_REPORT_FILE)
            report = {
                "summary":          test_summary,
                "test_results":     test_results,
                "failure_analysis": failure_analysis,
            }
            json_path = EXCEL_REPORT_FILE.replace(".xlsx", ".json")
            os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
            _logger.info("✅ Test re-run complete — report updated.")

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            pipeline_status["error"] = str(e)
            log_queue.put_nowait(f"[ERROR] Test run failed: {e}")
            for line in tb.splitlines():
                log_queue.put_nowait(f"[ERROR] {line}")
        finally:
            pipeline_status["running"] = False
            log_queue.put_nowait("__DONE__")

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port)
