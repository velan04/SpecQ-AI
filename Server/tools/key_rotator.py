"""
API Key Rotator
===============
Rotates through multiple Groq API keys automatically.
When one key hits a 429 (rate limit), it switches to the next key instantly.
No waiting — just switches keys.

Usage:
    from tools.key_rotator import KeyRotator
    rotator = KeyRotator()
    client  = rotator.get_client()          # get current key's LLM
    rotator.mark_rate_limited()             # call on 429 → rotates to next key
"""
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class KeyRotator:
    """
    Manages a pool of Groq API keys.
    Rotates to the next key on rate limit (429).
    Falls back to waiting only when ALL keys are exhausted.
    """

    def __init__(self, api_keys: list, model: str, max_tokens: int = 8192, temperature: float = 0):
        if not api_keys:
            raise ValueError("No API keys provided. Add GROQ_API_KEY_1, GROQ_API_KEY_2 etc. to .env")

        self.api_keys    = api_keys
        self.model       = model
        self.max_tokens  = max_tokens
        self.temperature = temperature
        self.current_idx = 0

        # Track when each key was rate-limited (Unix timestamp)
        self.rate_limited_at: dict = {}

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
        )

    def invoke_with_rotation(self, messages: list) -> str:
        """
        Invoke the LLM with automatic key rotation on 429.
        Tries every available key before falling back to waiting.
        """
        attempted = set()

        while True:
            key_idx = self.current_idx
            if key_idx in attempted and len(attempted) >= len(self.api_keys):
                # All keys exhausted — wait for the earliest one to reset
                wait = self._wait_for_reset()
                logger.info("All %d keys rate-limited. Waiting %ds...", len(self.api_keys), wait)
                time.sleep(wait)
                self.rate_limited_at.clear()
                self.current_idx = 0
                attempted.clear()
                continue

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
                    self._rotate()
                elif "401" in err_str or "invalid_api_key" in err_str.lower():
                    self._rotate()
                else:
                    raise

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _active_key(self) -> str:
        return self.api_keys[self.current_idx]

    def _rotate(self):
        """Mark current key as rate-limited and move to next."""
        self.rate_limited_at[self.current_idx] = time.time()
        self.current_idx = (self.current_idx + 1) % len(self.api_keys)
        logger.info(
            "Rotated to key %d/%d.",
            self.current_idx + 1, len(self.api_keys)
        )

    def _wait_for_reset(self) -> int:
        """Return seconds to wait for the earliest rate-limited key to reset (60s window)."""
        now = time.time()
        reset_times = [
            max(0, 60 - (now - ts))
            for ts in self.rate_limited_at.values()
        ]
        return int(min(reset_times)) + 2 if reset_times else 65