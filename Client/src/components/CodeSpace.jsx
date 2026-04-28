// src/components/CodeSpace.jsx
// Shows AI-generated index.html / style.css / script.js with a live preview.
// Preview tab: split view — preview iframe (left) + testcase.js code (right).
// Description tab: renders the HTML description with images (no raw base64 blobs).
import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Eye, FileCode2, Copy, Check, Download,
  RefreshCw, AlertCircle, CheckCircle2,
} from 'lucide-react';
import {
  getSolutionFiles, saveSolutionFiles, runTestsOnly,
  getStatus, getReport, getPreviewUrl, getTestcase,
} from '../services/api';

/* ── Theme ──────────────────────────────────────────────────────────────────── */
const T = {
  bg:          '#0A0920',
  surface:     '#0F0E26',
  panel:       '#12112A',
  border:      'rgba(255,255,255,0.07)',
  borderHover: 'rgba(90,79,207,0.5)',
  indigo:      '#5A4FCF',
  indigoMid:   '#7C75E0',
  indigoLight: '#F0EFFF',
  green:       '#10B981',
  greenLight:  '#ECFDF5',
  red:         '#EF4444',
  redLight:    '#FEF2F2',
  amber:       '#F59E0B',
  textPrimary: '#E5E3FF',
  textMuted:   'rgba(229,227,255,0.45)',
  textTiny:    'rgba(229,227,255,0.25)',
  fontMono:    "'DM Mono','Fira Code','Cascadia Code','Courier New',monospace",
  fontSans:    "'DM Sans','Segoe UI',system-ui,sans-serif",
};

/* ── File tabs config ────────────────────────────────────────────────────────── */
const FILE_TABS = [
  { key: 'html',     label: 'index.html',  file: 'index.html', color: '#F87171', lang: 'html' },
  { key: 'css',      label: 'style.css',   file: 'style.css',  color: '#60A5FA', lang: 'css'  },
  { key: 'js',       label: 'script.js',   file: 'script.js',  color: '#FBBF24', lang: 'js'   },
  { key: 'testcase', label: 'testcase.js', file: null,          color: '#FB923C', lang: 'js'   },
  { key: 'preview',  label: 'Preview',     file: null,          color: '#34D399', lang: null   },
];

