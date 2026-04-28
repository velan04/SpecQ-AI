// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Play, RotateCcw, AlertCircle, Terminal, FileDown, BarChart2, Code2 } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ZipFileExplorer from './components/ZipFileExplorer';
import RichTextQuestionInput from './components/RichTextQuestionInput';
import ResultsDisplay from './components/ResultsDisplay';
import CodeSpace from './components/CodeSpace';
import LoaderOverlay from './components/LoaderOverlay';
import TestcaseExcelGenerator from './components/TestcaseExcelGenerator'; // adjust path if needed
import { startPipeline, getStatus, getReport, downloadExcelReport, createLogSocket, cancelPipeline, getDescription, importQuestion, getImportedZip, searchQuestionBanks, questionsInBank } from './services/api';

/* ── Design tokens ─────────────────────────────────────────────────────────── */
const T = {
  bg:           '#FAFAF8',
  surface:      '#FFFFFF',
  border:       '#EAEAEA',
  borderHover:  '#C7C3F4',
  indigo:       '#5A4FCF',
  indigoLight:  '#F0EFFF',
  indigoMid:    '#7C75E0',
  indigoDark:   '#3D34A5',
  textPrimary:  '#1A1A2E',
  textSecondary:'#6B7280',
  textMuted:    '#A3A3B3',
  success:      '#10B981',
  successLight: '#ECFDF5',
  successBorder:'#6EE7B7',
  error:        '#EF4444',
  errorLight:   '#FEF2F2',
  errorBorder:  '#FCA5A5',
  warning:      '#F59E0B',
  warningLight: '#FFFBEB',
  warningBorder:'#FCD34D',
  radius:       '12px',
  radiusSm:     '8px',
  radiusLg:     '16px',
  shadow:       '0 2px 12px rgba(90,79,207,0.07)',
  shadowMd:     '0 4px 24px rgba(90,79,207,0.10)',
};

const cardStyle = {
  background:   T.surface,
  borderRadius: T.radiusLg,
  border:       `1px solid ${T.border}`,
  padding:      '28px',
  boxShadow:    T.shadow,
};

/* ── Pipeline nodes ─────────────────────────────────────────────────────────── */
const PIPELINE_NODES = [
  { key: 'load_inputs',           label: 'Load inputs'      },
  { key: 'ocr_extract',           label: 'OCR extract'      },
  { key: 'generate_solution',     label: 'Generate solution'},
  { key: 'run_tests',             label: 'Run tests'        },
  { key: 'analyze_failures',      label: 'Analyze failures' },
  { key: 'score_description',     label: 'QC Score'         },
  { key: 'generate_excel_report', label: 'Excel report'     },
];

function detectCurrentNode(logs) {
  let current = null;
  for (const line of logs) {
    const match = line.match(/Node: (\w+)/);
    if (match) current = match[1];
  }
  return current;
}

function getNodeStatus(key, currentNode, done) {
  if (done) return 'done';
  const idx    = PIPELINE_NODES.findIndex(n => n.key === key);
  const curIdx = PIPELINE_NODES.findIndex(n => n.key === currentNode);
  if (idx < curIdx)   return 'done';
  if (idx === curIdx) return 'active';
  return 'pending';
}

