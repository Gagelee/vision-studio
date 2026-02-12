import React from 'react';

interface ClapperboardIconProps {
  isClosed: boolean;
  state: 'idle' | 'closing' | 'generating' | 'completed';
  className?: string;
}

export const ClapperboardIcon: React.FC<ClapperboardIconProps> = ({ 
  isClosed, 
  state,
  className = "" 
}) => {
  const isCompleted = state === 'completed';

  return (
    <svg
      viewBox="0 0 100 80"
      className={`transition-all duration-300 drop-shadow-2xl ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bodyGloss" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#333" />
          <stop offset="15%" stopColor="#222" />
          <stop offset="85%" stopColor="#111" />
          <stop offset="100%" stopColor="#050505" />
        </linearGradient>
        <linearGradient id="barGloss" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#666" />
          <stop offset="25%" stopColor="#555" />
          <stop offset="100%" stopColor="#222" />
        </linearGradient>
        <clipPath id="barClip">
          <rect x="0" y="0" width="92" height="12" rx="2" />
        </clipPath>
        <clipPath id="progressClip">
          <rect x="0" y="0" width="66" height="6" rx="3" />
        </clipPath>
      </defs>

      {/* Top Bar - Rotatable */}
      <g 
        className={`origin-[4px_28px] ${isCompleted ? 'animate-clapSnap' : 'transition-transform duration-500 cubic-bezier(0.34, 1.56, 0.64, 1)'}`}
        style={{ 
          transform: isCompleted 
            ? undefined 
            : (isClosed ? 'rotate(0deg)' : 'rotate(-14deg)')
        }}
      >
        <rect x="4" y="16" width="92" height="12" rx="2" fill="url(#barGloss)" stroke="#000" strokeWidth="0.5" />
        <g clipPath="url(#barClip)" transform="translate(4, 16)">
          {[0, 15, 30, 45, 60, 75, 90].map((x) => (
            <path key={x} d={`M${x} 0 L${x + 8} 0 L${x + 18} 12 L${x + 10} 12 Z`} fill="white" fillOpacity="0.85" />
          ))}
        </g>
        {/* Hinge detail */}
        <circle cx="8" cy="22" r="1.5" fill="#111" />
        <circle cx="14" cy="22" r="1.5" fill="#111" />
      </g>

      {/* Bottom Board Body */}
      <g transform="translate(4, 28)">
        <rect x="0" y="0" width="92" height="48" rx="4" fill="url(#bodyGloss)" stroke="#000" strokeWidth="1" />
        
        {/* Static Striped Bar */}
        <rect x="0" y="0" width="92" height="10" rx="1" fill="#222" />
        <g clipPath="url(#barClip)">
          {[0, 15, 30, 45, 60, 75, 90, 105].map((x) => (
            <path key={x} d={`M${x} 0 L${x + 8} 0 L${x - 2} 10 L${x - 10} 10 Z`} fill="white" fillOpacity="0.8" />
          ))}
        </g>

        {/* Cinematic Labels */}
        <g fill="white" fillOpacity="0.25" style={{ fontSize: '3.5px', fontWeight: '900', fontFamily: 'SF Pro, system-ui' }}>
          <text x="6" y="15">ROLL</text>
          <text x="32" y="15">SCENE</text>
          <text x="62" y="15">TAKE</text>
          <line x1="6" y1="18" x2="86" y2="18" stroke="white" strokeWidth="0.2" strokeOpacity="0.1" />
          
          <text x="6" y="26">DIRECTOR</text>
          <text x="50" y="26">CAMERA</text>
          <line x1="6" y1="29" x2="86" y2="29" stroke="white" strokeWidth="0.2" strokeOpacity="0.1" />
        </g>

        {/* Content Layer (Red Dot / Progress) */}
        <g transform="translate(6, 36)">
          {state === 'generating' ? (
            <g>
              <circle cx="6" cy="4" r="3.5" fill="#ff3b30" className="animate-pulseDot" />
              <g transform="translate(16, 1)">
                <rect x="0" y="0" width="66" height="6" rx="3" fill="#000" stroke="#333" strokeWidth="0.5" />
                <g clipPath="url(#progressClip)">
                  <rect 
                    x="0" 
                    y="0" 
                    width="66" 
                    height="6" 
                    fill="#34c759" 
                    className="animate-progress" 
                    style={{ transformOrigin: '0% 50%' }} 
                  />
                </g>
              </g>
            </g>
          ) : isCompleted ? (
            <g transform="translate(16, 1)">
               <rect x="0" y="0" width="66" height="6" rx="3" fill="#34c759" fillOpacity="0.2" stroke="#34c759" strokeWidth="0.5" />
               <text x="33" y="4.5" fill="#34c759" style={{ fontSize: '4px', fontWeight: 'bold' }} textAnchor="middle">EXPORT READY</text>
            </g>
          ) : (
            <g opacity="0.03">
              <circle cx="6" cy="4" r="3.5" fill="white" />
              <rect x="16" y="1" width="66" height="6" rx="3" fill="white" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
};