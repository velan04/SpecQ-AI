// src/components/FileUpload.jsx
import React, { useRef, useState } from 'react';
import { Upload, File, X } from 'lucide-react';

const T = {
  bg:           '#FAFAF8',
  surface:      '#FFFFFF',
  border:       '#EAEAEA',
  borderFocus:  '#C7C3F4',
  indigo:       '#5A4FCF',
  indigoLight:  '#F0EFFF',
  indigoMid:    '#7C75E0',
  success:      '#10B981',
  successLight: '#ECFDF5',
  successBorder:'#6EE7B7',
  error:        '#EF4444',
  errorLight:   '#FEF2F2',
  errorBorder:  '#FCA5A5',
  textPrimary:  '#1A1A2E',
  textSecondary:'#6B7280',
  textMuted:    '#A3A3B3',
  radius:       '12px',
  radiusSm:     '8px',
};

/**
 * FileUpload — generic drag-and-drop file upload zone.
 *
 * Props:
 *   onFileSelect  (File | null) => void
 *   selectedFile  File | null
 *   accept        string  e.g. ".js" | ".txt" | ".zip"   (default ".zip")
 *   label         string  label shown above zone          (default "Upload ZIP File")
 *   hint          string  format hint below zone          (default ".zip only · max 50 MB")
 */
const FileUpload = ({
  onFileSelect,
  selectedFile,
  accept = '.zip',
  label  = 'Upload ZIP File',
  hint   = '.zip only · max 50 MB',
}) => {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const isValidFile = (file) => {
    if (!accept) return true;
    const exts = accept.split(',').map(e => e.trim().toLowerCase());
    return exts.some(ext => file.name.toLowerCase().endsWith(ext));
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      isValidFile(file) ? onFileSelect(file) : alert(`Please upload a ${accept} file`);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    const file = e.target.files?.[0];
    if (file) {
      isValidFile(file) ? onFileSelect(file) : alert(`Please upload a ${accept} file`);
    }
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    onFileSelect(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const zoneStyle = {
    position:     'relative',
    border:       `2px dashed ${dragActive ? T.indigo : selectedFile ? T.successBorder : T.border}`,
    borderRadius: T.radius,
    padding:      '28px 24px',
    textAlign:    'center',
    cursor:       'pointer',
    background:   dragActive ? T.indigoLight : selectedFile ? T.successLight : T.surface,
    transition:   'border-color 0.2s, background 0.2s, box-shadow 0.2s',
    boxShadow:    dragActive ? '0 0 0 4px rgba(90,79,207,0.10)' : 'none',
  };

  return (
    <div style={{ width: '100%' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Syne:wght@700&display=swap');
        .file-zone-${accept.replace(/[^a-z]/g, '')}:hover {
          border-color: ${T.borderFocus} !important;
          box-shadow: 0 0 0 3px rgba(90,79,207,0.07) !important;
        }
        .file-zone-${accept.replace(/[^a-z]/g, '')}:hover .upload-icon-wrap {
          background: ${T.indigoLight} !important;
        }
        .remove-btn-fu:hover {
          background: ${T.errorBorder} !important;
          color: #7F1D1D !important;
        }
      `}</style>

      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
        <span style={{
          fontSize: '11px', fontWeight: '700', color: T.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          fontFamily: "'Syne', sans-serif",
        }}>
          {label}
        </span>
        <span style={{ color: T.error, fontSize: '12px', fontWeight: '700' }}>*</span>
      </div>

      {/* Drop zone */}
      <div
        className={`file-zone-${accept.replace(/[^a-z]/g, '')}`}
        style={zoneStyle}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          style={{ display: 'none' }}
        />

        {!selectedFile ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div className="upload-icon-wrap" style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: dragActive ? T.indigoLight : '#F4F4F6',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.2s',
            }}>
              <Upload size={22} strokeWidth={1.8} style={{ color: dragActive ? T.indigo : T.textMuted, transition: 'color 0.2s' }} />
            </div>
            <div>
              <p style={{ fontSize: '14px', fontWeight: '600', color: T.textPrimary, margin: 0, fontFamily: "'DM Sans', sans-serif" }}>
                {dragActive ? 'Release to upload' : 'Drop file here'}
              </p>
              <p style={{ fontSize: '12px', color: T.textMuted, margin: '4px 0 0', fontFamily: "'DM Sans', sans-serif" }}>
                or <span style={{ color: T.indigo, fontWeight: '600', textDecoration: 'underline' }}>click to browse</span>
              </p>
            </div>
            <span style={{
              fontSize: '11px', color: T.textMuted, background: '#F4F4F6',
              borderRadius: '999px', padding: '3px 12px',
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {hint}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: T.successLight, border: `1px solid ${T.successBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <File size={22} strokeWidth={1.8} style={{ color: T.success }} />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: '600', color: T.textPrimary, margin: 0, fontFamily: "'DM Sans', sans-serif", wordBreak: 'break-all' }}>
                {selectedFile.name}
              </p>
              <p style={{ fontSize: '12px', color: T.textMuted, margin: '3px 0 0', fontFamily: "'DM Sans', sans-serif" }}>
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
            <button
              onClick={handleRemove}
              className="remove-btn-fu"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px',
                background: T.errorLight, border: `1px solid ${T.errorBorder}`,
                borderRadius: '999px', color: '#B91C1C',
                fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                transition: 'background 0.2s, color 0.2s',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <X size={12} strokeWidth={2.5} /> Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