/* ── Tokenizer ───────────────────────────────────────────────────────────────── */
function tokenizeLine(raw, lang) {
  const toks = [];
  const push = (text, color) => { if (text) toks.push({ text, color }); };
  let i = 0;

  if (lang === 'html') {
    let outside = '';
    while (i < raw.length) {
      if (raw[i] === '<') {
        push(outside, '#9CA3AF'); outside = '';
        i++;
        let tagBody = '';
        while (i < raw.length && raw[i] !== '>') tagBody += raw[i++];
        if (raw[i] === '>') i++;
        push('<', '#6B7280');
        if (tagBody.startsWith('!--')) { push(tagBody + '>', '#6B7280'); continue; }
        if (tagBody.startsWith('/')) { push('/', '#6B7280'); tagBody = tagBody.slice(1); }
        const nameEnd = tagBody.search(/[\s/>]/);
        const tagName = nameEnd === -1 ? tagBody : tagBody.slice(0, nameEnd);
        const attrStr = nameEnd === -1 ? '' : tagBody.slice(nameEnd);
        push(tagName, '#F87171');
        let j = 0;
        while (j < attrStr.length) {
          const ch = attrStr[j];
          if (ch === '"' || ch === "'") {
            const q = ch; let val = ''; j++;
            while (j < attrStr.length && attrStr[j] !== q) val += attrStr[j++];
            j++;
            push(q + val + q, '#FBBF24');
          } else if (ch === '=') { push('=', '#6B7280'); j++;
          } else if (ch === '/' || ch === '>') { push(ch, '#6B7280'); j++;
          } else if (/[\w-]/.test(ch)) {
            let attr = '';
            while (j < attrStr.length && /[\w:-]/.test(attrStr[j])) attr += attrStr[j++];
            push(attr, '#86EFAC');
          } else { push(ch, '#6B7280'); j++; }
        }
        push('>', '#6B7280');
      } else { outside += raw[i++]; }
    }
    push(outside, '#9CA3AF');

  } else if (lang === 'css') {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('/*') || trimmed.startsWith('//')) {
      push(raw, '#6B7280');
    } else if (/{/.test(raw) && !raw.trimStart().startsWith(' ')) {
      const brace = raw.indexOf('{');
      push(raw.slice(0, brace), '#C084FC');
      push(raw.slice(brace), '#6B7280');
    } else if (/:/.test(raw) && raw.trimStart().length && raw.trimStart()[0] !== '{') {
      const colon = raw.indexOf(':');
      push(raw.slice(0, colon), '#60A5FA');
      push(':', '#6B7280');
      const rest = raw.slice(colon + 1);
      const semi = rest.lastIndexOf(';');
      if (semi !== -1) { push(rest.slice(0, semi), '#F9A8D4'); push(rest.slice(semi), '#6B7280'); }
      else push(rest, '#F9A8D4');
    } else { push(raw, '#C8C3FF'); }

  } else if (lang === 'js') {
    const JS_KW = new Set([
      'const','let','var','function','return','if','else','for','while','do',
      'class','import','export','default','async','await','new','this','typeof',
      'instanceof','of','in','try','catch','finally','throw','switch','case',
      'break','continue','true','false','null','undefined','void','delete',
    ]);
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('//')) { push(raw, '#6B7280'); return toks; }
    if (trimmed.startsWith('/*')) { push(raw, '#6B7280'); return toks; }
    let buf = '';
    const flushBuf = () => {
      if (!buf) return;
      const wordRe = /([A-Za-z_$][\w$]*)|([^A-Za-z_$\w]+)/g;
      let m;
      while ((m = wordRe.exec(buf)) !== null) {
        if (m[1]) push(m[1], JS_KW.has(m[1]) ? '#60A5FA' : '#C8C3FF');
        else push(m[0], '#C8C3FF');
      }
      buf = '';
    };
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '/' && raw[i + 1] === '/') { flushBuf(); push(raw.slice(i), '#6B7280'); i = raw.length;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        flushBuf();
        const q = ch; let str = q; i++;
        while (i < raw.length && raw[i] !== q) {
          if (raw[i] === '\\' && i + 1 < raw.length) { str += raw[i] + raw[i + 1]; i += 2; }
          else str += raw[i++];
        }
        str += (raw[i] || ''); i++;
        push(str, '#86EFAC');
      } else if (/[0-9]/.test(ch) && !buf) {
        let num = '';
        while (i < raw.length && /[0-9.]/.test(raw[i])) num += raw[i++];
        push(num, '#FBBF24');
      } else { buf += ch; i++; }
    }
    flushBuf();
  } else { push(raw, '#C8C3FF'); }

  return toks.length ? toks : [{ text: raw, color: '#C8C3FF' }];
}

