import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, AlertCircle, CheckCircle, User, Mail } from 'lucide-react';
import * as XLSX from 'xlsx';
import { searchQuestionBanks, questionsInBank, questionConfig } from '../services/api';

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
  radius:       '12px',
  radiusSm:     '8px',
  shadow:       '0 2px 12px rgba(90,79,207,0.07)',
};

export default function TestcaseExcelGenerator() {
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [tab,   setTab]   = useState('platform'); // 'platform' | 'json'
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── QB search state ──────────────────────────────────────────────────────
  const [token,            setToken]            = useState(() => localStorage.getItem('examly_token') || '');
  const [tokenOpen,        setTokenOpen]        = useState(false);
  const [searchTerm,       setSearchTerm]       = useState('');
  const [searching,        setSearching]        = useState(false);
  const [banks,            setBanks]            = useState([]);
  const [searchError,      setSearchError]      = useState('');
  const [selectedBank,     setSelectedBank]     = useState(null);
  const [questions,        setQuestions]        = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionsError,   setQuestionsError]   = useState('');
  const [checkedIds,       setCheckedIds]       = useState(new Set());

  // ── Fetched question configs ─────────────────────────────────────────────
  const [fetching,       setFetching]       = useState(false);
  const [fetchedResults, setFetchedResults] = useState([]); // [{name, question_id, testcases:[{name,weightage,evaluation_type}]}]
  const [fetchErrors,    setFetchErrors]    = useState([]); // [{name, error}]

  // ── JSON input (manual tab) ──────────────────────────────────────────────
  const [jsonInput,  setJsonInput]  = useState('');
  const [jsonTcName, setJsonTcName] = useState('');
  const [jsonPreview, setJsonPreview] = useState([]);
  const [jsonError,  setJsonError]  = useState('');

  const tokenRef = useRef(null);

  useEffect(() => {
    if (!tokenOpen) return;
    const handler = (e) => { if (tokenRef.current && !tokenRef.current.contains(e.target)) setTokenOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tokenOpen]);

  // ── QB search ────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!token.trim()) { setSearchError('Set your JWT token first (click 🔑 Token).'); setTokenOpen(true); return; }
    if (!searchTerm.trim()) { setSearchError('Enter a search term.'); return; }
    setSearching(true); setBanks([]); setSelectedBank(null); setQuestions([]);
    setCheckedIds(new Set()); setSearchError(''); setFetchedResults([]); setFetchErrors([]);
    try {
      const res = await searchQuestionBanks(searchTerm.trim(), token.trim());
      if (res.error) setSearchError(res.error);
      else setBanks(res.questionbanks || []);
    } catch (e) { setSearchError(`Search failed: ${e.message}`); }
    setSearching(false);
  };

  const handleSelectBank = async (bank) => {
    setSelectedBank(bank); setQuestions([]); setCheckedIds(new Set());
    setQuestionsError(''); setFetchedResults([]); setFetchErrors([]);
    setLoadingQuestions(true);
    try {
      const res = await questionsInBank(bank.qb_id, token.trim());
      if (res.error) setQuestionsError(res.error);
      else setQuestions(res.questions || []);
    } catch (e) { setQuestionsError(`Failed: ${e.message}`); }
    setLoadingQuestions(false);
  };

  const toggleCheck = (qId) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId); else next.add(qId);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedIds.size === questions.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(questions.map(q => q.question_id)));
  };

  // ── Fetch configs for selected questions ─────────────────────────────────
  const handleFetchConfigs = async () => {
    if (checkedIds.size === 0) { setError('Select at least one question.'); return; }
    setFetching(true); setFetchedResults([]); setFetchErrors([]); setError(''); setSuccess('');

    const selected = questions.filter(q => checkedIds.has(q.question_id));
    const results = [];
    const errors  = [];

    for (const q of selected) {
      try {
        const res = await questionConfig(q.question_id, token.trim());
        if (res.error) {
          errors.push({ name: q.question_name, error: res.error });
        } else {
          const config = res.config || [];
          // Flatten all testcases across all config blocks
          const testcases = config.flatMap(block =>
            (block.testcases || []).map(tc => ({
              name:            tc.name,
              weightage:       tc.weightage,
              evaluation_type: block.evaluation_type || block.evaluationType || 'Puppeteer',
            }))
          );
          results.push({ name: q.question_name, question_id: q.question_id, testcases });
        }
      } catch (e) {
        errors.push({ name: q.question_name, error: e.message });
      }
    }

    setFetchedResults(results);
    setFetchErrors(errors);
    if (results.length > 0) setSuccess(`Fetched ${results.length} question(s) — ${results.reduce((s, r) => s + r.testcases.length, 0)} testcases total`);
    setFetching(false);
  };

  // ── JSON parse ───────────────────────────────────────────────────────────
  const parseJson = (text) => {
    setJsonError(''); setJsonPreview([]);
    if (!text.trim()) return;
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) { setJsonError('JSON must be an array'); return; }
      const tcs = data.flatMap(block => {
        const et = block.evaluationType || block.evaluation_type || '';
        return (block.testcases || [])
          .filter(tc => tc.name && tc.weightage !== undefined)
          .map(tc => ({ name: tc.name, weightage: tc.weightage, evaluation_type: et }));
      });
      if (!tcs.length) { setJsonError('No valid testcases found'); return; }
      setJsonPreview(tcs);
    } catch (e) { setJsonError(`Invalid JSON: ${e.message}`); }
  };

  // ── Excel generation ─────────────────────────────────────────────────────
  const generateExcel = () => {
    if (!name.trim())  { setError('Enter your Name'); return; }
    if (!email.trim()) { setError('Enter your Email'); return; }

    const HEADERS = ['Name', 'Email', 'Question Name', 'Testcase Name', 'Weightage', 'Marks', 'TC Status', 'Evaluation Type'];
    const COL_WIDTHS = [{ wch: 20 }, { wch: 30 }, { wch: 35 }, { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];

    try {
      const wb = XLSX.utils.book_new();

      if (tab === 'platform') {
        if (!fetchedResults.length) { setError('Fetch testcases from the platform first.'); return; }
        fetchedResults.forEach(q => {
          const rows = [HEADERS, ...q.testcases.map(tc => [name, email, q.name, tc.name, tc.weightage, tc.weightage, 'Passed', tc.evaluation_type])];
          const ws = XLSX.utils.aoa_to_sheet(rows);
          ws['!cols'] = COL_WIDTHS;
          // Sheet name: first 31 chars, strip invalid chars
          const sheetName = q.name.replace(/[\\/:*?[\]]/g, '').slice(0, 31) || q.question_id.slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });
      } else {
        if (!jsonPreview.length) { setError('Parse valid JSON first.'); return; }
        if (!jsonTcName.trim())  { setError('Enter a Question Name.'); return; }
        const rows = [HEADERS, ...jsonPreview.map(tc => [name, email, jsonTcName, tc.name, tc.weightage, tc.weightage, 'Passed', tc.evaluation_type])];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = COL_WIDTHS;
        XLSX.utils.book_append_sheet(wb, ws, jsonTcName.slice(0, 31) || 'Testcases');
      }

      XLSX.writeFile(wb, 'testcases.xlsx');
      setSuccess('Excel downloaded!');
    } catch (e) { setError(`Excel error: ${e.message}`); }
  };

  const canDownload = tab === 'platform' ? fetchedResults.length > 0 : jsonPreview.length > 0;
  const checkedCount = checkedIds.size;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: '32px 28px 60px', fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── Title ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: T.indigoLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileSpreadsheet size={20} color={T.indigo} />
          </div>
          <div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: '22px', fontWeight: '800', color: T.textPrimary, margin: 0, letterSpacing: '-0.03em' }}>Testcase Excel Generator</h1>
            <p style={{ fontSize: '12px', color: T.textMuted, margin: '2px 0 0' }}>Select questions from the platform — one Excel sheet per question</p>
          </div>
        </div>

        {/* ── User Info ── */}
        <div style={{ background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}`, padding: '20px', boxShadow: T.shadow }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '14px' }}>User Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: T.textSecondary, marginBottom: '6px' }}><User size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Enter your name"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, fontSize: '13px', outline: 'none', fontFamily: 'inherit', background: T.bg, color: T.textPrimary }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: T.textSecondary, marginBottom: '6px' }}><Mail size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, fontSize: '13px', outline: 'none', fontFamily: 'inherit', background: T.bg, color: T.textPrimary }} />
            </div>
          </div>
        </div>

        {/* ── Tab switcher ── */}
        <div style={{ display: 'flex', gap: '4px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: '10px', padding: '4px', alignSelf: 'flex-start' }}>
          {[['platform', '🔗 Platform Import'], ['json', '📋 JSON Input']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '8px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit',
              background: tab === k ? `linear-gradient(135deg, ${T.indigo}, ${T.indigoMid})` : 'transparent',
              color: tab === k ? '#fff' : T.textSecondary,
              boxShadow: tab === k ? '0 2px 8px rgba(90,79,207,0.25)' : 'none',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>

        {/* ══ PLATFORM TAB ══════════════════════════════════════════════════ */}
        {tab === 'platform' && (
          <div style={{ background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}`, padding: '20px', boxShadow: T.shadow, display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Search row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="text" placeholder="Search question bank…" value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                style={{ flex: 1, padding: '8px 12px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, fontSize: '13px', outline: 'none', fontFamily: 'inherit', background: T.bg, color: T.textPrimary }} />
              <button onClick={handleSearch} disabled={searching}
                style={{ padding: '8px 16px', borderRadius: T.radiusSm, border: 'none', background: searching ? '#D1D5DB' : `linear-gradient(135deg,${T.indigo},${T.indigoMid})`, color: '#fff', cursor: searching ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                {searching ? <span style={{ display:'inline-block',width:'11px',height:'11px',border:'2px solid rgba(255,255,255,0.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite' }} /> : '🔍 Search'}
              </button>
              {/* Token button */}
              <div ref={tokenRef} style={{ position: 'relative' }}>
                <button onClick={() => setTokenOpen(v => !v)}
                  style={{ padding: '8px 13px', borderRadius: T.radiusSm, border: `1px solid ${tokenOpen ? T.borderHover : T.border}`, background: tokenOpen ? T.indigoLight : T.surface, color: tokenOpen ? T.indigo : T.textSecondary, cursor: 'pointer', fontSize: '12px', fontWeight: '700', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  🔑 Token <span style={{ fontSize: '10px' }}>{tokenOpen ? '▲' : '▼'}</span>
                </button>
                {tokenOpen && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200, width: '300px', background: T.surface, border: `1px solid ${T.borderHover}`, borderRadius: T.radiusSm, boxShadow: '0 4px 24px rgba(90,79,207,0.10)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>JWT Token</label>
                    <textarea rows={3} placeholder="eyJhbGci…" value={token} onChange={e => setToken(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bg, fontSize: '11px', fontFamily: 'monospace', outline: 'none', resize: 'vertical', color: T.textPrimary }} />
                    <button onClick={() => { localStorage.setItem('examly_token', token.trim()); setTokenOpen(false); }}
                      style={{ alignSelf: 'flex-end', padding: '7px 18px', borderRadius: T.radiusSm, border: 'none', background: `linear-gradient(135deg,${T.indigo},${T.indigoMid})`, color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: '700', fontFamily: 'inherit' }}>
                      💾 Save Token
                    </button>
                  </div>
                )}
              </div>
            </div>

            {searchError && <p style={{ margin: 0, fontSize: '12px', color: T.error }}>⚠ {searchError}</p>}

            {/* Banks list */}
            {banks.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '600', color: T.textMuted, marginBottom: '6px' }}>{banks.length} bank(s) — click to load questions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                  {banks.map(bank => {
                    const sel = selectedBank?.qb_id === bank.qb_id;
                    return (
                      <div key={bank.qb_id} onClick={() => handleSelectBank(bank)}
                        style={{ padding: '9px 12px', borderRadius: T.radiusSm, cursor: 'pointer', background: sel ? T.indigoLight : T.bg, border: `1px solid ${sel ? T.borderHover : T.border}`, transition: 'all 0.12s' }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: sel ? T.indigo : T.textPrimary }}>{bank.qb_name}</div>
                        <div style={{ fontSize: '11px', color: T.textMuted, marginTop: '2px', fontFamily: 'monospace' }}>{bank.questionCount ?? '?'} questions</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Questions with checkboxes */}
            {selectedBank && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Questions in <span style={{ color: T.indigo, textTransform: 'none' }}>{selectedBank.qb_name}</span>
                    {checkedCount > 0 && <span style={{ marginLeft: 6, color: T.indigo }}>· {checkedCount} selected</span>}
                  </div>
                  {questions.length > 0 && (
                    <button onClick={toggleAll}
                      style={{ fontSize: '11px', fontWeight: '700', color: T.indigo, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', fontFamily: 'inherit' }}>
                      {checkedIds.size === questions.length ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                {loadingQuestions && <div style={{ fontSize: '12px', color: T.textMuted, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ display:'inline-block',width:'12px',height:'12px',border:`2px solid ${T.border}`,borderTopColor:T.indigo,borderRadius:'50%',animation:'spin 0.8s linear infinite' }} /> Loading…</div>}
                {questionsError && <p style={{ margin: 0, fontSize: '12px', color: T.error }}>⚠ {questionsError}</p>}

                {!loadingQuestions && questions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflowY: 'auto' }}>
                    {questions.map((q, i) => {
                      const qId   = q.question_id || q.id || '';
                      const qName = q.question_name || q.name || `Question ${i + 1}`;
                      const checked = checkedIds.has(qId);
                      return (
                        <div key={qId || i} onClick={() => toggleCheck(qId)}
                          style={{ padding: '9px 12px', borderRadius: T.radiusSm, cursor: 'pointer', background: checked ? T.indigoLight : T.bg, border: `1px solid ${checked ? T.borderHover : T.border}`, transition: 'all 0.12s', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: `2px solid ${checked ? T.indigo : '#D1D5DB'}`, background: checked ? T.indigo : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s' }}>
                            {checked && <span style={{ color: '#fff', fontSize: '10px', fontWeight: '900', lineHeight: 1 }}>✓</span>}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: checked ? T.indigo : T.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{qName}</div>
                            <div style={{ fontSize: '10px', color: T.textMuted, marginTop: '1px', fontFamily: 'monospace' }}>{qId}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Fetch button */}
                {checkedCount > 0 && (
                  <button onClick={handleFetchConfigs} disabled={fetching}
                    style={{ marginTop: '12px', width: '100%', padding: '11px', borderRadius: T.radiusSm, border: 'none', background: fetching ? '#D1D5DB' : `linear-gradient(135deg,${T.indigo},${T.indigoMid})`, color: '#fff', cursor: fetching ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    {fetching
                      ? <><span style={{ display:'inline-block',width:'13px',height:'13px',border:'2px solid rgba(255,255,255,0.4)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite' }} /> Fetching {checkedCount} question(s)…</>
                      : <>⚡ Fetch Testcases for {checkedCount} Question{checkedCount !== 1 ? 's' : ''}</>}
                  </button>
                )}
              </div>
            )}

            {/* Fetch errors */}
            {fetchErrors.length > 0 && (
              <div style={{ background: T.errorLight, border: `1px solid ${T.errorBorder}`, borderRadius: T.radiusSm, padding: '10px 14px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#991B1B', marginBottom: '4px' }}>Failed to fetch {fetchErrors.length} question(s):</div>
                {fetchErrors.map((e, i) => <div key={i} style={{ fontSize: '11px', color: '#B91C1C' }}>• {e.name}: {e.error}</div>)}
              </div>
            )}

            {/* Fetched results preview */}
            {fetchedResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Preview — {fetchedResults.length} Sheet{fetchedResults.length !== 1 ? 's' : ''}
                </div>
                {fetchedResults.map((q, qi) => (
                  <div key={qi} style={{ border: `1px solid ${T.borderHover}`, borderRadius: T.radiusSm, overflow: 'hidden' }}>
                    <div style={{ background: T.indigoLight, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: T.indigo }}>📄 {q.name}</span>
                      <span style={{ fontSize: '11px', color: T.textMuted }}>{q.testcases.length} testcases</span>
                    </div>
                    <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#F8F7FF' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '600', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>#</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '600', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>Testcase Name</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>Weight</th>
                            <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: '600', color: T.textSecondary, borderBottom: `1px solid ${T.border}` }}>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {q.testcases.map((tc, ti) => (
                            <tr key={ti} style={{ borderBottom: `1px solid ${T.border}` }}>
                              <td style={{ padding: '5px 10px', color: T.textMuted }}>{ti + 1}</td>
                              <td style={{ padding: '5px 10px', color: T.textPrimary }}>{tc.name}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: T.textPrimary }}>{tc.weightage}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                <span style={{ padding: '2px 8px', background: T.indigoLight, color: T.indigo, borderRadius: '999px', fontSize: '10px', fontWeight: '600' }}>{tc.evaluation_type}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ JSON TAB ═══════════════════════════════════════════════════════ */}
        {tab === 'json' && (
          <div style={{ background: T.surface, borderRadius: T.radius, border: `1px solid ${T.border}`, padding: '20px', boxShadow: T.shadow, display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: T.textSecondary, marginBottom: '6px' }}>Question Name *</label>
              <input type="text" value={jsonTcName} onChange={e => setJsonTcName(e.target.value)} placeholder="Enter question name"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: T.radiusSm, border: `1px solid ${T.border}`, fontSize: '13px', outline: 'none', fontFamily: 'inherit', background: T.bg, color: T.textPrimary }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: T.textSecondary }}>JSON Input</label>
                  <button onClick={() => { const s = '[{"evaluation_type":"Puppeteer","testcases":[{"name":"verify_heading_content","weightage":0.1},{"name":"verify_button_text","weightage":0.15}]}]'; setJsonInput(s); parseJson(s); }}
                    style={{ fontSize: '11px', color: T.indigo, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '600' }}>Load Sample</button>
                </div>
                <textarea value={jsonInput} onChange={e => { setJsonInput(e.target.value); parseJson(e.target.value); }} placeholder='[{"evaluation_type": "Puppeteer", "testcases": [...]}]'
                  style={{ width: '100%', boxSizing: 'border-box', height: '280px', padding: '12px', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, fontFamily: 'monospace', fontSize: '12px', outline: 'none', resize: 'vertical', background: T.bg, color: T.textPrimary }} />
                {jsonError && <p style={{ margin: '6px 0 0', fontSize: '11px', color: T.error }}>{jsonError}</p>}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: T.textSecondary, marginBottom: '6px' }}>Preview ({jsonPreview.length} testcases)</label>
                <div style={{ height: '280px', border: `1px solid ${T.border}`, borderRadius: T.radiusSm, overflowY: 'auto', background: '#FAFAF8' }}>
                  {jsonPreview.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead><tr style={{ background: T.indigoLight, position: 'sticky', top: 0 }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: '600', color: T.indigo }}>#</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: '600', color: T.indigo }}>Testcase</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: '600', color: T.indigo }}>Weight</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: '600', color: T.indigo }}>Type</th>
                      </tr></thead>
                      <tbody>{jsonPreview.map((tc, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: '5px 8px', color: T.textMuted }}>{i + 1}</td>
                          <td style={{ padding: '5px 8px', color: T.textPrimary }}>{tc.name}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>{tc.weightage}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}><span style={{ padding: '1px 7px', background: T.indigoLight, color: T.indigo, borderRadius: '999px', fontSize: '10px', fontWeight: '600' }}>{tc.evaluation_type}</span></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, fontSize: '12px' }}>No testcases to preview</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Download button ── */}
        <button onClick={generateExcel} disabled={!canDownload}
          style={{ padding: '13px 24px', borderRadius: T.radius, border: 'none', background: canDownload ? `linear-gradient(135deg,${T.indigo},${T.indigoMid})` : '#D1D5DB', color: '#fff', cursor: canDownload ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: '700', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: canDownload ? '0 4px 14px rgba(90,79,207,0.22)' : 'none', transition: 'all 0.15s' }}>
          <Download size={16} />
          {tab === 'platform' && fetchedResults.length > 0
            ? `Download Excel — ${fetchedResults.length} Sheet${fetchedResults.length !== 1 ? 's' : ''}`
            : 'Download Excel'}
        </button>

        {/* ── Messages ── */}
        {error && (
          <div style={{ padding: '12px 16px', background: T.errorLight, border: `1px solid ${T.errorBorder}`, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircle size={15} color={T.error} />
            <span style={{ fontSize: '13px', color: '#B91C1C' }}>{error}</span>
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#F87171', fontSize: '18px', lineHeight: 1 }}>×</button>
          </div>
        )}
        {success && (
          <div style={{ padding: '12px 16px', background: T.successLight, border: `1px solid ${T.successBorder}`, borderRadius: T.radiusSm, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckCircle size={15} color={T.success} />
            <span style={{ fontSize: '13px', color: '#065F46' }}>{success}</span>
          </div>
        )}
      </div>
    </div>
  );
}
