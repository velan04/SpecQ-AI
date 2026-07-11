"""
DotNet Solution Generator Agent
================================
Reads description + OCR text → generates correct C# implementation files
(Program.cs + domain classes) that satisfy the NUnit tests embedded in run.sh.

Output: { 'Program.cs': '...', 'EventManager.cs': '...', ... } (filenames → content)
"""
import json
import logging
import re
from typing import Dict, List, Optional

from config.settings import (
    GROQ_API_KEYS_SOLUTION, GROQ_MODEL_SOLUTION, MAX_TOKENS_SOLUTION, MAX_RETRIES,
)
from tools.key_rotator import KeyRotator
from tools.text_cleaner import strip_base64_images
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

DOTNET_SYSTEM = """You are a senior C# / .NET developer implementing a complete solution
based on a project description and starter template files.

You will be given:
1. STARTER TEMPLATE — the existing boilerplate .cs files from the project scaffolding
2. PROJECT DESCRIPTION — full specification of the .NET console application
3. (Optional) OCR TEXT — text extracted from description images

YOUR MISSION: Generate complete, correct C# implementation files.

════════════════════════════════════════
CRITICAL IMPLEMENTATION RULES:
════════════════════════════════════════

RULE 0 — FOLLOW THE STARTER TEMPLATE EXACTLY:
Study the starter template files carefully.
Copy ALL `using` directives from the template into your output — add more if needed.
Keep the same namespace, class names, and method signatures shown in the template.
Your implementation replaces the stub bodies but preserves the structure.

RULE 0b — ALWAYS INCLUDE THESE STANDARD NAMESPACES IN EVERY .cs FILE THAT NEEDS THEM:
using System;
using System.Text;
using System.Collections.Generic;
using System.Linq;
using System.IO;
Never omit `using System.Text;` when using StringBuilder.
Never omit `using System.Collections.Generic;` when using List<T>, Dictionary<K,V>, etc.
Never omit `using System.Linq;` when using LINQ methods.

RULE 0c — NEVER PRINT INPUT PROMPTS:
NUnit tests use Console.SetOut to capture ALL console output and compare it to an exact expected string.
Any extra text written to Console (like "Enter a string:", "Input:", "Enter value:") will cause every test to FAIL.
In Main(), read input silently — do NOT call Console.Write() or Console.WriteLine() before Console.ReadLine().
WRONG:  Console.Write("Enter a string: ");
        string input = Console.ReadLine();
CORRECT: string input = Console.ReadLine();

RULE 1 — ONE CLASS PER FILE, NEVER REPEAT:
Each class/exception/struct must appear in EXACTLY ONE file.
NEVER define the same class in two different files — this causes CS0101 compile errors.
Program.cs must contain ONLY the Program class with a Main method.
Do NOT put domain classes (VehiclePart, EventManager, etc.) inside Program.cs.

RULE 2 — FOLLOW THE DESCRIPTION EXACTLY:
Implement every class, method, property, and behaviour described.
Use the EXACT names stated in the description for classes, methods, and properties.

RULE 3 — EXACT CONSOLE OUTPUT STRINGS:
NUnit tests verify Console.WriteLine output with StringAssert.Contains.
Use the EXACT strings shown in the description. Common patterns:
  - "Part added successfully."
  - "Part ID already exists."
  - "Part with ID {id} not found."
  - "No parts available."

RULE 4 — EXCEPTION CLASSES:
Implement all custom exceptions as named in the tests (e.g. PartNotFoundException).
The Message property must match the expected string exactly.
Put each exception in its OWN file (e.g. PartNotFoundException.cs).

RULE 5 — COLLECTIONS:
Use the correct .NET collection type (List<T>, Dictionary<K,V>, etc.) as implied by
the description. Prefer List<T> unless a keyed lookup is clearly required.

RULE 6 — NAMESPACE:
Use namespace `dotnetapp` for ALL classes so TestProject can reference them with
`using dotnetapp;`.

RULE 7 — OUTPUT FORMAT:
Return ONLY a JSON object with filename → content pairs. No extra prose.
Example for a VehicleParts project:
{
  "Program.cs": "using System;\\nnamespace dotnetapp {\\n  class Program {\\n    static void Main(string[] args) {}\\n  }\\n}",
  "VehiclePart.cs": "namespace dotnetapp { ... }",
  "VehiclePartsStorageSystem.cs": "namespace dotnetapp { ... }",
  "PartNotFoundException.cs": "namespace dotnetapp { ... }"
}

Filenames must end with .cs.
CRITICAL: each class name appears in exactly one file — no duplicates.
"""

