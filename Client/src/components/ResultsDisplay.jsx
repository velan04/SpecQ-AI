// src/components/ResultsDisplay.jsx
// Displays the new QC report format:
// { summary: {total,passed,failed,pass_rate},
//   test_results: [{id,name,status,error_message}],
//   failure_analysis: [{id,name,category,description_gap,description_gap_detail,
//                        implementation_detail,code_snippet}] }
import React, { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, Code } from 'lucide-react';

// ─── Theme ────────────────────────────────────────────────────────────────────
const th = {
  white:   '#ffffff',
  surface: '#f8f9ff',
  border:  '#e4e8f7',

  indigo50:  '#eef0fb',
  indigo100: '#dde2f7',
  indigo500: '#5b6fd4',
  indigo600: '#4355c8',
  indigo700: '#3344b2',

  green50:  '#f0fdf6',
  green200: '#a7f3ca',
  green600: '#16a34a',
  green700: '#15803d',

  red50:  '#fff1f2',
  red200: '#fecdd3',
  red600: '#dc2626',
  red700: '#b91c1c',

  amber50:  '#fffbeb',
  amber200: '#fde68a',
  amber600: '#d97706',
  amber700: '#b45309',

  textPrimary:   '#1a1f3c',
  textSecondary: '#4a5180',
  textMuted:     '#8b91b8',
  textTiny:      '#a0a6cc',

  shadowSm:  '0 1px 3px rgba(67,85,200,0.07)',
  shadowMd:  '0 4px 16px rgba(67,85,200,0.10)',
  radiusSm:  '8px',
  radiusMd:  '12px',
  radiusLg:  '16px',
  radiusPill:'999px',
  fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",
  fontMono:  "'DM Mono','Fira Code',monospace",
};

// ─── Error Boundary ───────────────────────────────────────────────────────────
class QCErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 16, background: th.red50, border: `1px solid ${th.red200}`, borderRadius: 10, fontFamily: th.fontFamily }}>
        <p style={{ color: th.red700, fontWeight: 700, margin: '0 0 4px' }}>⚠ Render error</p>
        <p style={{ color: th.red600, fontSize: 13, fontFamily: th.fontMono }}>{String(this.state.error.message)}</p>
      </div>
    );
    return this.props.children;
  }
}

// ─── Pass Rate Ring ───────────────────────────────────────────────────────────
const PassRateRing = ({ rate }) => {
  const [animated, setAnimated] = React.useState(0);
  React.useEffect(() => { const t = setTimeout(() => setAnimated(rate), 120); return () => clearTimeout(t); }, [rate]);

  const r    = 54;
  const circ = 2 * Math.PI * r;
  const fill = (animated / 100) * circ;
  const color  = rate >= 80 ? th.green600 : rate >= 50 ? th.amber600 : th.red600;
  const bgCol  = rate >= 80 ? th.green50  : rate >= 50 ? th.amber50  : th.red50;
  const ringBg = rate >= 80 ? th.green200 : rate >= 50 ? th.amber200 : th.red200;
  const txtCol = rate >= 80 ? th.green700 : rate >= 50 ? th.amber700 : th.red700;
  const label  = rate >= 80 ? 'Great'     : rate >= 50 ? 'Partial'   : 'Needs Work';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: 148, height: 148 }}>
        <svg width="148" height="148" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="74" cy="74" r={r} fill="none" stroke={ringBg} strokeWidth="10" />
          <circle cx="74" cy="74" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={circ - fill} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.34,1.56,0.64,1)' }} />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: bgCol, borderRadius: '50%', margin: 16,
        }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: txtCol, lineHeight: 1 }}>{rate}</span>
          <span style={{ fontSize: 10, color: txtCol, fontWeight: 600, opacity: 0.6 }}>%</span>
        </div>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, color: txtCol,
        background: bgCol, padding: '4px 14px', borderRadius: th.radiusPill,
        border: `1.5px solid ${ringBg}`, letterSpacing: '0.04em',
      }}>
        Pass Rate · {label}
      </span>
    </div>
  );
};

