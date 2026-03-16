# QC Automation — Multi-Agent Pipeline

LangGraph + LangChain + Groq powered QC coverage analyzer for HTML/CSS/JS Puppeteer test projects.

## Pipeline

```
testcase.js + description.txt + ocr_images/
        │
        ▼
1. load_inputs       — reads files from disk
        │
        ▼
2. ocr_extract       — extracts text from screenshots (optional)
        │
        ▼
3. extract_testcases — Agent: Groq llama3-8b extracts structured testcase requirements
        │
        ▼
4. extract_description — Agent: Groq llama3-8b extracts testable description requirements
        │
        ▼
5. compare           — Agent: Groq llama3-70b semantic comparator (matches, gaps, extras)
        │
        ▼
6. analyze_coverage  — Coverage Analyzer builds final QC report with scores
        │
        ▼
7. save_report       — writes reports/qc_report.json
```

## Setup

```bash
cd qc-automation
pip install -r requirements.txt

# Add your Groq API key
cp .env.example .env
# Edit .env → GROQ_API_KEY=your_key_here
```

## Run

```bash
# Default (uses data/testcase.js and data/description.txt)
python main.py

# Custom paths
python main.py \
  --testcase  path/to/testcase.js \
  --description path/to/description.txt \
  --report    reports/qc_report.json \
  --ocr-dir   data/ocr_images
```

## Output

`reports/qc_report.json` contains:

```json
{
  "meta":     { "generated_at": "...", "project": "..." },
  "summary":  {
    "total_testcases": 13,
    "total_desc_requirements": 28,
    "fully_covered": 9,
    "partially_covered": 2,
    "gaps": 5,
    "extras": 2,
    "coverage_percent": 75.0,
    "quality_score": 82.0,
    "verdict": "PASS WITH WARNINGS"
  },
  "per_testcase": [ ... ],
  "gaps":         [ ... ],
  "category_summary": { ... }
}
```

## Folder Structure

```
qc-automation/
├── agents/
│   ├── testcase_extractor_agent.py    # Agent 2: extracts testcase requirements
│   ├── description_extractor_agent.py # Agent 3: extracts description requirements
│   └── comparator_agent.py            # Agent 4: semantic comparison
├── tools/
│   ├── ocr_tool.py                    # OCR image text extraction
│   ├── parser_tool.py                 # File reader
│   └── embedding_tool.py             # Optional semantic pre-scoring
├── pipeline/
│   ├── coverage_analyzer.py           # Agent 5: builds final report
│   └── normalizer.py                  # Cleans + standardises LLM output
├── prompts/
│   ├── testcase_prompt.py
│   ├── description_prompt.py
│   └── comparator_prompt.py
├── data/
│   ├── testcase.js
│   ├── description.txt
│   └── ocr_images/                    # Put screenshots here (optional)
├── reports/
│   └── qc_report.json                 # Generated output
├── config/
│   └── settings.py
├── main.py                            # LangGraph pipeline entry point
├── requirements.txt
└── .env                               # GROQ_API_KEY=...
```

## Models Used

| Agent | Model | Reason |
|-------|-------|--------|
| Testcase Extractor | llama3-8b-8192 | Fast extraction, structured JSON |
| Description Extractor | llama3-8b-8192 | Fast extraction, structured JSON |
| Semantic Comparator | llama3-70b-8192 | High-quality semantic reasoning |
