import React, { useMemo, useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { FileText } from 'lucide-react';

/* ── Design tokens — Light "Clean Canvas" ─────────────────────────────────── */
const T = {
  bg:           '#FAFAF8',
  surface:      '#FFFFFF',
  border:       '#EAEAEA',
  borderFocus:  '#C7C3F4',
  borderHover:  '#D4D1F5',

  indigo:       '#5A4FCF',
  indigoLight:  '#F0EFFF',
  indigoMid:    '#7C75E0',

  textPrimary:  '#1A1A2E',
  textSecondary:'#6B7280',
  textMuted:    '#A3A3B3',

  radius:       '12px',
  radiusSm:     '8px',
};

const RichTextQuestionInput = ({ value, onChange }) => {
  const quillRef = useRef(null);

  /* ── Base64 image handler ─────────────────────────────────────────────── */
  const imageHandler = () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result;
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        const range = editor.getSelection(true);
        editor.insertEmbed(range.index, 'image', base64);
        editor.setSelection(range.index + 1);
      };
      reader.readAsDataURL(file);
    };
  };

  /* ── Clipboard paste handler ──────────────────────────────────────────── */
  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;

    const handlePaste = (e) => {
      const clipboard = e.clipboardData;
      if (!clipboard) return;
      const items = Array.from(clipboard.items);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target.result;
          const range = editor.getSelection(true);
          editor.insertEmbed(range?.index ?? 0, 'image', base64);
          editor.setSelection((range?.index ?? 0) + 1);
        };
        reader.readAsDataURL(file);
      }
    };

    const editorRoot = editor.root;
    editorRoot.addEventListener('paste', handlePaste);
    return () => editorRoot.removeEventListener('paste', handlePaste);
  }, []);

  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ color: [] }, { background: [] }],
        ['code-block', 'blockquote'],
        ['image'],
        ['clean'],
      ],
      handlers: { image: imageHandler },
    },
  }), []);

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'list', 'bullet',
    'color', 'background',
    'code-block', 'blockquote',
    'image',
  ];

  const getPlainTextLength = (html) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent?.length || 0;
  };

  const charCount = getPlainTextLength(value);

  return (
    <div style={{ width: '100%' }}>

      {/* Quill theme overrides */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Syne:wght@700&display=swap');

        /* ── Toolbar ── */
        .ql-toolbar.ql-snow {
          background: ${T.indigoLight};
          border: 1px solid ${T.border} !important;
          border-bottom: 1px solid ${T.borderFocus} !important;
          border-radius: ${T.radius} ${T.radius} 0 0 !important;
          padding: 8px 12px !important;
          display: flex;
          flex-wrap: wrap;
          gap: 2px;
        }

        .ql-toolbar.ql-snow .ql-formats {
          margin-right: 6px !important;
        }

        /* Toolbar buttons */
        .ql-toolbar.ql-snow button,
        .ql-toolbar.ql-snow .ql-picker-label {
          border-radius: 6px !important;
          padding: 4px 5px !important;
          transition: background 0.15s, color 0.15s !important;
          color: ${T.textSecondary} !important;
        }

        .ql-toolbar.ql-snow button:hover,
        .ql-toolbar.ql-snow .ql-picker-label:hover {
          background: ${T.surface} !important;
          color: ${T.indigo} !important;
        }

        .ql-toolbar.ql-snow button.ql-active,
        .ql-toolbar.ql-snow .ql-picker-label.ql-active {
          background: ${T.surface} !important;
          color: ${T.indigo} !important;
          box-shadow: 0 1px 4px rgba(90,79,207,0.15);
        }

        .ql-toolbar.ql-snow .ql-stroke {
          stroke: ${T.textSecondary} !important;
          transition: stroke 0.15s;
        }
        .ql-toolbar.ql-snow button:hover .ql-stroke,
        .ql-toolbar.ql-snow button.ql-active .ql-stroke {
          stroke: ${T.indigo} !important;
        }

        .ql-toolbar.ql-snow .ql-fill {
          fill: ${T.textSecondary} !important;
          transition: fill 0.15s;
        }
        .ql-toolbar.ql-snow button:hover .ql-fill,
        .ql-toolbar.ql-snow button.ql-active .ql-fill {
          fill: ${T.indigo} !important;
        }

        /* Picker dropdowns */
        .ql-toolbar.ql-snow .ql-picker {
          color: ${T.textSecondary} !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 12px !important;
        }
        .ql-toolbar.ql-snow .ql-picker-options {
          background: ${T.surface} !important;
          border: 1px solid ${T.border} !important;
          border-radius: ${T.radiusSm} !important;
          box-shadow: 0 4px 16px rgba(90,79,207,0.10) !important;
          padding: 4px !important;
        }
        .ql-toolbar.ql-snow .ql-picker-item:hover {
          color: ${T.indigo} !important;
        }

        /* ── Editor area ── */
        .ql-container.ql-snow {
          border: 1px solid ${T.border} !important;
          border-top: none !important;
          border-radius: 0 0 ${T.radius} ${T.radius} !important;
          background: ${T.surface} !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 14px !important;
        }

        .ql-editor {
          min-height: 160px !important;
          max-height: 400px !important;
          overflow-y: auto !important;
          padding: 16px 18px !important;
          color: ${T.textPrimary} !important;
          line-height: 1.65 !important;
        }

        .ql-editor.ql-blank::before {
          color: ${T.textMuted} !important;
          font-style: normal !important;
          font-size: 13px !important;
          font-family: 'DM Sans', sans-serif !important;
        }

        /* Focus ring on the whole editor */
        .quill-wrapper:focus-within .ql-toolbar.ql-snow {
          border-color: ${T.borderFocus} !important;
        }
        .quill-wrapper:focus-within .ql-container.ql-snow {
          border-color: ${T.borderFocus} !important;
          box-shadow: 0 0 0 3px rgba(90,79,207,0.08) !important;
        }

        /* Code block */
        .ql-editor pre.ql-syntax {
          background: #F5F4FF !important;
          border: 1px solid ${T.borderFocus} !important;
          border-radius: ${T.radiusSm} !important;
          color: ${T.indigo} !important;
          font-size: 12.5px !important;
          padding: 12px 14px !important;
        }

        /* Blockquote */
        .ql-editor blockquote {
          border-left: 3px solid ${T.indigoMid} !important;
          background: ${T.indigoLight} !important;
          border-radius: 0 ${T.radiusSm} ${T.radiusSm} 0 !important;
          padding: 8px 14px !important;
          margin: 6px 0 !important;
          color: ${T.textSecondary} !important;
        }

        /* Images */
        .ql-editor img {
          max-width: 100% !important;
          border-radius: ${T.radiusSm} !important;
          border: 1px solid ${T.border} !important;
          margin: 4px 0 !important;
        }

        /* Scrollbar */
        .ql-editor::-webkit-scrollbar { width: 5px; }
        .ql-editor::-webkit-scrollbar-track { background: transparent; }
        .ql-editor::-webkit-scrollbar-thumb {
          background: ${T.borderFocus};
          border-radius: 4px;
        }
      `}</style>

      {/* Editor wrapper */}
      <div className="quill-wrapper">
        <ReactQuill
          ref={quillRef}
          theme="snow"
          value={value}
          onChange={onChange}
          modules={modules}
          formats={formats}
          placeholder="Enter your coding question here with formatting..."
        />
      </div>

      {/* Footer bar */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginTop:      '8px',
        padding:        '5px 2px',
      }}>
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:        '6px',
        }}>
          <span style={{
            fontSize:   '11px',
            color:      T.textMuted,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Supports rich text, code blocks &amp; images
          </span>
        </div>

        {/* Character counter */}
        <span style={{
          fontSize:     '11px',
          fontWeight:   '600',
          color:        charCount > 0 ? T.indigo : T.textMuted,
          background:   charCount > 0 ? T.indigoLight : 'transparent',
          padding:      charCount > 0 ? '2px 10px' : '0',
          borderRadius: '999px',
          transition:   'all 0.2s',
          fontFamily:   "'DM Sans', sans-serif",
        }}>
          {charCount > 0 ? `${charCount.toLocaleString()} chars` : '0 chars'}
        </span>
      </div>
    </div>
  );
};

export default RichTextQuestionInput;