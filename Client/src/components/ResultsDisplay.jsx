// src/components/ResultsDisplay.jsx
// Adapted for FastAPI QC report format
import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, FileText,
  ChevronDown, ChevronUp, Download, Star,
  CheckSquare, Zap, ListChecks, Search, Hash
} from 'lucide-react';

// ─── Theme Tokens ─────────────────────────────────────────────────────────────
const theme = {
  white:        '#ffffff',
  surface:      '#f8f9ff',
  surfaceAlt:   '#f1f3fc',
  border:       '#e4e8f7',
  borderStrong: '#c7cef0',

  indigo50:     '#eef0fb',
  indigo100:    '#dde2f7',
  indigo200:    '#bbc5ef',
  indigo400:    '#7b8fe0',
  indigo500:    '#5b6fd4',
  indigo600:    '#4355c8',
  indigo700:    '#3344b2',
  indigo900:    '#1e2a6e',

  textPrimary:  '#1a1f3c',
  textSecondary:'#4a5180',
  textMuted:    '#8b91b8',
  textTiny:     '#a0a6cc',

  green50:      '#f0fdf6',
  green200:     '#a7f3ca',
  green600:     '#16a34a',
  green700:     '#15803d',

  amber50:      '#fffbeb',
  amber200:     '#fde68a',
  amber600:     '#d97706',
  amber700:     '#b45309',

  red50:        '#fff1f2',
  red200:       '#fecdd3',
  red600:       '#dc2626',
  red700:       '#b91c1c',

  shadowSm:     '0 1px 3px rgba(67,85,200,0.07), 0 1px 2px rgba(67,85,200,0.04)',
  shadowMd:     '0 4px 16px rgba(67,85,200,0.10), 0 1px 4px rgba(67,85,200,0.06)',
  shadowHero:   '0 8px 32px rgba(67,85,200,0.12), 0 2px 8px rgba(67,85,200,0.07)',

  radiusSm:     '8px',
  radiusMd:     '12px',
  radiusLg:     '16px',
  radiusPill:   '999px',
  fontFamily:   "'DM Sans', 'Segoe UI', system-ui, sans-serif",
  fontMono:     "'DM Mono', 'Fira Code', monospace",
};

// ─── Verdict config ───────────────────────────────────────────────────────────
const verdictCfg = {
  'PASS':                { color: theme.green600,  bg: theme.green50,  border: theme.green200,  icon: CheckCircle2  },
  'PASS WITH WARNINGS':  { color: theme.amber600,  bg: theme.amber50,  border: theme.amber200,  icon: AlertTriangle },
  'NEEDS IMPROVEMENT':   { color: theme.amber700,  bg: theme.amber50,  border: theme.amber200,  icon: AlertTriangle },
  'FAIL':                { color: theme.red600,    bg: theme.red50,    border: theme.red200,    icon: XCircle       },
};
const getVerdictCfg = (v) => verdictCfg[v] || verdictCfg['FAIL'];

// ─── Status config for per-testcase ──────────────────────────────────────────
const statusCfg = {
  covered:             { color: theme.green600,  bg: theme.green50,  border: theme.green200,  label: 'Covered',  icon: CheckCircle2 },
  partial:             { color: theme.amber600,  bg: theme.amber50,  border: theme.amber200,  label: 'Partial',  icon: AlertTriangle },
  not_in_description:  { color: theme.red600,    bg: theme.red50,    border: theme.red200,    label: 'Missing',  icon: XCircle       },
};
const getStatusCfg = (s) => statusCfg[s] || statusCfg.not_in_description;

