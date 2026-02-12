import React, { useState, useCallback, useMemo } from 'react';
import { ClapperboardIcon } from './icons/ClapperboardIcon';

type GenerateState = "idle" | "closing" | "generating" | "completed";

interface ConfettiParticleProps {
  delay: number;
}

const ConfettiParticle: React.FC<ConfettiParticleProps> = ({ delay }) => {
  const styles = useMemo(() => {
    // Spread in a full circle with more force
    const angle = Math.random() * Math.PI * 2;
    const distance = 120 + Math.random() * 280; 
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance - 80; // High bias upwards
    
    // Vary sizes and shapes
    const size = 6 + Math.random() * 12;
    const colors = [
      '#10b981', '#3b82f6', '#f59e0b', '#ef4444', 
      '#a855f7', '#ec4899', '#34d399', '#60a5fa'
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = Math.random() > 0.6 ? 'circle' : (Math.random() > 0.5 ? 'square' : 'strip');
    
    return {
      '--tw-translate-x': `${x}px`,
      '--tw-translate-y': `${y}px`,
      width: `${size}px`,
      height: shape === 'circle' ? `${size}px` : (shape === 'strip' ? `${size * 0.3}px` : `${size}px`),
      backgroundColor: color,
      borderRadius: shape === 'circle' ? '50%' : (shape === 'square' ? '2px' : '1px'),
      animationDelay: `${delay}s`,
      boxShadow: `0 0 10px ${color}44`,
    } as React.CSSProperties;
  }, [delay]);

  return (
    <div 
      className="absolute opacity-0 animate-confettiBurst pointer-events-none"
      style={styles}
    >
      <div className="w-full h-full animate-confettiTumble" />
    </div>
  );
};

interface GenerateButtonProps {
  onGenerate: () => Promise<void>;
  className?: string;
}

export const GenerateButton: React.FC<GenerateButtonProps> = ({ onGenerate, className = "" }) => {
  const [state, setState] = useState<GenerateState>("idle");

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;

    setState("closing");

    setTimeout(async () => {
      setState("generating");
      try {
        await onGenerate();
        setState("completed");
        // Extended completion time to match longer animation
        setTimeout(() => setState("idle"), 5500);
      } catch (error) {
        console.error("Rendering failed", error);
        setState("idle");
      }
    }, 450); 
  }, [state, onGenerate]);

  const confettiParticles = useMemo(() => {
    // Increased to 100 for a rich celebration
    return Array.from({ length: 100 }).map((_, i) => (
      // Trigger exactly at the moment of clapper impact (~0.64s into dropIn)
      <ConfettiParticle key={i} delay={0.65 + Math.random() * 0.15} />
    ));
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center gap-6 ${className}`}>
      <div className={`
        relative w-72 h-72 flex flex-col items-center justify-center
        transition-all duration-1000
        ${state === 'completed' ? 'animate-dropIn' : ''}
      `}>
        {/* Rich Confetti Burst */}
        {state === 'completed' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            {confettiParticles}
          </div>
        )}

        <button
          onClick={handleClick}
          disabled={state !== "idle"}
          className={`
            relative w-full h-full transition-transform duration-300 z-10
            ${state === 'idle' ? 'hover:scale-105 active:scale-95 cursor-pointer outline-none' : 'cursor-default'}
          `}
        >
          <ClapperboardIcon
            state={state}
            isClosed={state !== "idle"}
            className="w-full h-full"
          />
        </button>

        {/* Labels below the icon */}
        <div className={`
          absolute -bottom-12 transition-all duration-700 flex flex-col items-center pointer-events-none
          ${state === 'idle' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}
        `}>
          <span className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.5em] mb-1">Studio Preview</span>
          <span className="text-zinc-400 text-xs font-medium tracking-tight">Click to Start Production</span>
        </div>

        {/* Generating Overlay Labels */}
        {state === 'generating' && (
          <div className="absolute -bottom-12 flex flex-col items-center pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-1000">
            <span className="text-amber-500 text-[10px] font-black uppercase tracking-[0.4em] animate-pulse">Rendering VEO-3.1</span>
            <div className="flex gap-1 mt-1.5">
              <div className="w-1 h-1 bg-zinc-700 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1 h-1 bg-zinc-700 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1 h-1 bg-zinc-700 rounded-full animate-bounce" />
            </div>
          </div>
        )}

        {/* Success Labels (No Checkmark) */}
        {state === 'completed' && (
          <div className="absolute -bottom-12 flex flex-col items-center pointer-events-none animate-in fade-in zoom-in duration-700 delay-[800ms]">
            <span className="text-emerald-400 text-[12px] font-black uppercase tracking-[0.6em] drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">Action Completed</span>
            <span className="text-emerald-500/40 text-[9px] font-bold uppercase mt-1">High Fidelity Rendered</span>
          </div>
        )}
      </div>

      {/* Shadow Floor - Interacts with state */}
      <div className={`
        w-48 h-2 bg-black/80 blur-2xl rounded-full transition-all duration-1000
        ${state === 'completed' ? 'scale-[1.8] bg-emerald-500/20' : 'scale-100 opacity-40'}
      `} />
    </div>
  );
};