/* ── Line-numbered code block ────────────────────────────────────────────────── */
const CodeBlock = ({ content, lang }) => {
  const lines = (content || '(empty)').split('\n');
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'auto', fontFamily: T.fontMono }}>
      <div style={{
        userSelect: 'none', textAlign: 'right', paddingRight: '14px',
        paddingLeft: '14px', paddingTop: '16px', paddingBottom: '16px',
        background: 'rgba(0,0,0,0.2)', color: T.textTiny,
        fontSize: '12px', lineHeight: '1.7', borderRight: `1px solid ${T.border}`,
        flexShrink: 0, minWidth: '46px',
      }}>
        {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div style={{ flex: 1, padding: '16px 20px', fontSize: '12.5px', lineHeight: '1.7', overflowX: 'auto' }}>
        {lines.map((line, i) => {
          const tokens = tokenizeLine(line, lang);
          return (
            <div key={i} style={{ whiteSpace: 'pre', minHeight: '1.7em' }}>
              {tokens.map((tok, j) => <span key={j} style={{ color: tok.color }}>{tok.text}</span>)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Main component ──────────────────────────────────────────────────────────── */
const CodeSpace = ({ onReportUpdate, initialReport }) => {
  const [files,           setFiles]           = useState({ 'index.html': '', 'style.css': '', 'script.js': '' });
  const [testcaseContent, setTestcaseContent] = useState('');
  const [activeTab,       setActiveTab]       = useState('html');
  const [loading,          setLoading]          = useState(true);
  const [running,          setRunning]          = useState(false);
  const [runStatus,        setRunStatus]        = useState(null);
  const [testResults,      setTestResults]      = useState(initialReport?.test_results ?? []);
  const [copied,           setCopied]           = useState(false);
  const [editMode,         setEditMode]         = useState(false);
  const [editVal,          setEditVal]          = useState('');
  const [saving,           setSaving]           = useState(false);
  const [savedOk,          setSavedOk]          = useState(false);
  const pollRef = useRef(null);

  /* ── Load all data on mount ─────────────────────────────────────────────────── */
  useEffect(() => {
    Promise.all([
      getSolutionFiles().catch(() => ({})),
      getTestcase().catch(() => ({ content: '' })),
    ]).then(([solutionData, tcData]) => {
      setFiles(solutionData);
      setTestcaseContent(tcData?.content || '');
      setLoading(false);
    });
  }, []);

  /* Cleanup poll on unmount */
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /* Sync edit textarea when tab changes */
  useEffect(() => {
    const tab = FILE_TABS.find(t => t.key === activeTab);
    if (tab?.file) setEditVal(files[tab.file] || '');
    setEditMode(false);
  }, [activeTab]);

  /* ── Handlers ──────────────────────────────────────────────────────────────── */
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const handleRunTests = async () => {
    if (running) return;
    setRunning(true); setRunStatus('running');
    try {
      const res = await runTestsOnly();
      if (res.status === 'already_running' || res.error) {
        setRunning(false); setRunStatus(res.error ? 'error' : null); return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const status = await getStatus();
          if (!status.running) {
            stopPoll();
            if (status.error) { setRunStatus('error'); }
            else {
              const report = await getReport();
              onReportUpdate?.(report);
              setTestResults(report?.test_results ?? []);
              setRunStatus('done');
            }
            setRunning(false);
          }
        } catch (_) {}
      }, 2000);
    } catch (_) { setRunStatus('error'); setRunning(false); }
  };

  const handleCopy = () => {
    const tab = FILE_TABS.find(t => t.key === activeTab);
    const content = tab?.file ? files[tab.file] : activeTab === 'testcase' ? testcaseContent : '';
    navigator.clipboard.writeText(content || '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const tab = FILE_TABS.find(t => t.key === activeTab);
    if (!tab?.file) return;
    const blob = new Blob([files[tab.file] || ''], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = tab.file; a.click();
  };

  const handleSaveEdit = async () => {
    const tab = FILE_TABS.find(t => t.key === activeTab);
    if (!tab?.file) return;
    setSaving(true);
    const updated = { ...files, [tab.file]: editVal };
    try {
      await saveSolutionFiles(updated);
      setFiles(updated); setSavedOk(true); setEditMode(false);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (_) {}
    setSaving(false);
  };

  /* ── Derived ───────────────────────────────────────────────────────────────── */
  const currentTab     = FILE_TABS.find(t => t.key === activeTab);
  const currentContent = currentTab?.file ? files[currentTab.file] : null;
  const currentLang    = currentTab?.lang ?? null;
  const previewUrl     = getPreviewUrl();
  const isFileTab      = !!currentTab?.file;
  const lineCount      = currentContent ? currentContent.split('\n').length : 0;
  const charCount      = currentContent ? currentContent.length : 0;

  /* ── Render ────────────────────────────────────────────────────────────────── */
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: T.surface, borderRadius: '16px',
      border: `1px solid ${T.border}`, overflow: 'hidden',
      boxShadow: '0 4px 32px rgba(0,0,0,0.35)',
      fontFamily: T.fontSans,
    }}>

      {/* ── Header bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: T.panel, borderBottom: `1px solid ${T.border}`,
        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '14px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {['#EF4444', '#F59E0B', '#10B981'].map((c, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c, opacity: 0.8 }} />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: T.textPrimary, letterSpacing: '-0.01em' }}>
            🤖 AI Generated Solution
          </div>
          <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '1px' }}>
            Puppeteer tests run against these files
          </div>
        </div>
        {savedOk && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '4px 12px', borderRadius: '999px',
            background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
            fontSize: '11px', fontWeight: '600', color: T.green,
          }}>
            <CheckCircle2 size={11} /> Saved
          </div>
        )}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────────── */}
      <div style={{
        background: T.panel, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', padding: '0 4px', gap: '2px',
        overflowX: 'auto',
      }}>
        {FILE_TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: isActive ? T.surface : 'transparent',
                color: isActive ? tab.color : T.textMuted,
                fontSize: '12px', fontWeight: isActive ? '700' : '500',
                fontFamily: T.fontMono, whiteSpace: 'nowrap',
                borderRadius: '6px 6px 0 0',
                borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              {tab.key === 'preview'     && <Eye size={12} />}
              {tab.key === 'description' && <span style={{ fontSize: '11px' }}>📄</span>}
              {tab.key !== 'preview' && tab.key !== 'description' && <FileCode2 size={12} />}
              {tab.label}
              {/* File size badge */}
              {tab.file && files[tab.file] && (
                <span style={{
                  fontSize: '9px', padding: '1px 5px', borderRadius: '4px',
                  background: 'rgba(255,255,255,0.06)', color: T.textTiny, fontFamily: T.fontSans,
                }}>
                  {Math.round(files[tab.file].length / 1024 * 10) / 10}k
                </span>
              )}
              {/* Testcase size badge */}
              {tab.key === 'testcase' && testcaseContent && (
                <span style={{
                  fontSize: '9px', padding: '1px 5px', borderRadius: '4px',
                  background: 'rgba(255,255,255,0.06)', color: T.textTiny, fontFamily: T.fontSans,
                }}>
                  {Math.round(testcaseContent.length / 1024 * 10) / 10}k
                </span>
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '4px', padding: '0 8px', flexShrink: 0 }}>
          {/* Edit toggle — only for editable file tabs */}
          {isFileTab && (
            <button
              onClick={() => { setEditMode(e => !e); if (!editMode) setEditVal(currentContent || ''); }}
              title={editMode ? 'Cancel edit' : 'Edit file'}
              style={iconBtnStyle}
            >
              <span style={{ fontSize: '11px', color: editMode ? T.indigoMid : T.textMuted }}>
                {editMode ? 'cancel' : 'edit'}
              </span>
            </button>
          )}

          {/* Copy — for file tabs + testcase */}
          {(isFileTab || activeTab === 'testcase') && (
            <button onClick={handleCopy} title="Copy code" style={iconBtnStyle}>
              {copied ? <Check size={13} color={T.green} /> : <Copy size={13} color={T.textMuted} />}
            </button>
          )}

          {/* Download — only for editable file tabs */}
          {isFileTab && (
            <button onClick={handleDownload} title="Download file" style={iconBtnStyle}>
              <Download size={13} color={T.textMuted} />
            </button>
          )}
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        minHeight: '460px',
        background: T.bg,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {loading ? (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: T.textMuted, fontSize: '13px', gap: '10px',
          }}>
            <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
            Loading…
          </div>

        ) : activeTab === 'preview' ? (
          /* ── Full preview iframe ─────────────────────────────────────────────── */
          <iframe
            src={previewUrl}
            title="Solution Preview"
            sandbox="allow-scripts allow-same-origin"
            style={{ width: '100%', flex: 1, border: 'none', background: '#fff' }}
          />

        ) : activeTab === 'testcase' ? (
          /* ── Testcase code (full view) ────────────────────────────────────────── */
          <div style={{ flex: 1, overflow: 'auto' }}>
            {testcaseContent
              ? <CodeBlock content={testcaseContent} lang="js" />
              : <div style={{ padding: '20px', color: T.textMuted, fontSize: '12px', fontFamily: T.fontSans }}>
                  testcase.js not found — run the pipeline first.
                </div>
            }
          </div>

        ) : editMode ? (
          /* ── Edit mode ────────────────────────────────────────────────────────── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <textarea
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, border: 'none', outline: 'none', resize: 'none',
                background: T.bg, color: '#C8C3FF', fontFamily: T.fontMono,
                fontSize: '12.5px', lineHeight: '1.7', padding: '16px 20px',
              }}
            />
            <div style={{
              padding: '10px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end',
              borderTop: `1px solid ${T.border}`, background: T.panel,
            }}>
              <button onClick={() => setEditMode(false)} style={{
                padding: '6px 14px', borderRadius: '7px', border: `1px solid ${T.border}`,
                background: 'transparent', color: T.textMuted, cursor: 'pointer',
                fontSize: '12px', fontFamily: T.fontSans,
              }}>Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving} style={{
                padding: '6px 14px', borderRadius: '7px', border: 'none',
                background: T.indigo, color: '#fff', cursor: 'pointer',
                fontSize: '12px', fontWeight: '600', fontFamily: T.fontSans,
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

        ) : (
          /* ── Read-only highlighted code ───────────────────────────────────────── */
          <div style={{ flex: 1, overflow: 'auto' }}>
            <CodeBlock content={currentContent} lang={currentLang} />
          </div>
        )}
      </div>

      {/* ── Run Testcase section ───────────────────────────────────────────────── */}
      <div style={{ background: T.panel, borderTop: `1px solid ${T.border}`, padding: '16px 20px' }}>
        {runStatus && (
          <div style={{
            marginBottom: '12px', padding: '8px 14px', borderRadius: '8px',
            fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px',
            background:
              runStatus === 'done'  ? 'rgba(16,185,129,0.12)' :
              runStatus === 'error' ? 'rgba(239,68,68,0.12)'  : 'rgba(90,79,207,0.12)',
            border: `1px solid ${
              runStatus === 'done'  ? 'rgba(16,185,129,0.25)' :
              runStatus === 'error' ? 'rgba(239,68,68,0.25)'  : 'rgba(90,79,207,0.25)'}`,
            color:
              runStatus === 'done'  ? '#34D399' :
              runStatus === 'error' ? '#F87171' : T.indigoMid,
          }}>
            {runStatus === 'running' && <><RefreshCw size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> Running Puppeteer tests…</>}
            {runStatus === 'done'    && <><CheckCircle2 size={12} /> Tests complete — results updated below.</>}
            {runStatus === 'error'   && <><AlertCircle size={12} /> Test run failed — check pipeline logs.</>}
          </div>
        )}

        <button
          onClick={handleRunTests}
          disabled={running}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px',
            padding: '11px 20px', borderRadius: '10px', border: 'none',
            background: running ? 'rgba(90,79,207,0.3)' : `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})`,
            color: '#fff', cursor: running ? 'not-allowed' : 'pointer',
            fontSize: '13px', fontWeight: '700', fontFamily: T.fontSans,
            boxShadow: running ? 'none' : '0 3px 14px rgba(90,79,207,0.35)',
            transition: 'all 0.2s',
          }}
        >
          {running
            ? <><RefreshCw size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Running Testcases…</>
            : <><Play size={13} strokeWidth={2.5} /> Run Testcase</>
          }
        </button>

        {testResults.length > 0 && (
          <div style={{ marginTop: '14px' }}>
            <div style={{
              fontSize: '11px', fontWeight: '700', color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.07em',
              marginBottom: '8px', fontFamily: T.fontSans,
            }}>
              Testcase Results — {testResults.filter(r => r.status === 'PASS').length}/{testResults.length} passed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {testResults.map((r, i) => (
                <div key={r.id ?? i} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '7px 12px', borderRadius: '8px',
                  background: r.status === 'PASS' ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
                  border: `1px solid ${r.status === 'PASS' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                }}>
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>{r.status === 'PASS' ? '✅' : '❌'}</span>
                  <span style={{
                    flex: 1, fontSize: '12px', fontWeight: '600',
                    color: r.status === 'PASS' ? '#34D399' : '#F87171', fontFamily: T.fontSans,
                  }}>{r.name || r.id}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px',
                    background: r.status === 'PASS' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                    color: r.status === 'PASS' ? '#34D399' : '#F87171',
                    fontFamily: T.fontSans, letterSpacing: '0.05em',
                  }}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer status bar ──────────────────────────────────────────────────── */}
      {isFileTab && !loading && (
        <div style={{
          background: T.panel, borderTop: `1px solid ${T.border}`,
          padding: '6px 16px', display: 'flex', alignItems: 'center', gap: '16px',
          fontSize: '11px', color: T.textTiny, fontFamily: T.fontMono,
        }}>
          <span style={{ color: currentTab?.color, fontWeight: '600' }}>{currentTab?.label}</span>
          <span>{lineCount} lines</span>
          <span>{charCount} chars</span>
          <span>{currentLang?.toUpperCase() || ''}</span>
          <div style={{ flex: 1 }} />
          <span>UTF-8</span>
        </div>
      )}
    </div>
  );
};

/* ── Shared styles ───────────────────────────────────────────────────────────── */
const iconBtnStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '28px', height: '28px', border: 'none', borderRadius: '6px',
  background: 'transparent', cursor: 'pointer', transition: 'background 0.15s',
};

export default CodeSpace;