// ─── AIScoreRing ──────────────────────────────────────────────────────────────
const AIScoreRing = ({ score }) => {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(score), 120);
    return () => clearTimeout(t);
  }, [score]);

  const r    = 54;
  const circ = 2 * Math.PI * r;
  const fill = (animated / 100) * circ;

  const color   = score >= 90 ? theme.green600  : score >= 70 ? theme.amber600  : theme.red600;
  const bgCol   = score >= 90 ? theme.green50   : score >= 70 ? theme.amber50   : theme.red50;
  const ringBg  = score >= 90 ? theme.green200  : score >= 70 ? theme.amber200  : theme.red200;
  const txtCol  = score >= 90 ? theme.green700  : score >= 70 ? theme.amber700  : theme.red700;
  const label   = score >= 90 ? 'Excellent'     : score >= 70 ? 'Good'          : 'Needs Work';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <div style={{ position: 'relative', width: '148px', height: '148px' }}>
        <svg width="148" height="148" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="74" cy="74" r={r} fill="none" stroke={ringBg} strokeWidth="10" />
          <circle
            cx="74" cy="74" r={r} fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circ} strokeDashoffset={circ - fill} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: bgCol, borderRadius: '50%', margin: '16px',
          boxShadow: `inset 0 2px 6px ${ringBg}`,
        }}>
          <span style={{ fontSize: '34px', fontWeight: '800', color: txtCol, lineHeight: 1, fontFamily: theme.fontFamily }}>{score}</span>
          <span style={{ fontSize: '10px', color: txtCol, fontWeight: '600', opacity: 0.6, letterSpacing: '0.04em' }}>/ 100</span>
        </div>
      </div>
      <span style={{
        fontSize: '11px', fontWeight: '700', color: txtCol,
        background: bgCol, padding: '4px 14px', borderRadius: theme.radiusPill,
        border: `1.5px solid ${ringBg}`, letterSpacing: '0.04em', fontFamily: theme.fontFamily,
      }}>
        Quality Score · {label}
      </span>
    </div>
  );
};

