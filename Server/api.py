# api.py
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio, json, os, logging, threading, queue

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://specq-ai-jdl3.onrender.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Shared pipeline state ─────────────────────────────────────────────────────
pipeline_status = {"running": False, "error": None}
log_queue:    queue.Queue     = queue.Queue()
cancel_event: threading.Event = threading.Event()   # set() to request a stop


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

# Attach only to root logger — child loggers propagate up automatically.
# Attaching to both root AND named children causes every log line to appear twice.
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.addHandler(_ws_handler)


@app.get("/")
def root():
    return {"status": "ok"}


# ── POST /api/run ─────────────────────────────────────────────────────────────
@app.post("/api/run")
async def run(
    testcase:    UploadFile = File(...),
    description: UploadFile = File(...),
):
    if pipeline_status["running"]:
        return {"status": "already_running"}

    os.makedirs("data", exist_ok=True)

    # Read bytes then write as UTF-8 text (handles HTML + base64 images correctly)
    testcase_bytes    = await testcase.read()
    description_bytes = await description.read()

    with open("data/testcase.js",     "w", encoding="utf-8") as f:
        f.write(testcase_bytes.decode("utf-8"))
    with open("data/description.txt", "w", encoding="utf-8") as f:
        f.write(description_bytes.decode("utf-8"))

    tc_size   = os.path.getsize("data/testcase.js")
    desc_size = os.path.getsize("data/description.txt")
    print(f"[DEBUG] CWD={os.getcwd()} | tc={tc_size}B | desc={desc_size}B")

    # Clear leftover logs from previous run AFTER writing the size info
    while not log_queue.empty():
        try:
            log_queue.get_nowait()
        except queue.Empty:
            break

    # Put a first visible log so the frontend knows things are moving
    log_queue.put_nowait(
        f"00:00:00 [INFO] qc_pipeline — Files received — testcase: {tc_size}B | description: {desc_size}B"
    )

    pipeline_status["running"] = True
    pipeline_status["error"]   = None
    cancel_event.clear()          # reset any previous cancel request

    def _run():
        logger = logging.getLogger("qc_pipeline")
        # Re-attach inside thread for safety (some environments isolate per-thread)
        if _ws_handler not in logger.handlers:
            logger.addHandler(_ws_handler)
        try:
            logger.info("Pipeline thread started — importing modules…")
            from main import run_pipeline
            run_pipeline(
                testcase_path    = "data/testcase.js",
                description_path = "data/description.txt",
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
    """
    Signal the running pipeline to stop and immediately mark it as not running.

    The background thread may still be mid-request to Groq (those calls are not
    interruptible), but pipeline_status is reset right away so the frontend can
    start a fresh run without waiting for the old thread to fully unwind.
    """
    if not pipeline_status["running"]:
        return {"status": "not_running"}

    cancel_event.set()                    # tell the pipeline to stop at next checkpoint
    pipeline_status["running"] = False    # unblock the frontend immediately
    pipeline_status["error"]   = "Cancelled by user"
    log_queue.put_nowait("[INFO] Pipeline cancelled by user.")
    log_queue.put_nowait("__DONE__")
    return {"status": "cancelled"}


# ── GET /api/report ───────────────────────────────────────────────────────────
@app.get("/api/report")
def get_report():
    report_path = "reports/qc_report.json"
    if not os.path.exists(report_path):
        return {"error": "Report not found. Run the pipeline first."}
    with open(report_path, encoding="utf-8") as f:
        return json.load(f)


# ── WS /api/logs ──────────────────────────────────────────────────────────────
@app.websocket("/api/logs")
async def websocket_logs(ws: WebSocket):
    """
    Streams pipeline log lines to the React frontend in real time.

    Protocol:
      "__PING__"  — keepalive every ~5 s
      "__DONE__"  — pipeline finished; frontend calls GET /api/report
      any other   — log line for the terminal panel
    """
    await ws.accept()
    ping_counter = 0

    try:
        while True:
            # Drain entire queue in one pass before sleeping
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
            if ping_counter >= 50:   # ~5 s
                ping_counter = 0
                try:
                    await ws.send_text("__PING__")
                except Exception:
                    break

    except WebSocketDisconnect:
        # Frontend reloaded or closed the tab while the pipeline was running.
        # Reset running state immediately so the next /api/run isn't blocked.
        if pipeline_status["running"]:
            cancel_event.set()
            pipeline_status["running"] = False
            pipeline_status["error"]   = "Client disconnected"
            # Drain the queue so stale logs don't bleed into the next run
            while not log_queue.empty():
                try:
                    log_queue.get_nowait()
                except queue.Empty:
                    break


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port)