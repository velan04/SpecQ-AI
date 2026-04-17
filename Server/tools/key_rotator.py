"""
API Key Rotator
===============
Rotates through multiple Groq API keys automatically.
When one key hits a 429 (rate limit), it switches to the next key instantly.
No waiting — just switches keys.

Handles two types of 429:
  • TPM (per-minute) limit  — retry-after is short (< 120s); wait and retry.
  • Daily (RPD) limit       — retry-after is long  (≥ 120s); skip key for session.

Usage:
    from tools.key_rotator import KeyRotator
    rotator = KeyRotator()
    client  = rotator.get_client()          # get current key's LLM
    rotator.mark_rate_limited()             # call on 429 → rotates to next key
"""
import logging
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Retry-after values >= this threshold (seconds) are treated as daily/account
# limits rather than per-minute TPM limits. The key is marked dead for the
# session and skipped on all subsequent rotations.
DAILY_LIMIT_THRESHOLD = 120


class KeyRotator:
    """
    Manages a pool of Groq API keys.
    Rotates to the next key on rate limit (429).
    Falls back to waiting only when ALL keys are exhausted.
    Respects the Groq retry-after header to distinguish TPM vs daily limits.
    """

    def __init__(self, api_keys: list, model: str, max_tokens: int = 8192, temperature: float = 0):
        if not api_keys:
            raise ValueError("No API keys provided. Add GROQ_API_KEY_1, GROQ_API_KEY_2 etc. to .env")

        self.api_keys    = api_keys
        self.model       = model
        self.max_tokens  = max_tokens
        self.temperature = temperature
        self.current_idx = 0

        # key_idx → Unix timestamp when the key becomes available again
        self.retry_after_until: dict[int, float] = {}

        # key indices permanently skipped this session (daily limit hit)
        self.session_dead: set[int] = set()

        logger.info(
            "KeyRotator initialised with %d key(s) for model: %s",
            len(api_keys), model
        )

    # ── Public API ────────────────────────────────────────────────────────────

    def get_llm(self):
        """Return a ChatGroq instance using the current active key."""
        from langchain_groq import ChatGroq
        key = self._active_key()
        return ChatGroq(
            api_key=key,
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            max_retries=0,
        )

    def invoke_with_rotation(self, messages: list) -> str:
        """
        Invoke the LLM with automatic key rotation on 429.
        Tries every available key before falling back to waiting.
        Daily-limited keys (retry-after >= 120s) are skipped for the session.
        """
        attempted: set[int] = set()

        while True:
            # Find a usable key (not session-dead, not currently TPM-limited)
            key_idx = self._pick_available_key(attempted)

            if key_idx is None:
                # All live keys attempted in this round — check if any TPM keys
                # will reset soon enough to be worth waiting for.
                wait = self._wait_for_tpm_reset()
                if wait is None:
                    # No TPM keys either — only daily-dead keys remain.
                    raise RuntimeError(
                        "All Groq API keys have hit their daily rate limit. "
                        "Add more keys (GROQ_API_KEY_N) or wait until tomorrow."
                    )
                logger.info(
                    "All %d key(s) TPM rate-limited. Waiting %ds for reset...",
                    len(self.api_keys), wait,
                )
                time.sleep(wait)
                # Clear TPM limits that have expired; leave session_dead intact.
                now = time.time()
                self.retry_after_until = {
                    k: v for k, v in self.retry_after_until.items() if v > now
                }
                attempted.clear()
                self.current_idx = 0
                continue

            self.current_idx = key_idx
            attempted.add(key_idx)

            try:
                llm      = self.get_llm()
                response = llm.invoke(messages)
                logger.debug("Key %d/%d succeeded.", key_idx + 1, len(self.api_keys))
                return response.content.strip()

            except Exception as e:
                err_str = str(e)
                if "413" in err_str or "Payload Too Large" in err_str:
                    raise RuntimeError(
                        f"Request too large for model token budget. "
                        f"Reduce max_tokens in settings.py. Error: {e}"
                    )
                elif "429" in err_str or "rate_limit" in err_str.lower():
                    retry_after = self._parse_retry_after(e)
                    self._handle_rate_limit(key_idx, retry_after)
                elif "401" in err_str or "invalid_api_key" in err_str.lower():
                    self.session_dead.add(key_idx)
                    logger.warning("Key %d/%d is invalid — skipping for session.", key_idx + 1, len(self.api_keys))
                else:
                    raise

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _active_key(self) -> str:
        return self.api_keys[self.current_idx]

    def _pick_available_key(self, attempted: set[int]) -> Optional[int]:
        """
        Find the next key index that is:
          • not session-dead
          • not already attempted this round
          • not currently TPM-rate-limited (or its window has expired)
        Returns None if no such key exists.
        """
        now = time.time()
        n   = len(self.api_keys)
        for offset in range(n):
            idx = (self.current_idx + offset) % n
            if idx in self.session_dead:
                continue
            if idx in attempted:
                continue
            # If it was TPM-limited, check if window expired
            if idx in self.retry_after_until and self.retry_after_until[idx] > now:
                continue
            return idx
        return None

    def _handle_rate_limit(self, key_idx: int, retry_after: int):
        """
        React to a 429 on key_idx.
        • retry_after >= DAILY_LIMIT_THRESHOLD → mark session-dead, skip forever.
        • retry_after < threshold              → mark TPM-limited, rotate.
        """
        if retry_after >= DAILY_LIMIT_THRESHOLD:
            self.session_dead.add(key_idx)
            logger.warning(
                "Key %d/%d hit DAILY rate limit (retry-after %ds ≥ %ds threshold). "
                "Marking dead for this session.",
                key_idx + 1, len(self.api_keys), retry_after, DAILY_LIMIT_THRESHOLD,
            )
        else:
            reset_at = time.time() + max(retry_after, 60) + 2
            self.retry_after_until[key_idx] = reset_at
            next_idx = (key_idx + 1) % len(self.api_keys)
            self.current_idx = next_idx
            logger.info(
                "Key %d/%d TPM rate-limited (retry-after %ds). Rotated to key %d/%d.",
                key_idx + 1, len(self.api_keys), retry_after,
                next_idx + 1, len(self.api_keys),
            )

    def _parse_retry_after(self, exc: Exception) -> int:
        """
        Extract the retry-after value (seconds) from a Groq 429 exception.
        Falls back to 60 if not parseable.
        """
        # groq SDK exposes response headers on RateLimitError
        try:
            headers = exc.response.headers  # type: ignore[attr-defined]
            val = headers.get("retry-after") or headers.get("x-ratelimit-reset-requests")
            if val:
                return int(float(val))
        except Exception:
            pass

        # Fall back: scan the error string for "retry-after: NNN" or similar
        err_str = str(exc)
        for pattern in (
            r"retry.after['\"]?\s*[=:]\s*(\d+)",
            r"retry_after['\"]?\s*[=:]\s*(\d+)",
            r"'retry-after':\s*'(\d+)'",
        ):
            m = re.search(pattern, err_str, re.IGNORECASE)
            if m:
                return int(m.group(1))

        return 60  # safe default (TPM-style wait)

    def _wait_for_tpm_reset(self) -> Optional[int]:
        """
        Return seconds until the soonest TPM-limited (non-dead) key resets.
        Returns None if there are no TPM-limited keys (only dead keys remain).
        """
        now  = time.time()
        live = [
            v for k, v in self.retry_after_until.items()
            if k not in self.session_dead
        ]
        if not live:
            return None
        return int(min(live) - now) + 1