// ─── Section (collapsible) ────────────────────────────────────────────────────
const Section = ({ title, icon, badge, borderColor = theme.border, accentColor = theme.indigo500, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: theme.white, borderRadius: theme.radiusMd,
      border: `1.5px solid ${borderColor}`, overflow: 'hidden',
      boxShadow: theme.shadowSm, fontFamily: theme.fontFamily,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = theme.surface}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '9px',
            background: `${accentColor}14`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            border: `1px solid ${accentColor}22`,
          }}>
            {React.cloneElement(icon, { size: 15, color: accentColor })}
          </div>
          <span style={{ fontSize: '13px', fontWeight: '700', color: theme.textPrimary, letterSpacing: '-0.01em' }}>{title}</span>
          {badge !== undefined && (
            <span style={{
              padding: '2px 10px', background: `${accentColor}10`, color: accentColor,
              fontSize: '11px', fontWeight: '700', borderRadius: theme.radiusPill,
              border: `1px solid ${accentColor}28`, letterSpacing: '0.02em',
            }}>
              {badge}
            </span>
          )}
        </div>
        <div style={{
          width: '24px', height: '24px', borderRadius: '6px', background: theme.surfaceAlt,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {open ? <ChevronUp size={13} color={theme.textMuted} /> : <ChevronDown size={13} color={theme.textMuted} />}
        </div>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${borderColor}`, padding: '16px 20px' }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ─── Chip ─────────────────────────────────────────────────────────────────────
const Chip = ({ children, color, bg, border, mono }) => (
  <span style={{
    fontSize: '11px', padding: '3px 9px', borderRadius: '6px',
    background: bg, border: `1px solid ${border}`, color,
    fontFamily: mono ? theme.fontMono : theme.fontFamily,
    lineHeight: '1.5', display: 'inline-block', whiteSpace: 'nowrap',
    fontWeight: mono ? 500 : 600,
  }}>
    {children}
  </span>
);

// ─── Per-Testcase Card ────────────────────────────────────────────────────────
const TestCaseCard = ({ tc }) => {
  const [open, setOpen] = useState(false);
  const cfg = getStatusCfg(tc.status);
  const StatusIcon = cfg.icon;

  const hasMissing   = tc.missing_from_description?.length > 0;
  const hasConflict  = tc.spec_conflict;
  const hasMatched   = tc.matched_desc_ids?.length > 0;
  const hasFound     = !!tc.found_in_description;
  const hasDetails   = hasMissing || hasConflict || hasMatched || hasFound;

  // Override colors if spec conflict
  const borderCol = hasConflict  ? theme.red200   :
                    tc.status === 'covered' ? theme.green200 :
                    tc.status === 'partial' ? theme.amber200 :
                                              theme.red200;
  const bgCol     = hasConflict  ? '#fff5f5'  :
                    tc.status === 'covered' ? '#f6fff9' :
                    tc.status === 'partial' ? '#fffdf0' :
                                              '#fff5f5';

  return (
    <div style={{
      border: `1.5px solid ${borderCol}`, borderRadius: '10px',
      overflow: 'hidden', background: bgCol, marginBottom: '8px',
      fontFamily: theme.fontFamily, boxShadow: theme.shadowSm,
    }}>
      {/* Header row */}
      <div
        onClick={() => hasDetails && setOpen(!open)}
        style={{
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: '10px',
          cursor: hasDetails ? 'pointer' : 'default', flexWrap: 'wrap',
        }}
      >
        <StatusIcon size={16} style={{ color: cfg.color, flexShrink: 0 }} />

        {/* Status badge */}
        <span style={{
          fontSize: '10px', fontWeight: '700', padding: '2px 9px',
          borderRadius: theme.radiusPill,
          background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
          flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {cfg.label}
        </span>

        {/* Spec conflict badge */}
        {hasConflict && (
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '2px 9px',
            borderRadius: theme.radiusPill,
            background: theme.red50, color: theme.red700, border: `1px solid ${theme.red200}`,
            flexShrink: 0,
          }}>
            ⚠ Spec Conflict
          </span>
        )}

        {/* ID chip */}
        <span style={{
          fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '5px',
          background: theme.indigo50, color: theme.indigo500,
          fontFamily: theme.fontMono, flexShrink: 0, border: `1px solid ${theme.indigo100}`,
        }}>
          {tc.id}
        </span>

        {/* Name */}
        <span style={{ fontSize: '13px', fontWeight: '700', color: theme.textPrimary, flex: 1, minWidth: '120px', letterSpacing: '-0.01em' }}>
          {tc.name}
        </span>

        {/* Missing count */}
        {hasMissing && (
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '2px 9px',
            borderRadius: theme.radiusPill,
            background: theme.amber50, color: theme.amber700, border: `1px solid ${theme.amber200}`,
            flexShrink: 0,
          }}>
            {tc.missing_from_description.length} missing
          </span>
        )}

        {hasDetails && (
          <div style={{
            width: '22px', height: '22px', borderRadius: '6px', background: theme.surfaceAlt,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {open ? <ChevronUp size={12} color={theme.textMuted} /> : <ChevronDown size={12} color={theme.textMuted} />}
          </div>
        )}
      </div>

      {/* What it checks — always visible */}
      {tc.what_testcase_checks && (
        <div style={{ padding: '0 14px 10px 40px' }}>
          <p style={{ fontSize: '12px', color: theme.textSecondary, margin: 0, lineHeight: '1.65', fontStyle: 'italic' }}>
            {tc.what_testcase_checks}
          </p>
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '14px', background: theme.white, borderTop: `1px solid ${borderCol}` }}>

          {/* Conflict detail */}
          {hasConflict && tc.conflict_detail && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontSize: '10px', fontWeight: '700', color: theme.red700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                ⚠ Conflict Detail
              </p>
              <p style={{
                fontSize: '12px', color: theme.red600,
                padding: '8px 12px', background: theme.red50,
                borderRadius: '6px', borderLeft: `3px solid ${theme.red200}`,
                margin: 0, lineHeight: '1.55',
              }}>
                {tc.conflict_detail}
              </p>
            </div>
          )}

          {/* Found in description */}
          {hasFound && !hasConflict && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontSize: '10px', fontWeight: '700', color: theme.green700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                ✓ Found In Description
              </p>
              <p style={{
                fontSize: '12px', color: theme.green700,
                padding: '8px 12px', background: theme.green50,
                borderRadius: '6px', borderLeft: `3px solid ${theme.green200}`,
                margin: 0, lineHeight: '1.55',
              }}>
                {tc.found_in_description}
              </p>
            </div>
          )}

          {/* Missing from description */}
          {hasMissing && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ fontSize: '10px', fontWeight: '700', color: theme.amber700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Missing From Description
              </p>
              {tc.missing_from_description.map((item, i) => (
                <p key={i} style={{
                  fontSize: '12px', color: theme.amber700,
                  padding: '6px 10px', background: theme.amber50,
                  borderRadius: '6px', borderLeft: `3px solid ${theme.amber200}`,
                  margin: '0 0 4px', lineHeight: '1.55',
                }}>
                  {item}
                </p>
              ))}
            </div>
          )}

          {/* Matched description IDs */}
          {hasMatched && (
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: theme.textTiny, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ListChecks size={10} /> Matched Requirements
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {tc.matched_desc_ids.map((id, i) => (
                  <Chip key={i} mono color={theme.indigo600} bg={theme.indigo50} border={theme.indigo200}>{id}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Error Boundary ───────────────────────────────────────────────────────────
class QCErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '16px', background: theme.red50, border: `1px solid ${theme.red200}`, borderRadius: '10px', fontFamily: theme.fontFamily }}>
          <p style={{ color: theme.red700, fontWeight: '700', marginBottom: '4px', fontSize: '14px' }}>⚠ Render error</p>
          <p style={{ color: theme.red600, fontSize: '13px', fontFamily: theme.fontMono }}>{String(this.state.error.message)}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main ResultsDisplay ──────────────────────────────────────────────────────
/**
 * Props:
 *   report — raw FastAPI response:
 *   {
 *     meta: { generated_at, project, pipeline },
 *     summary: { total_testcases, total_desc_requirements, covered_in_description,
 *                partial_in_description, not_in_description, spec_conflicts,
 *                coverage_percent, quality_score, verdict },
 *     per_testcase: [ { id, name, status, spec_conflict, conflict_detail,
 *                       what_testcase_checks, found_in_description,
 *                       missing_from_description[], matched_desc_ids[] } ],
 *     spec_conflicts: [ { id, name, conflict_detail, what_testcase_checks } ],
 *     not_in_description: [ { id, name, what_testcase_checks, reason } ]
 *   }
 */
const ResultsDisplay = ({ report }) => {
  if (!report) return null;

  const { meta = {}, summary = {}, per_testcase = [], spec_conflicts = [], not_in_description = [] } = report;

  const verdict     = summary.verdict      || 'FAIL';
  const qualScore   = Math.round(summary.quality_score    || 0);
  const coverage    = Math.round(summary.coverage_percent || 0);
  const vcfg        = getVerdictCfg(verdict);
  const VerdictIcon = vcfg.icon;
  const isPass      = verdict === 'PASS';

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qc-report-${Date.now()}.json`;
    a.click();
  };

  return (
    <QCErrorBoundary>
      <div style={{
        width: '100%', display: 'flex', flexDirection: 'column', gap: '14px',
        fontFamily: theme.fontFamily,
        background: theme.surface, padding: '20px', borderRadius: '20px',
      }}>

        {/* ── Hero card ───────────────────────────────────────────────────── */}
        <div style={{
          background: theme.white, borderRadius: theme.radiusLg,
          border: `1.5px solid ${vcfg.border}`, boxShadow: theme.shadowHero, overflow: 'hidden',
        }}>
          {/* Header bar */}
          <div style={{
            background: vcfg.bg, padding: '16px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: '12px',
            borderBottom: `1px solid ${vcfg.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px',
                background: `${vcfg.color}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1.5px solid ${vcfg.color}28`,
              }}>
                <VerdictIcon size={22} style={{ color: vcfg.color }} />
              </div>
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: '800', color: vcfg.color, margin: 0, letterSpacing: '-0.03em' }}>
                  {verdict}
                </h2>
                <p style={{ fontSize: '12px', color: theme.textMuted, margin: '2px 0 0', letterSpacing: '0.01em' }}>
                  {meta.project || '—'} · {meta.pipeline || '—'} · {meta.generated_at ? new Date(meta.generated_at).toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>

            <button
              onClick={downloadReport}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 18px',
                background: theme.indigo600, color: '#fff',
                border: 'none', borderRadius: theme.radiusSm, cursor: 'pointer',
                fontSize: '12px', fontWeight: '700', fontFamily: theme.fontFamily,
                letterSpacing: '0.02em', boxShadow: `0 2px 8px ${theme.indigo500}40`,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.indigo700}
              onMouseLeave={e => e.currentTarget.style.background = theme.indigo600}
            >
              <Download size={13} /> Export JSON
            </button>
          </div>

          {/* Score + stats body */}
          <div style={{ padding: '28px', display: 'flex', gap: '32px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <AIScoreRing score={qualScore} />
            </div>

            <div style={{ flex: 1, minWidth: '200px', paddingTop: '6px' }}>
              {/* Stats grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                gap: '10px', marginBottom: '20px',
              }}>
                {[
                  { v: summary.total_testcases,         label: 'Testcases',    color: theme.textPrimary },
                  { v: summary.total_desc_requirements,  label: 'Requirements', color: theme.textPrimary },
                  { v: summary.covered_in_description,   label: 'Covered',      color: theme.green600 },
                  { v: summary.partial_in_description,   label: 'Partial',      color: theme.amber600 },
                  { v: summary.not_in_description,       label: 'Missing',      color: theme.red600 },
                  { v: summary.spec_conflicts,           label: 'Conflicts',    color: theme.red700 },
                ].map((stat, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    background: theme.surface,
                    borderRadius: theme.radiusSm,
                    border: `1px solid ${theme.border}`,
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: stat.color, lineHeight: 1, letterSpacing: '-0.03em' }}>
                      {stat.v ?? '—'}
                    </div>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: theme.textTiny, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: '3px' }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Coverage bar */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: theme.textSecondary }}>Coverage</span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: vcfg.color }}>{coverage}%</span>
                </div>
                <div style={{ height: '8px', background: theme.surfaceAlt, borderRadius: theme.radiusPill, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                  <div style={{
                    height: '100%', borderRadius: theme.radiusPill,
                    width: `${coverage}%`,
                    background: isPass
                      ? `linear-gradient(90deg, ${theme.green600}, #22c55e)`
                      : `linear-gradient(90deg, ${vcfg.color}, ${theme.indigo400})`,
                    transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                </div>
              </div>

              {/* Publish status */}
              {isPass ? (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '7px',
                  padding: '7px 14px', borderRadius: theme.radiusSm,
                  background: theme.green50, border: `1px solid ${theme.green200}`,
                  fontSize: '13px', fontWeight: '700', color: theme.green700,
                }}>
                  ✅ All testcases covered by description
                </div>
              ) : (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '7px',
                  padding: '7px 14px', borderRadius: theme.radiusSm,
                  background: theme.red50, border: `1px solid ${theme.red200}`,
                  fontSize: '13px', fontWeight: '700', color: theme.red700,
                }}>
                  🚫 Fix missing requirements before publishing
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Spec Conflicts ───────────────────────────────────────────────── */}
        {spec_conflicts.length > 0 && (
          <Section
            title="Spec Conflicts"
            icon={<XCircle />}
            badge={spec_conflicts.length}
            borderColor={theme.red200}
            accentColor={theme.red600}
            defaultOpen={true}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {spec_conflicts.map((c, i) => (
                <div key={i} style={{
                  padding: '12px 14px',
                  background: theme.red50, border: `1px solid ${theme.red200}`,
                  borderRadius: theme.radiusSm, borderLeft: `3px solid ${theme.red600}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '5px',
                      background: '#fff', color: theme.red600, border: `1px solid ${theme.red200}`,
                      fontFamily: theme.fontMono,
                    }}>
                      {c.id}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: theme.red700 }}>{c.name}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: theme.red600, margin: '0 0 4px', lineHeight: '1.55' }}>
                    <strong>Conflict:</strong> {c.conflict_detail}
                  </p>
                  <p style={{ fontSize: '11px', color: theme.textMuted, margin: 0, fontStyle: 'italic' }}>
                    Checks: {c.what_testcase_checks}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Not In Description ───────────────────────────────────────────── */}
        {not_in_description.length > 0 && (
          <Section
            title="Not In Description"
            icon={<AlertTriangle />}
            badge={not_in_description.length}
            borderColor={theme.indigo200}
            accentColor={theme.indigo500}
            defaultOpen={true}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              {not_in_description.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                  padding: '10px 14px',
                  background: theme.indigo50, border: `1px solid ${theme.indigo200}`,
                  borderRadius: theme.radiusSm, borderLeft: `3px solid ${theme.indigo500}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '5px',
                        background: '#fff', color: theme.indigo600, border: `1px solid ${theme.indigo200}`,
                        fontFamily: theme.fontMono,
                      }}>
                        {item.id}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: theme.indigo700 }}>{item.name}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: theme.indigo600, margin: 0, lineHeight: '1.55' }}>
                      {item.what_testcase_checks}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Per Testcase Coverage ────────────────────────────────────────── */}
        {per_testcase.length > 0 && (
          <Section
            title="Per-Testcase Coverage"
            icon={<CheckSquare />}
            badge={`${summary.covered_in_description ?? 0} / ${summary.total_testcases ?? per_testcase.length} covered`}
            borderColor={summary.covered_in_description < summary.total_testcases ? theme.amber200 : theme.green200}
            accentColor={summary.covered_in_description < summary.total_testcases ? theme.amber600 : theme.green600}
            defaultOpen={true}
          >
            {/* Summary bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0',
              padding: '16px 20px', marginBottom: '16px',
              background: theme.surface, borderRadius: theme.radiusMd,
              border: `1px solid ${theme.border}`, boxShadow: theme.shadowSm,
            }}>
              {[
                { v: summary.total_testcases,        label: 'Total',    color: theme.textPrimary },
                { v: summary.covered_in_description, label: 'Covered',  color: theme.green600 },
                { v: summary.partial_in_description, label: 'Partial',  color: theme.amber600 },
                { v: summary.not_in_description,     label: 'Missing',  color: theme.red600 },
              ].map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div style={{ width: '1px', height: '40px', background: theme.border, margin: '0 20px' }} />}
                  <div style={{ textAlign: 'center', minWidth: '56px' }}>
                    <div style={{ fontSize: '28px', fontWeight: '900', color: s.color, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.v ?? 0}</div>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: theme.textTiny, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: '2px' }}>{s.label}</div>
                  </div>
                </React.Fragment>
              ))}
              <div style={{ flex: 1, marginLeft: '24px' }}>
                <div style={{ height: '7px', background: theme.surfaceAlt, borderRadius: theme.radiusPill, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                  <div style={{
                    height: '100%', borderRadius: theme.radiusPill,
                    width: `${summary.total_testcases > 0 ? (summary.covered_in_description / summary.total_testcases) * 100 : 0}%`,
                    background: `linear-gradient(90deg, ${theme.indigo500}, ${theme.indigo400})`,
                    transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                </div>
                <p style={{ fontSize: '11px', color: theme.textTiny, margin: '5px 0 0', textAlign: 'right', fontWeight: '600', letterSpacing: '0.02em' }}>
                  {coverage}% coverage
                </p>
              </div>
            </div>

            {per_testcase.map((tc, i) => (
              <TestCaseCard key={tc.id || i} tc={tc} />
            ))}
          </Section>
        )}

      </div>
    </QCErrorBoundary>
  );
};

export default ResultsDisplay;
