
import React, { useState, useEffect } from 'react';
import { AspectRatio } from '../types';
import { Monitor, Smartphone, Square, Frame, ArrowRight, Sparkles } from 'lucide-react';

interface LandingPageProps {
  onStartInteraction: (prompt: string, ratio: AspectRatio) => void;
  onStartAuto: (prompt: string, ratio: AspectRatio) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStartInteraction, onStartAuto }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>('16:9');
  const [mode, setMode] = useState<'auto' | 'interactive'>('interactive');
  const [placeholder, setPlaceholder] = useState('');
  
  const placeholders = [
    "A cyberpunk neon street in 2077...",
    "A lonely lighthouse in a digital storm...",
    "Space opera set in a dying sun...",
    "Minimalist sci-fi architecture...",
    "Surreal dreamscape of floating clocks..."
  ];

  useEffect(() => {
    let i = 0;
    let charIndex = 0;
    let currentText = "";
    let isDeleting = false;
    let typingSpeed = 100;

    const type = () => {
      const fullText = placeholders[i];
      
      if (isDeleting) {
        currentText = fullText.substring(0, charIndex - 1);
        charIndex--;
        typingSpeed = 50;
      } else {
        currentText = fullText.substring(0, charIndex + 1);
        charIndex++;
        typingSpeed = 100;
      }

      setPlaceholder(currentText);

      if (!isDeleting && charIndex === fullText.length) {
        isDeleting = true;
        typingSpeed = 2000; // Pause at end
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        i = (i + 1) % placeholders.length;
        typingSpeed = 500;
      }

      setTimeout(type, typingSpeed);
    };

    const timeout = setTimeout(type, 1000);
    return () => clearTimeout(timeout);
  }, []);

  const ratios: { id: AspectRatio; label: string; icon: React.ReactNode }[] = [
    { id: '16:9', label: 'CINEMA', icon: <div className="w-5 h-3.5 border border-current rounded-sm opacity-100" /> },
    { id: '9:16', label: 'SOCIAL', icon: <div className="w-3.5 h-5 border border-current rounded-sm opacity-100" /> },
    { id: '1:1', label: 'SQUARE', icon: <div className="w-4 h-4 border border-current rounded-sm opacity-100" /> },
    { id: '4:5', label: 'PORTRAIT', icon: <div className="w-4 h-5 border border-current rounded-sm opacity-100" /> }
  ];

  const handleStart = () => {
    if (!prompt.trim()) return;
    if (mode === 'auto') {
      onStartAuto(prompt, selectedRatio);
    } else {
      onStartInteraction(prompt, selectedRatio);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 max-w-[1200px] mx-auto relative z-10 animate-in fade-in duration-1000">
      
      {/* Hero Section */}
      <div className="text-center mb-10">
        <h1 className="flex flex-col items-center">
            <span className="text-7xl md:text-[100px] font-extralight tracking-tight text-white leading-tight opacity-100">Direct your</span>
            <span className="text-7xl md:text-[100px] italic font-medium tracking-tighter text-white leading-[0.8] mt-2">Vision.</span>
        </h1>
      </div>

      {/* Mode Selector */}
      <div className="mb-14">
        <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10 backdrop-blur-3xl shadow-xl">
            <button 
                onClick={() => setMode('auto')}
                className={`px-8 py-2.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] transition-all duration-500 ${
                    mode === 'auto' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white/60'
                }`}
            >
                AUTO
            </button>
            <button 
                onClick={() => setMode('interactive')}
                className={`px-8 py-2.5 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] transition-all duration-500 ${
                    mode === 'interactive' ? 'bg-white text-black shadow-xl' : 'text-white/40 hover:text-white/60'
                }`}
            >
                INTERACTIVE
            </button>
        </div>
      </div>

      {/* Inviting Input Field */}
      <div className="w-full max-w-2xl relative mb-16 group">
         
         {/* Mandatory Hint Label - Visible only when idle to guide the user */}
         <div className={`absolute -top-8 left-6 transition-all duration-700 pointer-events-none ${prompt ? 'opacity-0 -translate-y-2' : 'opacity-40 translate-y-0'}`}>
            <span className="text-[10px] font-black tracking-[0.4em] uppercase text-white">Entry Point Required</span>
         </div>

         {/* Breathing Background Glow */}
         <div className="absolute -inset-0.5 bg-gradient-to-r from-white/10 via-white/5 to-white/10 rounded-full blur-xl opacity-20 group-hover:opacity-40 focus-within:opacity-60 transition-all duration-1000 animate-pulse"></div>
         
         <div className="relative bg-black/40 border border-white/20 rounded-full pl-6 pr-2 py-1.5 flex items-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-3xl transition-all duration-700 hover:border-white/40 group-focus-within:border-white/60 group-focus-within:bg-black/60 group-focus-within:ring-1 group-focus-within:ring-white/20">
            
            {/* Visual Affordance Icon */}
            <div className={`flex-shrink-0 mr-3 transition-all duration-500 ${prompt ? 'text-white' : 'text-white/30 group-hover:text-white/60'}`}>
                <Sparkles size={20} strokeWidth={1.5} className={!prompt ? 'animate-pulse' : ''} />
            </div>

            <input 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                placeholder={placeholder}
                className="flex-1 bg-transparent border-none outline-none text-lg font-light tracking-wide text-white placeholder-white/10 h-14"
                autoFocus
            />

            {/* Pulsing button when prompt exists */}
            <button 
                onClick={handleStart}
                disabled={!prompt.trim()}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 ml-4 shadow-2xl ${
                    prompt.trim() 
                    ? 'bg-white text-black scale-100 opacity-100 hover:scale-110 active:scale-95' 
                    : 'bg-white/10 text-white/20 scale-90 opacity-40 cursor-not-allowed'
                }`}
            >
                <ArrowRight className="w-5 h-5" strokeWidth={3} />
            </button>
         </div>

         {/* Shimmer Overlay */}
         <div className="absolute inset-0 rounded-full pointer-events-none overflow-hidden opacity-50">
            <div className="absolute top-0 -left-[100%] w-1/2 h-full bg-gradient-to-r from-transparent via-white/[0.1] to-transparent skew-x-[45deg] animate-[shimmer_4s_infinite]"></div>
         </div>
      </div>

      {/* Aspect Ratio Options */}
      <div className="flex gap-10 mb-20">
         {ratios.map((r) => (
             <button
                key={r.id}
                onClick={() => setSelectedRatio(r.id)}
                className={`group flex flex-col items-center gap-4 transition-all duration-500 ${
                    selectedRatio === r.id ? 'scale-105 opacity-100' : 'opacity-40 hover:opacity-80'
                }`}
             >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-700 ${
                    selectedRatio === r.id 
                        ? 'bg-white text-black shadow-2xl' 
                        : 'bg-white/10 text-white border border-white/10 shadow-lg hover:border-white/30'
                }`}>
                    {r.icon}
                </div>
                <span className={`text-[8px] font-bold tracking-[0.2em] uppercase transition-colors duration-500 ${
                    selectedRatio === r.id ? 'text-white' : 'text-white/60'
                }`}>
                    {r.label}
                </span>
             </button>
         ))}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%) skewX(-45deg); }
          100% { transform: translateX(300%) skewX(-45deg); }
        }
      `}</style>
    </div>
  );
};

export default LandingPage;
