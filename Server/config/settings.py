import os
from dotenv import load_dotenv

load_dotenv()

# ── Groq API Keys (add as many as you have) ───────────────────────────────────
# In your .env file add:
#   GROQ_API_KEY_1=your_first_key
#   GROQ_API_KEY_2=your_second_key
#   GROQ_API_KEY_3=your_third_key
# Or just a single GROQ_API_KEY for backward compatibility

def _load_api_keys() -> list:
    keys = []
    # Load numbered keys: GROQ_API_KEY_1, GROQ_API_KEY_2, ...
    for i in range(1, 11):
        k = os.getenv(f"GROQ_API_KEY_{i}", "").strip()
        if k:
            keys.append(k)
    # Fallback: single GROQ_API_KEY
    if not keys:
        single = os.getenv("GROQ_API_KEY", "").strip()
        if single:
            keys.append(single)
    return keys

GROQ_API_KEYS     = _load_api_keys()
GROQ_API_KEY      = GROQ_API_KEYS[0] if GROQ_API_KEYS else ""  # backward compat

GROQ_MODEL_FAST       = "llama-3.1-8b-instant"      # testcase extractor
GROQ_MODEL_STRONG     = "llama-3.3-70b-versatile"   # description extractor
GROQ_MODEL_COMPARATOR = "llama3-70b-8192" 

# ── Token limits ──────────────────────────────────────────────────────────────
MAX_TOKENS_FAST   = 2000
MAX_TOKENS_STRONG = 8192

# Groq on_demand tier: llama-3.3-70b-versatile hard cap = 12,000 tokens/request
# (input + output combined).  Keep max_output low so input headroom is preserved.
# Formula: estimated_input_tokens + MAX_TOKENS_COMPARATOR < 12_000
MAX_TOKENS_COMPARATOR = 3500   # safe ceiling; keeps total well under 12 k

# How many testcases to send per comparator call.
# Smaller batches = smaller prompts = fewer 413 errors when testcase lists grow.
COMPARATOR_BATCH_SIZE = 10

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Used only if all keys are exhausted
RETRY_DELAY_SECONDS = 65

# ── OCR ───────────────────────────────────────────────────────────────────────
OCR_ENABLED    = True
OCR_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "ocr_images")
OCR_API_URL    = os.getenv("OCR_API_URL", "https://velan2904-image-ocr.hf.space/ocr")

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR      = os.path.join(BASE_DIR, "data")
REPORTS_DIR   = os.path.join(BASE_DIR, "reports")
TESTCASE_FILE = os.path.join(DATA_DIR, "testcase.js")
DESC_FILE     = os.path.join(DATA_DIR, "description.txt")
REPORT_FILE   = os.path.join(REPORTS_DIR, "qc_report.json")

# ── LangGraph ─────────────────────────────────────────────────────────────────
MAX_RETRIES = 3
VERBOSE     = True