/* ── StepLabel ─────────────────────────────────────────────────────────────── */
const StepLabel = ({ num, text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
    <span style={{
      width: '22px', height: '22px', borderRadius: '50%',
      background: `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
      color: '#fff', fontSize: '11px', fontWeight: '800',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxShadow: '0 2px 6px rgba(90,79,207,0.25)',
    }}>
      {num}
    </span>
    <span style={{
      fontSize: '11px', fontWeight: '700', color: T.textMuted,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      fontFamily: "'Syne', sans-serif",
    }}>
      {text}
    </span>
  </div>
);

/* ── NodeStatusIcon ────────────────────────────────────────────────────────── */
const NodeStatusIcon = ({ status }) => {
  if (status === 'done') return <span style={{ fontSize: '14px' }}>✅</span>;
  if (status === 'active') return (
    <span style={{
      display: 'inline-block', width: '14px', height: '14px', borderRadius: '50%',
      border: `2px solid ${T.indigo}`, borderTopColor: 'transparent',
      animation: 'spin 0.8s linear infinite',
    }} />
  );
  return <span style={{
    display: 'inline-block', width: '14px', height: '14px',
    borderRadius: '50%', background: T.border,
  }} />;
};

/* ── NavItem ───────────────────────────────────────────────────────────────── */
const NavItem = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '7px 16px',
      borderRadius: '8px',
      border: active ? `1px solid ${T.borderHover}` : '1px solid transparent',
      background: active ? T.indigoLight : 'transparent',
      color: active ? T.indigo : T.textSecondary,
      fontSize: '13px',
      fontWeight: active ? '700' : '500',
      fontFamily: "'DM Sans', sans-serif",
      cursor: 'pointer',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap',
    }}
    onMouseEnter={e => {
      if (!active) {
        e.currentTarget.style.background = T.indigoLight;
        e.currentTarget.style.color = T.indigo;
      }
    }}
    onMouseLeave={e => {
      if (!active) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = T.textSecondary;
      }
    }}
  >
    {label}
  </button>
);

/* ── App ────────────────────────────────────────────────────────────────────── */
function App() {
  const [activePage,    setActivePage]    = useState('qc');        // 'qc' | 'testcase'
  const [resultTab,     setResultTab]     = useState('results');   // 'results' | 'code'
  const [zipFile,       setZipFile]       = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({ testCases: [] });
  const [description,   setDescription]   = useState('');
  const [stage,         setStage]          = useState('idle');      // idle | running | done | error
  const [logs,          setLogs]           = useState([]);
  const [report,        setReport]         = useState(null);
  const [error,         setError]          = useState(null);
  const [descModal,     setDescModal]      = useState(null);  // null | string (description content)
  const [importExpanded, setImportExpanded] = useState(false);
  const [importQId,     setImportQId]      = useState('');
  const [importToken,   setImportToken]    = useState('');
  const [importing,     setImporting]      = useState(false);
  const [importResult,  setImportResult]   = useState(null); // null | {ok, msg, detail}

  // QB search states
  const [qbSearchTerm,       setQbSearchTerm]       = useState('');
  const [qbSearchResults,    setQbSearchResults]    = useState([]);
  const [qbSearching,        setQbSearching]        = useState(false);
  const [qbSelectedBank,     setQbSelectedBank]     = useState(null);
  const [qbSearchError,      setQbSearchError]      = useState('');
  // Questions within the selected bank
  const [qbQuestions,        setQbQuestions]        = useState([]);
  const [qbLoadingQuestions, setQbLoadingQuestions] = useState(false);
  const [qbQuestionsError,   setQbQuestionsError]   = useState('');
  const [qbSelectedQuestion, setQbSelectedQuestion] = useState(null);
  const [tokenDropdownOpen,  setTokenDropdownOpen]  = useState(false);

  const logsEndRef  = useRef(null);
  const wsRef       = useRef(null);
  const pollRef     = useRef(null);
  const stageRef    = useRef('idle');
  const tokenBtnRef = useRef(null);

  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => () => { wsRef.current?.close(); clearInterval(pollRef.current); }, []);

  // Load saved token from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('examly_token');
    if (saved) setImportToken(saved);
  }, []);

  // Close token dropdown when clicking outside
  useEffect(() => {
    if (!tokenDropdownOpen) return;
    const handleOutside = (e) => {
      if (tokenBtnRef.current && !tokenBtnRef.current.contains(e.target)) {
        setTokenDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [tokenDropdownOpen]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await getStatus();
        if (!status.running) {
          stopPolling();
          if (status.error) {
            setError(status.error);
            setStage('error');
          } else {
            const data = await getReport();
            setReport(data);
            setStage('done');
          }
        }
      } catch (_) {}
    }, 2000);
  };

  const handleReset = () => {
    wsRef.current?.close();
    stopPolling();
    setZipFile(null);
    setSelectedFiles({ testCases: [] });
    setDescription('');
    setStage('idle');
    setLogs([]);
    setReport(null);
    setError(null);
    setResultTab('results');
  };

  const handleCancel = async () => {
    wsRef.current?.close();
    stopPolling();
    try { await cancelPipeline(); } catch (_) {}
    setStage('idle');
    setLogs([]);
    setError('Pipeline cancelled.');
  };

  const handleSaveToken = () => {
    localStorage.setItem('examly_token', importToken.trim());
    setTokenDropdownOpen(false);
  };

  const handleQbSearch = async () => {
    if (!importToken.trim()) {
      setQbSearchError('Please set your JWT token first (click 🔑 Token).');
      setTokenDropdownOpen(true);
      return;
    }
    if (!qbSearchTerm.trim()) { setQbSearchError('Please enter a search term.'); return; }
    setQbSearching(true);
    setQbSearchResults([]);
    setQbSelectedBank(null);
    setQbQuestions([]);
    setQbSelectedQuestion(null);
    setQbQuestionsError('');
    setQbSearchError('');
    setImportQId('');
    try {
      const res = await searchQuestionBanks(qbSearchTerm.trim(), importToken.trim());
      if (res.error) { setQbSearchError(res.error); }
      else {
        setQbSearchResults(res.questionbanks || []);
        setImportExpanded(true); // auto-expand results area
      }
    } catch (err) {
      setQbSearchError(`Search failed: ${err.message}`);
    }
    setQbSearching(false);
  };

  const handleSelectBank = async (bank) => {
    setQbSelectedBank(bank);
    setQbQuestions([]);
    setQbSelectedQuestion(null);
    setQbQuestionsError('');
    setImportQId('');
    setQbLoadingQuestions(true);
    try {
      const res = await questionsInBank(bank.qb_id, importToken.trim());
      if (res.error) { setQbQuestionsError(res.error); }
      else { setQbQuestions(res.questions || []); }
    } catch (err) {
      setQbQuestionsError(`Failed to load questions: ${err.message}`);
    }
    setQbLoadingQuestions(false);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);

    try {
      const raw = importQId.trim();
      const uuidMatch = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      const qId = uuidMatch ? uuidMatch[1] : raw;
      if (!qId) { setImportResult({ ok: false, msg: 'Please enter a question ID.' }); setImporting(false); return; }
      if (!importToken.trim()) { setImportResult({ ok: false, msg: 'Please enter your JWT token.' }); setImporting(false); return; }

      // Browser fetches from examly → server embeds images + downloads ZIP
      const result = await importQuestion(qId, importToken.trim(), qbSelectedQuestion?.question_data || '');

      if (result.error) {
        setImportResult({ ok: false, msg: result.error });
        setImporting(false);
        return;
      }

      // Server returned description with images embedded as base64
      setDescription(result.description || '');

      // Auto-load ZIP from server if it was downloaded successfully
      if (result.zip_saved) {
        try {
          const blob = await getImportedZip();
          const file = new File([blob], result.zip_filename || 'boilerplate.zip', { type: 'application/zip' });
          setZipFile(file);
        } catch (_) {}
      }

      setImportResult({
        ok: true,
        msg: `✅ Imported successfully!`,
        detail: [
          `📝 Description: ${(result.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 60)}…`,
          `🖼 Images embedded: ${result.images_embedded ?? 0}/${result.images_total ?? 0}`,
          `📦 ZIP: ${result.zip_saved ? `✅ auto-loaded (${result.zip_filename})` : '⚠ private S3 URL — download manually (see below)'}`,
          `🧪 Testcases: ${result.testcases?.length ?? 0} found`,
        ].join('\n'),
        zipSaved:    result.zip_saved    || false,
        zipUrl:      result.zip_url      || '',
        zipFilename: result.zip_filename || 'boilerplate.zip',
      });

    } catch (err) {
      setImportResult({ ok: false, msg: `Import failed: ${err.message}` });
    }
    setImporting(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!zipFile)
      return setError('Please upload a ZIP file');
    if (selectedFiles.testCases.length === 0)
      return setError('Please select at least one Puppeteer test file from the ZIP');
    const plainText = description?.replace(/<[^>]+>/g, '').trim();
    if (!plainText)
      return setError('Please enter the project description');

    setStage('running');
    setError(null);
    setLogs([]);
    setReport(null);

    try {
      const testcaseContent = selectedFiles.testCases
        .map(f => f.content)
        .join('\n\n');

      const res = await startPipeline(testcaseContent, description, zipFile);

      if (res.status === 'already_running') {
        setError('Pipeline is already running. Please wait.');
        setStage('idle');
        return;
      }

      const ws = createLogSocket();
      wsRef.current = ws;

      ws.onopen = () => {
        setLogs(prev => [...prev, '🔗 Connected to pipeline — waiting for logs…']);
      };

      ws.onmessage = (e) => {
        if (e.data === '__DONE__') {
          stopPolling();
          ws.close();
          getReport()
            .then(data => { setReport(data); setStage('done'); })
            .catch(err  => { setError('Failed to fetch report: ' + err.message); setStage('error'); });
          return;
        }
        if (e.data === '__PING__') return;
        setLogs(prev => [...prev, e.data]);
      };

      ws.onerror = () => {
        setLogs(prev => [...prev, '⚠ WebSocket error — switching to polling fallback…']);
      };

      ws.onclose = () => {
        if (stageRef.current === 'running') {
          setLogs(prev => [
            ...prev,
            '🔄 WebSocket closed — polling /api/status every 2s until done…',
          ]);
          startPolling();
        }
      };

    } catch (err) {
      setError(err.message || 'Failed to start pipeline');
      setStage('idle');
    }
  };

  const canSubmit =
    !!zipFile &&
    selectedFiles.testCases.length > 0 &&
    description?.replace(/<[^>]+>/g, '').trim().length > 0 &&
    stage !== 'running';

  const currentNode = detectCurrentNode(logs);
  const isDone      = stage === 'done';

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: ${T.bg}; }

        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse  { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .log-line { animation: fadeIn 0.15s ease-out; }

        .submit-btn { transition: background 0.2s, box-shadow 0.2s, transform 0.1s; }
        .submit-btn:hover:not(:disabled) {
          background: ${T.indigoDark} !important;
          box-shadow: 0 6px 20px rgba(90,79,207,0.28) !important;
          transform: translateY(-1px);
        }
        .submit-btn:active:not(:disabled) { transform: translateY(0px); }

        .reset-btn { transition: background 0.2s, border-color 0.2s; }
        .reset-btn:hover:not(:disabled) {
          background: ${T.indigoLight} !important;
          border-color: ${T.borderHover} !important;
          color: ${T.indigo} !important;
        }

        .new-analysis-btn { transition: background 0.2s, border-color 0.2s, color 0.2s; }
        .new-analysis-btn:hover {
          background: ${T.indigoLight} !important;
          border-color: ${T.borderHover} !important;
          color: ${T.indigo} !important;
        }

        .step-card { transition: border-color 0.2s, box-shadow 0.2s; }
        .step-card:focus-within {
          border-color: ${T.borderHover} !important;
          box-shadow: 0 0 0 3px rgba(90,79,207,0.08) !important;
        }

        .logs-scroll::-webkit-scrollbar { width: 5px; }
        .logs-scroll::-webkit-scrollbar-track { background: transparent; }
        .logs-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      `}</style>

      <LoaderOverlay visible={stage === 'running' && logs.length === 0} onCancel={handleCancel} />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        boxShadow: '0 1px 4px rgba(90,79,207,0.06)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: '100%', margin: '0 10px', padding: '0 28px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '15px 0', flexWrap: 'wrap', gap: '12px',
          }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="28" height="28" viewBox="0 0 18 18" fill="none">
                <path d="M9 1.5L10.4 7.6L16.5 9L10.4 10.4L9 16.5L7.6 10.4L1.5 9L7.6 7.6L9 1.5Z" fill={T.indigo} />
                <circle cx="3.5" cy="3.5" r="1.2" fill={T.indigoMid} />
                <circle cx="14.5" cy="14.5" r="0.9" fill={T.indigoMid} />
              </svg>
              <span style={{
                fontFamily: "'Syne', sans-serif", fontSize: '20px',
                fontWeight: '800', color: T.textPrimary, letterSpacing: '-0.04em',
              }}>
                SpecQ<span style={{ color: T.indigo }}>AI</span>
              </span>
            </div>

            {/* Right side: nav + badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {/* Nav menu */}
              <nav style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: '10px', padding: '4px',
              }}>
                <NavItem
                  label="QC Analyse"
                  active={activePage === 'qc'}
                  onClick={() => setActivePage('qc')}
                />
                <NavItem
                  label="Testcase Report"
                  active={activePage === 'testcase'}
                  onClick={() => setActivePage('testcase')}
                />
              </nav>

              {/* Tech badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '7px 14px',
                background: T.warningLight, border: `1px solid ${T.warningBorder}`,
                borderRadius: '999px',
              }}>
                <span style={{ fontSize: '15px' }}>🌐</span>
                <span style={{
                  fontSize: '12px', fontWeight: '700', color: '#92400E',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>
                  HTML / CSS / JS
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Description.txt Modal ───────────────────────────────────────────── */}
      {descModal !== null && (
        <div
          onClick={() => setDescModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(10,9,32,0.72)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#12112A', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px', boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
              width: '100%', maxWidth: '860px', height: '82vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px' }}>📄</span>
                <span style={{
                  fontFamily: "'Syne', sans-serif", fontSize: '15px',
                  fontWeight: '700', color: '#E5E3FF',
                }}>
                  Project Description
                </span>
                <span style={{
                  fontSize: '11px', color: 'rgba(229,227,255,0.4)',
                  fontFamily: "'DM Mono', monospace",
                }}>
                  rendered HTML · images visible
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {/* Download button */}
                <button
                  onClick={() => {
                    const blob = new Blob([descModal], { type: 'text/html' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'description.html';
                    a.click();
                  }}
                  style={{
                    padding: '6px 14px', borderRadius: '8px', border: 'none',
                    background: `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
                    color: '#fff', cursor: 'pointer', fontSize: '12px',
                    fontWeight: '600', fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  ⬇ Download
                </button>
                <button
                  onClick={() => setDescModal(null)}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: 'rgba(229,227,255,0.5)',
                    cursor: 'pointer', fontSize: '18px', lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal body — rendered HTML so images display properly */}
            <div style={{ flex: 1, overflow: 'hidden', background: '#fff', borderRadius: '0 0 16px 16px' }}>
              <iframe
                srcDoc={descModal}
                title="Project Description"
                sandbox="allow-scripts allow-same-origin"
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Testcase Report Page ─────────────────────────────────────────────── */}
      {activePage === 'testcase' && (
        <TestcaseExcelGenerator />
      )}

      {/* ── QC Analyse Page ─────────────────────────────────────────────────── */}
      {activePage === 'qc' && (
        <main style={{ maxWidth: '100%', margin: '0 10px', padding: '36px 28px 60px' }}>

          {error && (
            <div style={{
              marginBottom: '24px', padding: '14px 16px',
              background: T.errorLight, border: `1px solid ${T.errorBorder}`,
              borderRadius: T.radius,
              display: 'flex', alignItems: 'flex-start', gap: '10px',
            }}>
              <AlertCircle size={17} color={T.error} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: '700', color: '#991B1B', margin: '0 0 2px', fontSize: '13px' }}>Error</p>
                <p style={{ color: '#B91C1C', margin: 0, fontSize: '13px' }}>{error}</p>
              </div>
              <button onClick={() => setError(null)} style={{
                color: '#F87171', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0,
              }}>×</button>
            </div>
          )}

          {report ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* ── Top action bar ───────────────────────────────────────────── */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: T.success, boxShadow: `0 0 0 3px ${T.successLight}`,
                  }} />
                  <h2 style={{
                    fontFamily: "'Syne', sans-serif", fontSize: '22px',
                    fontWeight: '800', color: T.textPrimary, margin: 0, letterSpacing: '-0.03em',
                  }}>
                    QC Analysis Complete
                  </h2>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {/* View description.txt */}
                  <button
                    onClick={() => {
                      getDescription()
                        .then(d => setDescModal(
                          d.content
                            ?? d.error
                            ?? d.detail
                            ?? '(description.txt is empty or not found — run the pipeline first)'
                        ))
                        .catch(() => setDescModal('Could not reach server — make sure the backend is running.'));
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px',
                      padding: '10px 18px', border: `1px solid ${T.border}`,
                      borderRadius: T.radiusSm, background: T.surface,
                      color: T.textSecondary, cursor: 'pointer',
                      fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    📄 description.txt
                  </button>

                  <button
                    onClick={() => {
                      downloadExcelReport().then(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `qc_report_${Date.now()}.xlsx`;
                        a.click();
                      }).catch(() => alert('Excel report not ready yet.'));
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px',
                      padding: '10px 18px', border: 'none',
                      borderRadius: T.radiusSm,
                      background: `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
                      color: '#fff', cursor: 'pointer',
                      fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif",
                      boxShadow: '0 2px 8px rgba(90,79,207,0.22)',
                    }}
                  >
                    <FileDown size={13} /> Download Excel
                  </button>
                  <button onClick={handleReset} className="new-analysis-btn" style={{
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '10px 18px', border: `1px solid ${T.border}`,
                    borderRadius: T.radiusSm, background: T.surface,
                    color: T.textSecondary, cursor: 'pointer',
                    fontSize: '13px', fontWeight: '600', fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <RotateCcw size={13} /> New Analysis
                  </button>
                </div>
              </div>

              {/* ── Result / Code tabs ───────────────────────────────────────── */}
              <div style={{
                display: 'flex', gap: '4px',
                background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: '10px', padding: '4px', alignSelf: 'flex-start',
              }}>
                {[
                  { key: 'results', label: 'Test Results', icon: <BarChart2 size={13} /> },
                  { key: 'code',    label: 'Code Space',   icon: <Code2 size={13} /> },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setResultTab(tab.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '8px 18px', borderRadius: '7px', border: 'none',
                      background: resultTab === tab.key
                        ? `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`
                        : 'transparent',
                      color: resultTab === tab.key ? '#fff' : T.textSecondary,
                      fontSize: '13px', fontWeight: '700', cursor: 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                      boxShadow: resultTab === tab.key ? '0 2px 8px rgba(90,79,207,0.25)' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.icon}
                    {tab.label}
                    {/* Badge */}
                    {tab.key === 'results' && report?.summary && (
                      <span style={{
                        padding: '1px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: '700',
                        background: resultTab === 'results' ? 'rgba(255,255,255,0.2)' : T.indigoLight,
                        color: resultTab === 'results' ? '#fff' : T.indigo,
                      }}>
                        {report.summary.passed}/{report.summary.total}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Tab content ──────────────────────────────────────────────── */}
              {resultTab === 'results' && <ResultsDisplay report={report} />}
              {resultTab === 'code' && (
                <CodeSpace
                  onReportUpdate={setReport}
                  initialReport={report}
                />
              )}
            </div>

          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

              <div style={cardStyle}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  marginBottom: '28px', paddingBottom: '20px',
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: T.indigoLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: '18px' }}>📂</span>
                  </div>
                  <div>
                    <h2 style={{
                      fontFamily: "'Syne', sans-serif", fontSize: '17px',
                      fontWeight: '700', color: T.textPrimary, margin: 0,
                    }}>
                      Upload Project Files
                    </h2>
                    <p style={{ fontSize: '12px', color: T.textMuted, margin: '2px 0 0' }}>
                      ZIP · Test files · Description
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                  {/* ── Platform Import — search row + inline results ── */}
                  <div style={{
                    borderRadius: T.radius,
                    border: `1px solid ${importExpanded ? T.borderHover : T.border}`,
                    background: importExpanded
                      ? 'linear-gradient(135deg, rgba(90,79,207,0.04), rgba(124,117,224,0.02))'
                      : T.surface,
                    overflow: 'visible',
                    position: 'relative',
                    transition: 'border-color 0.2s',
                  }}>

                    {/* ── Search row (replaces old banner) ── */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 12px',
                    }}>
                      {/* Search icon */}
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.indigo} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>

                      {/* Search input */}
                      <input
                        type="text"
                        placeholder="Search question bank…"
                        value={qbSearchTerm}
                        onChange={e => setQbSearchTerm(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleQbSearch()}
                        style={{
                          flex: 1, padding: '7px 11px', borderRadius: T.radiusSm,
                          border: `1px solid ${T.border}`, background: T.bg,
                          color: T.textPrimary, fontSize: '13px',
                          fontFamily: "'DM Sans', sans-serif", outline: 'none',
                          minWidth: 0,
                        }}
                      />

                      {/* Search button */}
                      <button
                        type="button"
                        onClick={handleQbSearch}
                        disabled={qbSearching}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '7px 14px', borderRadius: T.radiusSm, border: 'none',
                          background: qbSearching ? '#D1D5DB' : `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
                          color: '#fff', cursor: qbSearching ? 'not-allowed' : 'pointer',
                          fontSize: '12px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif",
                          whiteSpace: 'nowrap', flexShrink: 0,
                        }}
                      >
                        {qbSearching
                          ? <><span style={{ display:'inline-block', width:'10px', height:'10px', border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /> Searching…</>
                          : <>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                              Search
                            </>
                        }
                      </button>

                      {/* 🔑 Token button + dropdown */}
                      <div ref={tokenBtnRef} style={{ position: 'relative', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setTokenDropdownOpen(v => !v)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '5px',
                            padding: '7px 13px', borderRadius: T.radiusSm,
                            border: `1px solid ${tokenDropdownOpen ? T.borderHover : T.border}`,
                            background: tokenDropdownOpen ? T.indigoLight : T.surface,
                            color: tokenDropdownOpen ? T.indigo : T.textSecondary,
                            cursor: 'pointer', fontSize: '12px', fontWeight: '700',
                            fontFamily: "'DM Sans', sans-serif",
                            transition: 'all 0.15s',
                          }}
                        >
                          🔑 Token
                          <span style={{ fontSize: '10px' }}>{tokenDropdownOpen ? '▲' : '▼'}</span>
                        </button>

                        {/* Token dropdown popover */}
                        {tokenDropdownOpen && (
                          <div style={{
                            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                            zIndex: 200, width: '320px',
                            background: T.surface,
                            border: `1px solid ${T.borderHover}`,
                            borderRadius: T.radiusSm,
                            boxShadow: T.shadowMd,
                            padding: '14px 16px',
                            display: 'flex', flexDirection: 'column', gap: '10px',
                          }}>
                            <label style={{
                              fontSize: '11px', fontWeight: '700', color: T.textMuted,
                              textTransform: 'uppercase', letterSpacing: '0.07em',
                              fontFamily: "'DM Sans', sans-serif",
                            }}>
                              JWT Token
                            </label>
                            <textarea
                              rows={3}
                              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                              value={importToken}
                              onChange={e => setImportToken(e.target.value)}
                              style={{
                                width: '100%', boxSizing: 'border-box',
                                padding: '8px 10px', borderRadius: T.radiusSm,
                                border: `1px solid ${T.border}`, background: T.bg,
                                color: T.textPrimary, fontSize: '11px',
                                fontFamily: "'DM Mono', monospace", outline: 'none',
                                resize: 'vertical',
                              }}
                            />
                            <button
                              type="button"
                              onClick={handleSaveToken}
                              style={{
                                alignSelf: 'flex-end',
                                padding: '7px 18px', borderRadius: T.radiusSm, border: 'none',
                                background: `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
                                color: '#fff', cursor: 'pointer',
                                fontSize: '12px', fontWeight: '700',
                                fontFamily: "'DM Sans', sans-serif",
                                boxShadow: '0 2px 8px rgba(90,79,207,0.22)',
                              }}
                            >
                              💾 Save Token
                            </button>
                            {importToken && localStorage.getItem('examly_token') === importToken.trim() && (
                              <p style={{ margin: 0, fontSize: '11px', color: T.success, fontFamily: "'DM Sans', sans-serif" }}>
                                ✓ Token saved
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Search error */}
                    {qbSearchError && (
                      <div style={{ padding: '0 12px 10px' }}>
                        <p style={{ margin: 0, fontSize: '12px', color: T.error, fontFamily: "'DM Sans', sans-serif" }}>
                          ⚠ {qbSearchError}
                        </p>
                      </div>
                    )}

                    {/* ── Inline results area ── */}
                    {importExpanded && (
                      <div style={{
                        borderTop: `1px solid ${T.border}`,
                        padding: '14px 14px',
                        display: 'flex', flexDirection: 'column', gap: '12px',
                        background: 'rgba(90,79,207,0.015)',
                        borderRadius: `0 0 ${T.radius} ${T.radius}`,
                      }}>

                        {/* ── Bank results list ── */}
                        {qbSearchResults.length > 0 && (
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: '600', color: T.textMuted, marginBottom: '6px', fontFamily: "'DM Sans', sans-serif" }}>
                              {qbSearchResults.length} bank{qbSearchResults.length !== 1 ? 's' : ''} found — click to load questions
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                              {qbSearchResults.map(bank => {
                                const sel = qbSelectedBank?.qb_id === bank.qb_id;
                                return (
                                  <div
                                    key={bank.qb_id}
                                    onClick={() => handleSelectBank(bank)}
                                    style={{
                                      padding: '9px 12px', borderRadius: T.radiusSm, cursor: 'pointer',
                                      background: sel ? T.indigoLight : T.bg,
                                      border: `1px solid ${sel ? T.borderHover : T.border}`,
                                      transition: 'all 0.12s',
                                    }}
                                  >
                                    <div style={{ fontSize: '13px', fontWeight: '600', color: sel ? T.indigo : T.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>
                                      {bank.qb_name}
                                    </div>
                                    <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '2px', fontFamily: "'DM Mono', monospace" }}>
                                      {bank.questionCount ?? '?'} questions · {bank.qb_id}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── Questions inside selected bank ── */}
                        {qbSelectedBank && (
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: '700', color: T.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'DM Sans', sans-serif" }}>
                              Questions in <span style={{ color: T.indigo, textTransform: 'none' }}>{qbSelectedBank.qb_name}</span>
                            </div>

                            {qbLoadingQuestions && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', color: T.textMuted, fontSize: '12px', fontFamily: "'DM Sans', sans-serif" }}>
                                <span style={{ display: 'inline-block', width: '13px', height: '13px', border: `2px solid ${T.border}`, borderTopColor: T.indigo, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                Loading questions…
                              </div>
                            )}

                            {qbQuestionsError && (
                              <p style={{ margin: '4px 0', fontSize: '12px', color: T.error, fontFamily: "'DM Sans', sans-serif" }}>⚠ {qbQuestionsError}</p>
                            )}

                            {!qbLoadingQuestions && qbQuestions.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                                {qbQuestions.map((q, i) => {
                                  const qId   = q.question_id || q.id || q._id || '';
                                  const qName = q.question_name || q.name || q.title || q.question_title || `Question ${i + 1}`;
                                  const selQ  = qbSelectedQuestion?.question_id === qId || qbSelectedQuestion?.id === qId;
                                  return (
                                    <div
                                      key={qId || i}
                                      onClick={() => { setQbSelectedQuestion(q); setImportQId(qId); }}
                                      style={{
                                        padding: '9px 12px', borderRadius: T.radiusSm, cursor: 'pointer',
                                        background: selQ ? T.indigoLight : T.bg,
                                        border: `1px solid ${selQ ? T.borderHover : T.border}`,
                                        transition: 'all 0.12s',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                                      }}
                                    >
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: '13px', fontWeight: '600', color: selQ ? T.indigo : T.textPrimary, fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {qName}
                                        </div>
                                        {qId && (
                                          <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '2px', fontFamily: "'DM Mono', monospace" }}>
                                            {qId}
                                          </div>
                                        )}
                                      </div>
                                      {selQ && <span style={{ fontSize: '11px', fontWeight: '700', color: T.indigo, flexShrink: 0 }}>✓ selected</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {!qbLoadingQuestions && !qbQuestionsError && qbQuestions.length === 0 && (
                              <p style={{ margin: '4px 0', fontSize: '12px', color: T.textMuted, fontFamily: "'DM Sans', sans-serif" }}>
                                No questions found in this bank.
                              </p>
                            )}
                          </div>
                        )}

                        {/* ── Import button ── */}
                        {qbSelectedQuestion && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: T.radiusSm, background: T.indigoLight, border: `1px solid ${T.borderHover}` }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: T.indigo, fontFamily: "'DM Sans', sans-serif" }}>Ready to import</div>
                              <div style={{ fontSize: '11px', color: T.textSecondary, fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {importQId}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleImport}
                              disabled={importing}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '5px',
                                padding: '9px 20px', borderRadius: T.radiusSm, border: 'none',
                                background: importing ? '#D1D5DB' : `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
                                color: '#fff', cursor: importing ? 'not-allowed' : 'pointer',
                                fontSize: '13px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif",
                                whiteSpace: 'nowrap', flexShrink: 0,
                                boxShadow: importing ? 'none' : '0 2px 8px rgba(90,79,207,0.25)',
                              }}
                            >
                              {importing
                                ? <><span style={{ display:'inline-block', width:'11px', height:'11px', border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} /> Importing…</>
                                : '⚡ Import'
                              }
                            </button>
                          </div>
                        )}

                        {/* Result feedback */}
                        {importResult && (
                          <div style={{
                            borderRadius: T.radiusSm,
                            background: importResult.ok ? T.successLight : T.errorLight,
                            border: `1px solid ${importResult.ok ? T.successBorder : T.errorBorder}`,
                            padding: '12px 14px',
                            display: 'flex', flexDirection: 'column', gap: '6px',
                          }}>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: importResult.ok ? '#065F46' : '#991B1B', fontFamily: "'DM Sans', sans-serif" }}>
                              {importResult.msg}
                            </div>
                            {importResult.detail && (
                              <pre style={{ fontSize: '11px', color: importResult.ok ? '#047857' : '#B91C1C', fontFamily: "'DM Mono', monospace", margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.7' }}>
                                {importResult.detail}
                              </pre>
                            )}
                            {importResult.ok && !importResult.zipSaved && importResult.zipUrl && (() => {
                              const consoleScript = `(async () => {
  const url = ${JSON.stringify(importResult.zipUrl)};
  const filename = ${JSON.stringify(importResult.zipFilename)};
  const res = await fetch(url, { credentials: "include" });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  console.log("✅", filename, "downloaded");
})();`;
                              return (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(consoleScript).catch(() => {});
                                      const btn = document.activeElement;
                                      if (btn) { const o = btn.textContent; btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = o; }, 2000); }
                                    }}
                                    style={{ padding: '5px 12px', borderRadius: '7px', border: `1px solid ${T.warningBorder}`, background: T.warningLight, color: '#92400E', cursor: 'pointer', fontSize: '11px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif" }}
                                  >
                                    📋 Copy console script (ZIP)
                                  </button>
                                </div>
                              );
                            })()}
                            {importResult.ok && (
                              <button
                                type="button"
                                onClick={() => { setImportExpanded(false); setImportResult(null); setQbSearchResults([]); setQbSelectedBank(null); setQbSearchError(''); setQbQuestions([]); setQbSelectedQuestion(null); setQbQuestionsError(''); setImportQId(''); }}
                                style={{ alignSelf: 'flex-start', padding: '5px 14px', borderRadius: '7px', border: 'none', background: 'rgba(16,185,129,0.15)', color: '#065F46', cursor: 'pointer', fontSize: '12px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif", marginTop: '2px' }}
                              >
                                {importResult.zipSaved ? 'Done ▲' : 'Close ▲'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="step-card" style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '20px' }}>
                    <StepLabel num="1" text="Upload ZIP Archive" />
                    <FileUpload
                      onFileSelect={setZipFile}
                      selectedFile={zipFile}
                      accept=".zip"
                      label="Upload ZIP File"
                      hint=".zip only · max 50 MB"
                    />
                  </div>

                  {zipFile && (
                    <div className="step-card" style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '20px' }}>
                      <StepLabel num="2" text="Select Test File" />
                      <ZipFileExplorer
                        zipFile={zipFile}
                        onFilesSelect={(files) => setSelectedFiles({ testCases: files.testCases })}
                        projectType="html"
                        showSolutionFiles={false}
                      />
                    </div>
                  )}

                  <div className="step-card" style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '20px' }}>
                    <StepLabel num={zipFile ? '3' : '2'} text="Project Description" />
                    <RichTextQuestionInput value={description} onChange={setDescription} />
                  </div>

                  {selectedFiles.testCases.length > 0 && (
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        fontSize: '12px', fontWeight: '600', padding: '5px 14px',
                        background: T.successLight, border: `1px solid ${T.successBorder}`,
                        borderRadius: '999px', color: '#065F46',
                      }}>
                        ✅ {selectedFiles.testCases.length} test file{selectedFiles.testCases.length !== 1 ? 's' : ''} selected
                      </span>
                    </div>
                  )}

                  <div style={{ borderTop: `1px solid ${T.border}` }} />

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="submit-btn"
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', gap: '8px',
                        padding: '13px 24px', borderRadius: T.radius, border: 'none',
                        cursor: canSubmit ? 'pointer' : 'not-allowed',
                        background: canSubmit
                          ? `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`
                          : '#D1D5DB',
                        color: '#fff', fontSize: '14px', fontWeight: '700',
                        letterSpacing: '0.01em',
                        boxShadow: canSubmit ? '0 4px 14px rgba(90,79,207,0.22)' : 'none',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {stage === 'running' ? (
                        <>
                          <span style={{
                            display: 'inline-block', width: '14px', height: '14px',
                            border: '2px solid rgba(255,255,255,0.4)',
                            borderTopColor: '#fff', borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                          }} />
                          Running Pipeline…
                        </>
                      ) : (
                        <><Play size={15} strokeWidth={2.5} /> Start QC Analysis</>
                      )}

                    </button>

                    {stage === 'running' ? (
                      <button
                        type="button"
                        onClick={handleCancel}
                        title="Cancel pipeline"
                        style={{
                          padding: '13px 18px', borderRadius: T.radius,
                          border: `1px solid ${T.errorBorder}`,
                          background: T.errorLight,
                          color: T.error, cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '13px', fontWeight: '600',
                          display: 'flex', alignItems: 'center', gap: '6px',
                        }}
                      >
                        <RotateCcw size={14} /> Cancel
                      </button>
                    ) : (zipFile || description) ? (
                      <button
                        type="button"
                        onClick={handleReset}
                        className="reset-btn"
                        title="Reset all"
                        style={{
                          padding: '13px 16px', borderRadius: T.radius,
                          border: `1px solid ${T.border}`, background: T.surface,
                          color: T.textSecondary, cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        <RotateCcw size={15} />
                      </button>
                    ) : null}
                  </div>
                </form>
              </div>

              {stage === 'running' && logs.length > 0 && (
                <div style={{
                  borderRadius: T.radiusLg, border: `1px solid ${T.border}`,
                  overflow: 'hidden', boxShadow: T.shadowMd,
                }}>
                  <div style={{
                    background: '#12112A', padding: '16px 20px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}>
                    <Terminal size={16} color={T.indigoMid} />
                    <span style={{
                      fontFamily: "'Syne', sans-serif", fontSize: '13px',
                      fontWeight: '700', color: '#E5E3FF', letterSpacing: '0.03em',
                    }}>
                      Live Pipeline Logs
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '2px 10px', background: 'rgba(90,79,207,0.25)',
                      borderRadius: '999px', fontSize: '11px', fontWeight: '600', color: T.indigoMid,
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: T.success, animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                      Running
                    </span>
                  </div>

                  <div style={{
                    background: '#0F0E26', padding: '14px 20px',
                    display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    {PIPELINE_NODES.map((node, i) => {
                      const status = getNodeStatus(node.key, currentNode, isDone);
                      return (
                        <React.Fragment key={node.key}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '4px 10px', borderRadius: '999px',
                            background: status === 'active' ? 'rgba(90,79,207,0.25)' :
                                        status === 'done'   ? 'rgba(16,185,129,0.15)' :
                                                              'rgba(255,255,255,0.05)',
                            border: `1px solid ${
                              status === 'active' ? 'rgba(90,79,207,0.5)' :
                              status === 'done'   ? 'rgba(16,185,129,0.3)' :
                                                   'rgba(255,255,255,0.08)'
                            }`,
                            transition: 'all 0.3s',
                          }}>
                            <NodeStatusIcon status={status} />
                            <span style={{
                              fontSize: '11px', fontWeight: '600',
                              color: status === 'active' ? '#C8C3FF' :
                                     status === 'done'   ? '#6EE7B7' :
                                                          'rgba(255,255,255,0.35)',
                              fontFamily: "'DM Sans', sans-serif",
                              whiteSpace: 'nowrap',
                            }}>
                              {node.label}
                            </span>
                          </div>
                          {i < PIPELINE_NODES.length - 1 && (
                            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>›</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <div
                    className="logs-scroll"
                    style={{
                      background: '#0A0920', padding: '16px 20px',
                      maxHeight: '320px', overflowY: 'auto',
                      fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace",
                    }}
                  >
                    {logs.map((line, i) => {
                      const isError   = line.includes('[ERROR]');
                      const isWarning = line.includes('[WARNING]');
                      const isNode    = line.includes('═══ Node:');
                      const isInfo    = line.includes('[INFO]');
                      const isSystem  = line.startsWith('🔗') || line.startsWith('🔄') || line.startsWith('⚠');
                      return (
                        <div key={i} className="log-line" style={{
                          fontSize: '11.5px', lineHeight: '1.75',
                          color: isError   ? '#F87171' :
                                 isWarning ? '#FCD34D' :
                                 isNode    ? '#A5B4FC' :
                                 isSystem  ? '#67E8F9' :
                                 isInfo    ? '#D1D5DB' :
                                             '#9CA3AF',
                          fontWeight: isNode ? '600' : '400',
                          borderBottom: isNode ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          padding: isNode ? '4px 0 6px' : '0',
                          marginBottom: isNode ? '4px' : '0',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        }}>
                          {line}
                        </div>
                      );
                    })}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}

            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;