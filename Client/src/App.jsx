// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Play, RotateCcw, AlertCircle, Terminal } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ZipFileExplorer from './components/ZipFileExplorer';
import RichTextQuestionInput from './components/RichTextQuestionInput';
import ResultsDisplay from './components/ResultsDisplay';
import LoaderOverlay from './components/LoaderOverlay';
import { startPipeline, getStatus, getReport, createLogSocket } from './services/api';

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
  { key: 'load_inputs',         label: 'Load inputs' },
  { key: 'ocr_extract',         label: 'OCR extract' },
  { key: 'extract_testcases',   label: 'Extract testcases' },
  { key: 'extract_description', label: 'Extract description' },
  { key: 'compare',             label: 'Semantic compare' },
  { key: 'analyze_coverage',    label: 'Analyze coverage' },
  { key: 'save_report',         label: 'Save report' },
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

/* ── App ────────────────────────────────────────────────────────────────────── */
function App() {
  const [zipFile,       setZipFile]       = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({ testCases: [] });
  const [description,   setDescription]   = useState('');
  const [stage,         setStage]          = useState('idle'); // idle | running | done | error
  const [logs,          setLogs]           = useState([]);
  const [report,        setReport]         = useState(null);
  const [error,         setError]          = useState(null);

  const logsEndRef  = useRef(null);
  const wsRef       = useRef(null);
  const pollRef     = useRef(null);
  const stageRef    = useRef('idle'); // always mirrors `stage` — safe inside closures

  /* Keep stageRef in sync with stage */
  useEffect(() => { stageRef.current = stage; }, [stage]);

  /* Auto-scroll logs */
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  /* Cleanup on unmount */
  useEffect(() => () => {
    wsRef.current?.close();
    clearInterval(pollRef.current);
  }, []);

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

      const res = await startPipeline(testcaseContent, description);

      if (res.status === 'already_running') {
        setError('Pipeline is already running. Please wait.');
        setStage('idle');
        return;
      }

      /* ── WebSocket: primary log stream ─────────────────────────────────── */
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
        if (e.data === '__PING__') return; // keepalive — ignore
        setLogs(prev => [...prev, e.data]);
      };

      ws.onerror = () => {
        setLogs(prev => [...prev, '⚠ WebSocket error — switching to polling fallback…']);
      };

      /* ── CRITICAL: fallback when WS closes before pipeline finishes ─────── */
      ws.onclose = () => {
        // Only activate polling if pipeline is still running
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

      {/* Loader — only while WS not yet connected AND no logs yet */}
      <LoaderOverlay visible={stage === 'running' && logs.length === 0} />

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
      </header>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: '100%', margin: '0 10px', padding: '36px 28px 60px' }}>

        {/* Error banner */}
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

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {report ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
                  Analysis Result
                </h2>
              </div>
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
            <ResultsDisplay report={report} />
          </div>

        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ── Input card ───────────────────────────────────────────────── */}
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

                {/* Step 1 — ZIP */}
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

                {/* Step 2 — ZipFileExplorer */}
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

                {/* Step 3 — Description */}
                <div className="step-card" style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '20px' }}>
                  <StepLabel num={zipFile ? '3' : '2'} text="Project Description" />
                  <RichTextQuestionInput value={description} onChange={setDescription} />
                </div>

                {/* Badge */}
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

                {/* Buttons */}
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

                  {(zipFile || description) && stage !== 'running' && (
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
                  )}
                </div>
              </form>
            </div>

            {/* ── Live Pipeline Panel ──────────────────────────────────────── */}
            {stage === 'running' && logs.length > 0 && (
              <div style={{
                borderRadius: T.radiusLg, border: `1px solid ${T.border}`,
                overflow: 'hidden', boxShadow: T.shadowMd,
              }}>
                {/* Header */}
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

                {/* Node steps */}
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

                {/* Log output */}
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

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{
        background: T.surface, borderTop: `1px solid ${T.border}`,
        padding: '16px 28px', textAlign: 'center',
        fontSize: '12px', color: T.textMuted, letterSpacing: '0.02em',
      }}>
        QC Automation · LangGraph + LangChain + Groq · 7-Step Pipeline
      </footer>
    </div>
  );
}

export default App;
