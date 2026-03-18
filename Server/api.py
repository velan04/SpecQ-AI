# api.py
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio, json, shutil, os, logging, threading, queue

from main import run_pipeline

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://specq-ai-jdl3.onrender.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Shared pipeline state ─────────────────────────────────────────────────────
pipeline_status = {"running": False, "error": None}
log_queue: queue.Queue = queue.Queue()


# ── WebSocket log handler — captures ALL pipeline logs ───────────────────────
class QueueLogHandler(logging.Handler):
    def emit(self, record):
        log_queue.put(self.format(record))

_ws_handler = QueueLogHandler()
_ws_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s — %(message)s", "%H:%M:%S")
)
logging.getLogger().addHandler(_ws_handler)


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

    # Save uploaded files to disk
    os.makedirs("data", exist_ok=True)
    with open("data/testcase.js",     "wb") as f:
        shutil.copyfileobj(testcase.file, f)
    with open("data/description.txt", "wb") as f:
        shutil.copyfileobj(description.file, f)

    # Debug: confirm files were written correctly
    print(
        f"[DEBUG] CWD={os.getcwd()} | "
        f"tc={os.path.getsize('data/testcase.js')}B | "
        f"desc={os.path.getsize('data/description.txt')}B"
    )

    # Clear any leftover log messages from a previous run
    while not log_queue.empty():
        try:
            log_queue.get_nowait()
        except queue.Empty:
            break

    # Mark as running
    pipeline_status["running"] = True
    pipeline_status["error"]   = None

    # Run the heavy pipeline in a background thread so FastAPI stays responsive
    def _run():
        try:
            run_pipeline(
                testcase_path="data/testcase.js",
                description_path="data/description.txt",
            )
        except Exception as e:
            pipeline_status["error"] = str(e)
            log_queue.put(f"PIPELINE ERROR: {e}")
        finally:
            pipeline_status["running"] = False
            log_queue.put("__DONE__")

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


# ── GET /api/status ───────────────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    """React polls this every 2 s as a fallback when the WebSocket closes early."""
    return {
        "running": pipeline_status["running"],
        "error":   pipeline_status["error"],
    }


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
      "__PING__"  — keepalive sent every ~5 s so the browser does not close the socket
      "__DONE__"  — pipeline finished; React should call GET /api/report
      any other   — a raw log line to display in the terminal panel
    """
    await ws.accept()
    ping_counter = 0

    try:
        while True:
            try:
                msg = log_queue.get_nowait()
                await ws.send_text(msg)
                if msg == "__DONE__":
                    break
            except queue.Empty:
                await asyncio.sleep(0.1)
                ping_counter += 1
                if ping_counter >= 50:
                    ping_counter = 0
                    try:
                        await ws.send_text("__PING__")
                    except Exception:
                        break

    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)