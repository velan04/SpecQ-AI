// src/components/LoaderOverlay.jsx
import React from 'react';
import './LoaderOverlay.css';

const LoaderOverlay = ({ visible }) => {
  if (!visible) return null;

  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      zIndex:         9999,
      background:     'rgba(20, 18, 60, 0.75)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '28px',
    }}>

      {/* Radial glow behind loader */}
      <div style={{
        position:         'absolute',
        width:            '320px',
        height:           '320px',
        borderRadius:     '50%',
        background:       'radial-gradient(circle, rgba(90,79,207,0.22) 0%, transparent 70%)',
        pointerEvents:    'none',
      }} />

      {/* Loader */}
      <div className="loader">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <defs>
            <mask id="clipping">
              <polygon points="0,0 100,0 100,100 0,100" fill="black" />
              <polygon points="25,25 75,25 50,75" fill="white" />
              <polygon points="50,25 75,75 25,75" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
            </mask>
          </defs>
        </svg>
        <div className="box" />
      </div>

      {/* Text */}
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <p style={{
          color:         '#FFFFFF',
          fontSize:      '15px',
          fontWeight:    '700',
          margin:        '0 0 6px',
          letterSpacing: '0.03em',
          fontFamily:    "'Syne', sans-serif",
        }}>
          Running QC Pipeline...
        </p>
        <p style={{
          color:      'rgba(200, 198, 255, 0.70)',
          fontSize:   '12px',
          margin:     0,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          This may take a few moments
        </p>

        {/* Animated dots */}
        <div style={{
          display:        'flex',
          justifyContent: 'center',
          gap:            '5px',
          marginTop:      '14px',
        }}>
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="pulse-dot"
              style={{ animationDelay: `${i * 0.22}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default LoaderOverlay;