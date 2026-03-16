import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { File, FileCode, FileCheck, FolderOpen, Eye, Code } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * ZipFileExplorer — shows only Puppeteer test files.
 * Solution files are no longer part of the QC workflow.
 *
 * Test files: any .js file whose path/name includes "test", "spec", or "puppeteer"
 */
const ZipFileExplorer = ({ zipFile, onFilesSelect, projectType = 'html' }) => {
  const [files,         setFiles]         = useState([]);
  const [selectedFiles, setSelectedFiles] = useState({ testCases: [] });
  const [previewFile,   setPreviewFile]   = useState(null);
  const [loading,       setLoading]       = useState(false);

  useEffect(() => {
    if (zipFile) extractZipContents();
  }, [zipFile]);

  // Notify parent whenever selection changes (only testCases)
  useEffect(() => {
    const selectedTestFiles = files.filter(
      f => selectedFiles.testCases.includes(f.path) && f.type === 'test'
    );
    onFilesSelect({ testCases: selectedTestFiles, solutions: [] });
  }, [selectedFiles, files]);

  // ── ZIP extraction ─────────────────────────────────────────────────────────
  const extractZipContents = async () => {
    setLoading(true);
    try {
      const zip      = new JSZip();
      const contents = await zip.loadAsync(zipFile);
      const extracted = [];

      for (const [filename, file] of Object.entries(contents.files)) {
        if (file.dir) continue;
        if (!isCodeFile(filename)) continue;

        const content  = await file.async('text');
        const fileType = categorizeFile(filename);
        if (fileType !== 'test') continue; // only keep test files

        extracted.push({
          name:     filename,
          path:     filename,
          content,
          type:     fileType,
          size:     content.length,
          language: 'javascript'
        });
      }

      setFiles(extracted);
      setSelectedFiles({
        testCases: extracted.map(f => f.path),
      });
    } catch (err) {
      console.error('ZIP extraction error:', err);
    } finally {
      setLoading(false);
    }
  };

  const isCodeFile = (filename) => {
    return filename.toLowerCase().endsWith('.js');
  };

  const categorizeFile = (filename) => {
    const norm = filename.replace(/\\/g, '/').toLowerCase();

    const excludePatterns = [
      /\/node_modules\//,
      /\/dist\//,
      /\/build\//,
      /\/\.git\//,
      /\.config\.js$/,
      /webpack/,
      /babel\.config/,
      /jest\.config/,
    ];
    if (excludePatterns.some(p => p.test(norm))) return 'excluded';

    if (
      /puppeteer/i.test(norm) ||
      /\/tests?\//i.test(norm) ||
      /\.test\.js$/i.test(norm) ||
      /\.spec\.js$/i.test(norm) ||
      /test\.js$/i.test(norm)
    ) {
      return 'test';
    }

    return 'excluded';
  };

  const toggleFileSelection = (filePath) => {
    setSelectedFiles(prev => {
      const isSelected = prev.testCases.includes(filePath);
      return {
        testCases: isSelected
          ? prev.testCases.filter(p => p !== filePath)
          : [...prev.testCases, filePath]
      };
    });
  };

  const isFileSelected = (file) => selectedFiles.testCases.includes(file.path);

  const getDisplayName = (fullPath) => {
    const parts = fullPath.split('/');
    return parts.length > 2 ? parts.slice(1).join('/') : fullPath;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', padding: '24px', gap: '12px' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid #f97316', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#6b7280', fontSize: '14px' }}>Extracting ZIP contents...</span>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (files.length === 0 && !loading) return (
    <div style={{
      padding: '16px', background: '#fef3c7', border: '1px dashed #f59e0b',
      borderRadius: '8px', fontSize: '13px', color: '#92400e'
    }}>
      ⚠️ No Puppeteer test files found in ZIP. Make sure the ZIP contains a <code>.js</code> test file with "test", "spec", or "puppeteer" in its name or path.
    </div>
  );

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{
        background: 'white', borderRadius: '10px',
        border: '1px solid #e5e7eb', padding: '16px'
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <FolderOpen size={16} color="#6b7280" />
          <span style={{ fontWeight: '700', fontSize: '14px', color: '#111827' }}>
            Puppeteer Test Files
          </span>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            ({selectedFiles.testCases.length}/{files.length} selected)
          </span>
        </div>

        {/* Test file list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {files.map(file => (
            <div
              key={file.path}
              onClick={() => toggleFileSelection(file.path)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                border: `1.5px solid ${isFileSelected(file) ? '#86efac' : '#e5e7eb'}`,
                background: isFileSelected(file) ? '#f0fdf4' : '#fafafa',
                transition: 'all 0.15s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={isFileSelected(file)}
                  onChange={() => {}}
                  style={{ width: '15px', height: '15px', flexShrink: 0 }}
                />
                <FileCheck size={16} color="#16a34a" style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name.split('/').pop()}
                  </p>
                  <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getDisplayName(file.path)}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{
                  fontSize: '10px', padding: '2px 7px', borderRadius: '20px',
                  background: '#dcfce7', color: '#15803d', fontWeight: '700'
                }}>
                  Puppeteer Test
                </span>
                <button
                  onClick={e => { e.stopPropagation(); setPreviewFile(file); }}
                  style={{ padding: '4px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', borderRadius: '4px' }}
                  title="Preview"
                >
                  <Eye size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: '10px', fontSize: '11px', color: '#9ca3af' }}>
          💡 Only Puppeteer <code>.js</code> test files are needed — no solution files required.
        </p>
      </div>

      {/* ── File Preview Modal ──────────────────────────────────────────────── */}
      {previewFile && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: 'white', borderRadius: '12px',
            maxWidth: '900px', width: '100%', maxHeight: '80vh',
            overflow: 'hidden', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{
              padding: '14px 16px', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code size={16} color="#6b7280" />
                <span style={{ fontWeight: '700', fontSize: '14px' }}>
                  {previewFile.name.split('/').pop()}
                </span>
                <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '20px', background: '#dcfce7', color: '#15803d', fontWeight: '700' }}>
                  Puppeteer Test
                </span>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#9ca3af' }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <CodeMirror
                value={previewFile.content}
                height="100%"
                theme={oneDark}
                extensions={[javascript({ jsx: true })]}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
              />
            </div>
            <div style={{
              padding: '10px 16px', borderTop: '1px solid #e5e7eb',
              background: '#f9fafb', fontSize: '12px', color: '#6b7280',
              display: 'flex', justifyContent: 'space-between'
            }}>
              <span>{previewFile.content.split('\n').length} lines</span>
              <span>{(previewFile.size / 1024).toFixed(1)} KB</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZipFileExplorer;