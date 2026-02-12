import React, { CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react';

type ClapperState = 'idle' | 'closing' | 'generating' | 'completed';

export const CinematicClapperboardIcon: React.FC<{
  state: ClapperState;
  className?: string;
  style?: CSSProperties;
}> = ({ state, className = '', style }) => {
  const isClosed = state !== 'idle';
  const isCompleted = state === 'completed';
  const bodyStops = { top: '#f4f5f7', mid1: '#eceef2', mid2: '#e1e4ea', bottom: '#d4d9e1' };
  const barStops = { top: '#13151c', mid: '#0f1117', bottom: '#090b10' };
  const lineColor = '#11161d';
  const lineOpacity = 0.45;
  const strokeColor = '#11161d';
  const panelHeaderFill = '#0f1117';
  const textFill = '#0e1319';
  const textOpacity = 0.62;
  const uid = useId().replace(/:/g, '');
  const bodyGlossId = `cine-bodyGloss-${uid}`;
  const barGlossId = `cine-barGloss-${uid}`;
  const barClipId = `cine-barClip-${uid}`;
  const progressClipId = `cine-progressClip-${uid}`;
  return (
    <svg
      viewBox="0 0 100 80"
      className={`transition-all duration-300 drop-shadow-2xl ${className}`}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={bodyGlossId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={bodyStops.top} />
          <stop offset="15%" stopColor={bodyStops.mid1} />
          <stop offset="85%" stopColor={bodyStops.mid2} />
          <stop offset="100%" stopColor={bodyStops.bottom} />
        </linearGradient>
        <linearGradient id={barGlossId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={barStops.top} />
          <stop offset="25%" stopColor={barStops.mid} />
          <stop offset="100%" stopColor={barStops.bottom} />
        </linearGradient>
        <clipPath id={barClipId}>
          <rect x="0" y="0" width="92" height="12" rx="2" />
        </clipPath>
        <clipPath id={progressClipId}>
          <rect x="0" y="0" width="66" height="6" rx="3" />
        </clipPath>
      </defs>

      <g
        className={`origin-[4px_28px] ${isCompleted ? 'animate-clapSnap' : 'transition-transform duration-500 cubic-bezier(0.34, 1.56, 0.64, 1)'}`}
        style={{
          transform: isCompleted ? undefined : isClosed ? 'rotate(0deg)' : 'rotate(-12deg)',
        }}
      >
        <rect x="4" y="16" width="92" height="12" rx="2" fill={`url(#${barGlossId})`} stroke={strokeColor} strokeWidth="0.5" />
        <g clipPath={`url(#${barClipId})`} transform="translate(4, 16)">
          {[0, 15, 30, 45, 60, 75, 90].map((x) => (
            <path key={x} d={`M${x} 0 L${x + 8} 0 L${x + 18} 12 L${x + 10} 12 Z`} fill="white" fillOpacity="0.85" />
          ))}
        </g>
        <circle cx="8" cy="22" r="1.5" fill="#111" />
        <circle cx="14" cy="22" r="1.5" fill="#111" />
      </g>

      <g transform="translate(4, 28)">
        <rect x="0" y="0" width="92" height="48" rx="4" fill={`url(#${bodyGlossId})`} stroke={strokeColor} strokeWidth="1" />
        <rect x="0" y="0" width="92" height="10" rx="1" fill={panelHeaderFill} />
        <g clipPath={`url(#${barClipId})`}>
          {[0, 15, 30, 45, 60, 75, 90, 105].map((x) => (
            <path key={x} d={`M${x} 0 L${x + 8} 0 L${x - 2} 10 L${x - 10} 10 Z`} fill="white" fillOpacity="0.8" />
          ))}
        </g>

        <g fill={textFill} fillOpacity={textOpacity} style={{ fontSize: '3.5px', fontWeight: '900', fontFamily: 'SF Pro, system-ui' }}>
          <text x="6" y="15">ROLL</text>
          <text x="32" y="15">SCENE</text>
          <text x="62" y="15">TAKE</text>
          <line x1="6" y1="18" x2="86" y2="18" stroke={lineColor} strokeWidth="0.2" strokeOpacity={lineOpacity} />
          <text x="6" y="26">DIRECTOR</text>
          <text x="50" y="26">CAMERA</text>
          <line x1="6" y1="29" x2="86" y2="29" stroke={lineColor} strokeWidth="0.2" strokeOpacity={lineOpacity} />
        </g>

        <g transform="translate(6, 36)">
          {state === 'generating' ? (
            <g>
              <circle cx="6" cy="4" r="3.5" fill="#ff3b30" className="animate-pulseDot" />
              <g transform="translate(16, 1)">
                <rect x="0" y="0" width="66" height="6" rx="3" fill="#000" stroke="#333" strokeWidth="0.5" />
                <g clipPath={`url(#${progressClipId})`}>
                  <rect x="0" y="0" width="66" height="6" fill="#34c759" className="animate-progress" style={{ transformOrigin: '0% 50%' }} />
                </g>
              </g>
            </g>
          ) : isCompleted ? (
            <g transform="translate(16, 1)">
              <rect x="0" y="0" width="66" height="6" rx="3" fill="#34c759" fillOpacity="0.2" stroke="#34c759" strokeWidth="0.5" />
              <text x="33" y="4.5" fill="#34c759" style={{ fontSize: '4px', fontWeight: 'bold' }} textAnchor="middle">
                EXPORT READY
              </text>
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

export const CinematicGenerateButton: React.FC<{
  isGenerating: boolean;
  disabled?: boolean;
  onClick?: () => void;
  titleIdle?: string;
  titleGenerating?: string;
  buttonClassName?: string;
  iconClassName?: string;
  buttonStyle?: CSSProperties;
  iconStyle?: CSSProperties;
}> = ({
  isGenerating,
  disabled = false,
  onClick,
  titleIdle = 'Start Production',
  titleGenerating = 'Rendering VEO-3.1',
  buttonClassName = '',
  iconClassName = 'w-7 h-7',
  buttonStyle,
  iconStyle,
}) => {
  const [state, setState] = useState<ClapperState>('idle');
  const closeTimerRef = useRef<number | null>(null);
  const fallbackIdleTimerRef = useRef<number | null>(null);
  const generatingRef = useRef(isGenerating);

  useEffect(() => {
    generatingRef.current = isGenerating;
    if (isGenerating) {
      setState('generating');
    } else {
      setState((prev) => (prev === 'generating' ? 'idle' : prev));
    }
  }, [isGenerating]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (fallbackIdleTimerRef.current) window.clearTimeout(fallbackIdleTimerRef.current);
    };
  }, []);

  const handleClick = () => {
    if (disabled || state === 'closing' || isGenerating) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (fallbackIdleTimerRef.current) window.clearTimeout(fallbackIdleTimerRef.current);

    setState('closing');
    closeTimerRef.current = window.setTimeout(() => {
      setState('generating');
      onClick?.();
      // If user cancels modal/start flow, recover to idle.
      fallbackIdleTimerRef.current = window.setTimeout(() => {
        if (!generatingRef.current) setState('idle');
      }, 12_000);
    }, 450);
  };

  const title = state === 'generating' || isGenerating ? titleGenerating : titleIdle;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      className={`cine-generate-btn ${state === 'idle' && !disabled ? 'cine-generate-btn-idle' : ''} ${
        disabled ? 'cursor-not-allowed' : ''
      } ${buttonClassName}`}
      style={buttonStyle}
    >
      <CinematicClapperboardIcon state={state} className={iconClassName} style={iconStyle} />
    </button>
  );
};

export const CinematicCompletionToast: React.FC<{ message: string }> = ({ message }) => {
  const confettiParticles = useMemo(
    () =>
      Array.from({ length: 32 }).map((_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = 80 + Math.random() * 160;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance - 40;
        const size = 5 + Math.random() * 8;
        const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        return (
          <div
            key={`confetti-${i}`}
            className="cine-confetti-burst"
            style={
              {
                '--tw-translate-x': `${x}px`,
                '--tw-translate-y': `${y}px`,
                width: `${size}px`,
                height: `${size}px`,
                backgroundColor: color,
                // Align confetti with clapper impact moment.
                animationDelay: `${0.78 + Math.random() * 0.14}s`,
              } as React.CSSProperties
            }
          />
        );
      }),
    [],
  );

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[170] pointer-events-none">
      <div className="cine-complete-screen-bg" />
      <div className="relative flex flex-col items-center justify-center gap-2 cine-complete-stack">
        <div className="relative cine-complete-drop">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">{confettiParticles}</div>
          <CinematicClapperboardIcon state="completed" className="cine-complete-icon w-20 h-20" />
        </div>
        <div className="cine-complete-label text-[15px] font-semibold text-white text-center">{message}</div>
      </div>
    </div>
  );
};