DOTNET_USER = """STARTER TEMPLATE FILES (follow this structure exactly — same using directives, namespace, class names):
{template_section}

PROJECT DESCRIPTION:
{description}

{ocr_section}

Generate the complete C# implementation.
Return ONLY a JSON object: {{ "filename.cs": "file content", ... }}
Include ALL classes needed to satisfy the description.
IMPORTANT: Include every `using` directive from the starter template, plus any additional ones your implementation needs.
"""


class DotNetSolutionGeneratorAgent:

    def __init__(self):
        self.rotator = KeyRotator(
            GROQ_API_KEYS_SOLUTION,
            GROQ_MODEL_SOLUTION,
            MAX_TOKENS_SOLUTION,
        )

    def generate(
        self,
        description_content: str,
        ocr_text:            str = "",
        image_urls:          List[str] = None,
        template_files:      Dict[str, str] = None,
    ) -> Dict[str, str]:
        """
        Returns a dict of {filename: content} for all .cs files to inject.
        Falls back to a stub Program.cs if generation fails.
        template_files: {filename: content} of boilerplate source files (NOT testcases).
        """
        clean_desc = strip_base64_images(description_content)

        ocr_section = f"OCR TEXT FROM IMAGES:\n{ocr_text}" if ocr_text.strip() else ""

        if template_files:
            parts = []
            for fname, content in template_files.items():
                parts.append(f"// ── {fname} ──\n{content}")
            template_section = "\n\n".join(parts)
        else:
            template_section = "(No starter template provided — infer structure from description.)"

        user_msg = DOTNET_USER.format(
            description      = clean_desc,
            ocr_section      = ocr_section,
            template_section = template_section,
        )

        for attempt in range(MAX_RETRIES):
            try:
                llm = self.rotator.get_llm()
                response = llm.invoke([
                    SystemMessage(content=DOTNET_SYSTEM),
                    HumanMessage(content=user_msg),
                ])
                files = self._parse_response(response.content)
                if files:
                    logger.info("DotNet solution generated via Groq: %s", list(files.keys()))
                    return files
            except Exception as e:
                logger.warning("Groq DotNet attempt %d failed: %s", attempt + 1, e)

        logger.error("All DotNet generation attempts failed — returning empty stub")
        return {"Program.cs": "using System;\n\npublic class Program\n{\n    public static void Main(string[] args) { }\n}\n"}

    def _parse_response(self, raw: str) -> Dict[str, str]:
        """Extract JSON object from LLM response."""
        # Strip markdown code fences
        text = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
        text = re.sub(r'\s*```$', '', text.strip(), flags=re.MULTILINE)

        # Find outermost { ... }
        start = text.find('{')
        end   = text.rfind('}')
        if start == -1 or end == -1:
            logger.warning("No JSON object found in DotNet agent response")
            return {}

        try:
            data = json.loads(text[start:end + 1])
        except json.JSONDecodeError as e:
            logger.warning("JSON parse failed: %s", e)
            return {}

        files = {k: v for k, v in data.items() if isinstance(k, str) and k.endswith(".cs")}
        if not files:
            logger.warning("No .cs files found in parsed JSON: keys=%s", list(data.keys()))
        return files
