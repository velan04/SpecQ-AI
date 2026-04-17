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

# ── Dedicated key per agent ───────────────────────────────────────────────────
# Each agent gets its own key so they never share a TPM bucket.
# Falls back to sharing all keys if fewer keys are configured.
def _agent_keys(idx: int) -> list:
    if len(GROQ_API_KEYS) > idx:
        return [GROQ_API_KEYS[idx]]
    return GROQ_API_KEYS

def _agent_keys_pick(*indices) -> list:
    """Return keys at the given indices. Skips missing indices gracefully."""
    keys = [GROQ_API_KEYS[i] for i in indices if i < len(GROQ_API_KEYS)]
    return keys if keys else GROQ_API_KEYS

def _agent_keys_range(start: int, end: int) -> list:
    """Return a slice of keys from start to end index (inclusive).
    Used to give the comparator 2 keys so it can rotate between batches."""
    keys = [GROQ_API_KEYS[i] for i in range(start, min(end + 1, len(GROQ_API_KEYS)))]
    return keys if keys else GROQ_API_KEYS

GROQ_API_KEYS_FAST       = _agent_keys(0)          # Key 1 → testcase extractor
GROQ_API_KEYS_STRONG     = _agent_keys_pick(1, 4)  # Key 2 + Key 5 → description extractor
GROQ_API_KEYS_COMPARATOR = _agent_keys_range(2, 3) # Key 3 + Key 4 → comparator (2 batches)

# ── Models (same powerful model for all — each key has its own 12k TPM) ───────
GROQ_MODEL_FAST       = "llama-3.3-70b-versatile"  # testcase extractor
GROQ_MODEL_STRONG     = "llama-3.3-70b-versatile"  # description extractor
GROQ_MODEL_COMPARATOR = "llama-3.3-70b-versatile"  # comparator

# ── Token limits ──────────────────────────────────────────────────────────────
MAX_TOKENS_FAST   = 2000
MAX_TOKENS_STRONG = 8192
MAX_TOKENS_COMPARATOR = 2000

# How many testcases to send per comparator call.
# Smaller batches = smaller prompts = fewer 413 errors when testcase lists grow.
COMPARATOR_BATCH_SIZE = 5

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