// ─── Test Result Card ─────────────────────────────────────────────────────────
const TestCard = ({ result, analysis }) => {
  const [open, setOpen] = useState(false);
  const isPass = result.status === 'PASS';

  const borderCol = isPass ? th.green200 : th.red200;
  const bgCol     = isPass ? '#f6fff9'   : '#fff5f5';
  const StatusIcon = isPass ? CheckCircle2 : XCircle;
  const iconColor  = isPass ? th.green600  : th.red600;

  const category = analysis?.category || '';
  const hasGap   = analysis?.description_gap;
  const hasSnippet = !!analysis?.code_snippet;
  const canExpand  = !isPass && (analysis?.implementation_detail || hasGap || hasSnippet);

  return (
    <div style={{
      border: `1.5px solid ${borderCol}`, borderRadius: 10,
      overflow: 'hidden', background: bgCol, marginBottom: 8,
      fontFamily: th.fontFamily, boxShadow: th.shadowSm,
    }}>
      {/* Header row */}
      <div
        onClick={() => canExpand && setOpen(o => !o)}
        style={{
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          cursor: canExpand ? 'pointer' : 'default', flexWrap: 'wrap',
        }}
      >
        <StatusIcon size={16} style={{ color: iconColor, flexShrink: 0 }} />

        {/* Status badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: th.radiusPill,
          background: isPass ? th.green50 : th.red50,
          color: isPass ? th.green600 : th.red600,
          border: `1px solid ${isPass ? th.green200 : th.red200}`,
          flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {result.status}
        </span>

        {/* Description gap badge */}
        {hasGap && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: th.radiusPill,
            background: th.amber50, color: th.amber700, border: `1px solid ${th.amber200}`,
            flexShrink: 0,
          }}>
            ⚠ Description Gap
          </span>
        )}

        {/* ID chip */}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
          background: th.indigo50, color: th.indigo500, fontFamily: th.fontMono,
          flexShrink: 0, border: `1px solid ${th.indigo100}`,
        }}>
          {result.id}
        </span>

        {/* Name */}
        <span style={{ fontSize: 13, fontWeight: 700, color: th.textPrimary, flex: 1, minWidth: 120, letterSpacing: '-0.01em' }}>
          {result.name}
        </span>

        {canExpand && (
          <div style={{
            width: 22, height: 22, borderRadius: 6, background: '#f1f3fc',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {open ? <ChevronUp size={12} color={th.textMuted} /> : <ChevronDown size={12} color={th.textMuted} />}
          </div>
        )}
      </div>

      {/* Expanded failure details */}
      {open && analysis && (
        <div style={{ padding: 14, background: th.white, borderTop: `1px solid ${borderCol}` }}>

          {/* Implementation detail */}
          {analysis.implementation_detail && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: th.red700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                ❌ What Went Wrong
              </p>
              <p style={{
                fontSize: 12, color: th.red600, padding: '8px 12px',
                background: th.red50, borderRadius: 6, borderLeft: `3px solid ${th.red200}`,
                margin: 0, lineHeight: 1.55,
              }}>
                {analysis.implementation_detail}
              </p>
            </div>
          )}

          {/* Description gap detail */}
          {hasGap && analysis.description_gap_detail && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: th.amber700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                ⚠ Missing From Description
              </p>
              <p style={{
                fontSize: 12, color: th.amber700, padding: '8px 12px',
                background: th.amber50, borderRadius: 6, borderLeft: `3px solid ${th.amber200}`,
                margin: 0, lineHeight: 1.55,
              }}>
                {analysis.description_gap_detail}
              </p>
            </div>
          )}

          {/* Code snippet */}
          {hasSnippet && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: th.textMuted, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Code size={10} /> Relevant Generated Code
              </p>
              <pre style={{
                fontSize: 11, fontFamily: th.fontMono, background: '#0f0e26',
                color: '#c8c3ff', padding: '10px 14px', borderRadius: 6,
                overflowX: 'auto', margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {analysis.code_snippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main ResultsDisplay ──────────────────────────────────────────────────────
const ResultsDisplay = ({ report }) => {
  if (!report) return null;

  const {
    summary = {},
    test_results = [],
    failure_analysis = [],
    raw_stdout = '',
    raw_stderr = '',
  } = report;

  const total   = summary.total     ?? test_results.length;
  const passed  = summary.passed    ?? test_results.filter(r => r.status === 'PASS').length;
  const failed  = summary.failed    ?? test_results.filter(r => r.status === 'FAIL').length;
  const rate    = typeof summary.pass_rate === 'number' ? Math.round(summary.pass_rate) : (total ? Math.round(passed / total * 100) : 0);
  const allPass = failed === 0 && total > 0;

  // Build lookup: test id → failure analysis
  const analysisMap = Object.fromEntries(failure_analysis.map(a => [a.id, a]));

  const descGapCount = failure_analysis.filter(a => a.description_gap).length;

  /* ── Empty state: test runner produced no results ──────────────────────── */
  if (total === 0) {
    return (
      <QCErrorBoundary>
        <div style={{
          width: '100%', background: th.surface, borderRadius: 20,
          padding: 20, fontFamily: th.fontFamily,
        }}>
          <div style={{
            background: th.white, borderRadius: th.radiusLg,
            border: `1.5px solid ${th.indigo100}`, boxShadow: th.shadowMd,
            padding: '40px 32px', textAlign: 'center',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
              background: th.indigo50, border: `1.5px solid ${th.indigo100}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={28} style={{ color: th.indigo500 }} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: th.textPrimary, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
              No Test Results Found
            </h2>
            <p style={{ fontSize: 13, color: th.textSecondary, margin: '0 0 24px', lineHeight: 1.6, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
              The Puppeteer test runner completed but returned 0 results. This usually means one of the following:
            </p>

            {/* Cause list */}
            <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '📦', title: 'puppeteer not installed', desc: 'Your ZIP must contain package.json. The runner will auto-run npm install — check the Live Logs for "npm install" output.' },
                { icon: '📄', title: 'Wrong output format', desc: 'testcase.js must print: console.log(`TESTCASE:your_id:success`) or :failure for each test.' },
                { icon: '🔗', title: 'URL not patched', desc: 'If no const/let/var url = "https://..." line is found, Puppeteer navigates to the wrong host. Check logs for "URL pattern not found" warning.' },
                { icon: '⏱', title: 'Timeout / crash', desc: 'Node process may have crashed before printing anything. Check STDERR lines in the Live Logs.' },
              ].map((c, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 12, padding: '10px 14px',
                  background: th.indigo50, borderRadius: th.radiusSm,
                  border: `1px solid ${th.indigo100}`,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: th.textPrimary, marginBottom: 2 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: th.textSecondary, lineHeight: 1.5 }}>{c.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Required format snippet */}
            <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto 24px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: th.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Required output format in testcase.js
              </p>
              <pre style={{
                fontSize: 12, fontFamily: "'DM Mono','Fira Code',monospace",
                background: '#0f0e26', color: '#c8c3ff', padding: '12px 16px',
                borderRadius: th.radiusSm, margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap',
              }}>{`// Wrap each test in try/catch and print the result:
try {
  await page.waitForSelector('#my-element', {timeout: 5000});
  console.log('TESTCASE:check_element:success');
} catch (e) {
  console.log('TESTCASE:check_element:failure');
}`}</pre>
            </div>

            {/* Raw node output (if available) */}
            {(raw_stderr || raw_stdout) && (
              <div style={{ textAlign: 'left', maxWidth: 520, margin: '0 auto' }}>
                {raw_stderr && (
                  <>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      ❌ Node.js stderr (error output)
                    </p>
                    <pre style={{
                      fontSize: 11, fontFamily: "'DM Mono','Fira Code',monospace",
                      background: '#1a0000', color: '#f87171', padding: '10px 14px',
                      borderRadius: th.radiusSm, marginBottom: 14, lineHeight: 1.65,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                    }}>{raw_stderr}</pre>
                  </>
                )}
                {raw_stdout && (
                  <>
                    <p style={{ fontSize: 11, fontWeight: 700, color: th.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      📄 Node.js stdout (raw output)
                    </p>
                    <pre style={{
                      fontSize: 11, fontFamily: "'DM Mono','Fira Code',monospace",
                      background: '#0f0e26', color: '#c8c3ff', padding: '10px 14px',
                      borderRadius: th.radiusSm, margin: 0, lineHeight: 1.65,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                    }}>{raw_stdout}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </QCErrorBoundary>
    );
  }

  return (
    <QCErrorBoundary>
      <div style={{
        width: '100%', display: 'flex', flexDirection: 'column', gap: 14,
        fontFamily: th.fontFamily, background: th.surface, padding: 20, borderRadius: 20,
      }}>

        {/* ── Hero card ──────────────────────────────────────────────────────── */}
        <div style={{
          background: th.white, borderRadius: th.radiusLg,
          border: `1.5px solid ${allPass ? th.green200 : th.red200}`,
          boxShadow: th.shadowMd, overflow: 'hidden',
        }}>
          {/* Header bar */}
          <div style={{
            background: allPass ? th.green50 : th.red50,
            padding: '16px 24px',
            display: 'flex', alignItems: 'center', gap: 12,
            borderBottom: `1px solid ${allPass ? th.green200 : th.red200}`,
            flexWrap: 'wrap',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: allPass ? `${th.green600}18` : `${th.red600}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1.5px solid ${allPass ? th.green200 : th.red200}`,
            }}>
              {allPass
                ? <CheckCircle2 size={22} style={{ color: th.green600 }} />
                : <XCircle      size={22} style={{ color: th.red600   }} />}
            </div>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: allPass ? th.green700 : th.red700, margin: 0, letterSpacing: '-0.03em' }}>
                {allPass ? 'ALL TESTS PASSED' : `${failed} TEST${failed !== 1 ? 'S' : ''} FAILED`}
              </h2>
              <p style={{ fontSize: 12, color: th.textMuted, margin: '2px 0 0' }}>
                AI-generated solution ran against Puppeteer testcase
              </p>
            </div>
          </div>

          {/* Stats + ring */}
          <div style={{ padding: 28, display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <PassRateRing rate={rate} />
            </div>

            <div style={{ flex: 1, minWidth: 200, paddingTop: 6 }}>
              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { v: total,         label: 'Total',    color: th.textPrimary },
                  { v: passed,        label: 'Passed',   color: th.green600 },
                  { v: failed,        label: 'Failed',   color: th.red600 },
                  { v: descGapCount,  label: 'Desc Gap', color: th.amber600 },
                ].map((s, i) => (
                  <div key={i} style={{
                    padding: '10px 14px', background: th.surface,
                    borderRadius: th.radiusSm, border: `1px solid ${th.border}`, textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: s.color, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.v ?? '—'}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: th.textTiny, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Pass rate bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: th.textSecondary }}>Pass Rate</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: allPass ? th.green600 : th.red600 }}>{rate}%</span>
                </div>
                <div style={{ height: 8, background: '#f1f3fc', borderRadius: th.radiusPill, overflow: 'hidden', border: `1px solid ${th.border}` }}>
                  <div style={{
                    height: '100%', borderRadius: th.radiusPill,
                    width: `${rate}%`,
                    background: allPass
                      ? `linear-gradient(90deg,${th.green600},#22c55e)`
                      : `linear-gradient(90deg,${th.red600},${th.amber600})`,
                    transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                </div>
              </div>

              {/* Verdict message */}
              {allPass ? (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px', borderRadius: th.radiusSm,
                  background: th.green50, border: `1px solid ${th.green200}`,
                  fontSize: 13, fontWeight: 700, color: th.green700,
                }}>
                  ✅ AI solution passed all testcases
                </div>
              ) : (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px', borderRadius: th.radiusSm,
                  background: th.red50, border: `1px solid ${th.red200}`,
                  fontSize: 13, fontWeight: 700, color: th.red700,
                }}>
                  🚫 {failed} test{failed !== 1 ? 's' : ''} failed — see details below
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Failed tests with analysis ────────────────────────────────────── */}
        {failed > 0 && (
          <div style={{
            background: th.white, borderRadius: th.radiusMd,
            border: `1.5px solid ${th.red200}`, overflow: 'hidden', boxShadow: th.shadowSm,
          }}>
            <div style={{
              padding: '14px 20px', background: th.red50,
              display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: `1px solid ${th.red200}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, background: `${th.red600}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${th.red200}`,
              }}>
                <XCircle size={15} style={{ color: th.red600 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: th.textPrimary }}>Failed Tests</span>
              <span style={{
                padding: '2px 10px', background: `${th.red600}10`, color: th.red600,
                fontSize: 11, fontWeight: 700, borderRadius: th.radiusPill,
                border: `1px solid ${th.red200}`,
              }}>
                {failed}
              </span>
            </div>
            <div style={{ padding: 16 }}>
              {test_results
                .filter(r => r.status === 'FAIL')
                .map((r, i) => (
                  <TestCard key={r.id || i} result={r} analysis={analysisMap[r.id]} />
                ))}
            </div>
          </div>
        )}

        {/* ── Passed tests ─────────────────────────────────────────────────── */}
        {passed > 0 && (
          <div style={{
            background: th.white, borderRadius: th.radiusMd,
            border: `1.5px solid ${th.green200}`, overflow: 'hidden', boxShadow: th.shadowSm,
          }}>
            <div style={{
              padding: '14px 20px', background: th.green50,
              display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: `1px solid ${th.green200}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, background: `${th.green600}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${th.green200}`,
              }}>
                <CheckCircle2 size={15} style={{ color: th.green600 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: th.textPrimary }}>Passed Tests</span>
              <span style={{
                padding: '2px 10px', background: `${th.green600}10`, color: th.green600,
                fontSize: 11, fontWeight: 700, borderRadius: th.radiusPill,
                border: `1px solid ${th.green200}`,
              }}>
                {passed}
              </span>
            </div>
            <div style={{ padding: 16 }}>
              {test_results
                .filter(r => r.status === 'PASS')
                .map((r, i) => (
                  <TestCard key={r.id || i} result={r} analysis={null} />
                ))}
            </div>
          </div>
        )}

        {/* ── Description gaps summary ──────────────────────────────────────── */}
        {descGapCount > 0 && (
          <div style={{
            background: th.white, borderRadius: th.radiusMd,
            border: `1.5px solid ${th.amber200}`, overflow: 'hidden', boxShadow: th.shadowSm,
          }}>
            <div style={{
              padding: '14px 20px', background: th.amber50,
              display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: `1px solid ${th.amber200}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9, background: `${th.amber600}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${th.amber200}`,
              }}>
                <AlertTriangle size={15} style={{ color: th.amber600 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: th.textPrimary }}>Description Gaps</span>
              <span style={{
                padding: '2px 10px', background: `${th.amber600}10`, color: th.amber700,
                fontSize: 11, fontWeight: 700, borderRadius: th.radiusPill,
                border: `1px solid ${th.amber200}`,
              }}>
                {descGapCount} test{descGapCount !== 1 ? 's' : ''} failing because spec didn't mention it
              </span>
            </div>
            <div style={{ padding: 16 }}>
              {failure_analysis
                .filter(a => a.description_gap)
                .map((a, i) => (
                  <div key={i} style={{
                    padding: '10px 14px', marginBottom: 8,
                    background: th.amber50, border: `1px solid ${th.amber200}`,
                    borderRadius: th.radiusSm, borderLeft: `3px solid ${th.amber600}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                        background: '#fff', color: th.amber700, border: `1px solid ${th.amber200}`,
                        fontFamily: th.fontMono,
                      }}>
                        {a.id}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: th.amber700 }}>{a.name}</span>
                    </div>
                    <p style={{ fontSize: 12, color: th.amber700, margin: 0, lineHeight: 1.55 }}>
                      {a.description_gap_detail || 'This requirement was not specified in the description.'}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        )}

      </div>
    </QCErrorBoundary>
  );
};

export default ResultsDisplay;
