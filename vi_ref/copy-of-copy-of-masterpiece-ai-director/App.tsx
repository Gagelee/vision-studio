
import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import ChatInterface from './components/ChatInterface';
import { Studio } from './components/Studio';
import { ViewState, AspectRatio, Story, Message } from './types';
import { generateScaffold, generateScaffoldFromChat } from './services/geminiService';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('landing');
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [setupData, setSetupData] = useState<{ prompt: string, ratio: AspectRatio } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Transition Helpers
  const handleStartInteraction = (prompt: string, ratio: AspectRatio) => {
    setSetupData({ prompt, ratio });
    setView('director_setup');
  };

  const handleStartAuto = async (prompt: string, ratio: AspectRatio) => {
    setIsLoading(true);
    try {
      const story = await generateScaffold(prompt);
      story.aspectRatio = ratio;
      setActiveStory(story);
      setView('studio');
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDirectorFinish = async (history: Message[]) => {
    if (!setupData) return;
    setIsLoading(true);
    try {
      const story = await generateScaffoldFromChat(history);
      story.aspectRatio = setupData.ratio;
      setActiveStory(story);
      setView('studio');
    } catch (e) {
      await handleStartAuto(setupData.prompt, setupData.ratio);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black text-white font-sans selection:bg-white/30">
      
      {/* Dynamic Neural Mesh Background - Enhances Glassmorphism */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] bg-blue-600/10 blur-[140px] rounded-full animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[0%] w-[60vw] h-[60vw] bg-orange-600/5 blur-[120px] rounded-full animate-pulse [animation-delay:2s]"></div>
        <div className="absolute top-[20%] right-[10%] w-[40vw] h-[40vw] bg-purple-600/10 blur-[130px] rounded-full animate-pulse [animation-delay:1s]"></div>
        <div className="absolute inset-0 bg-black/60"></div>
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.1] mix-blend-overlay"></div>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-[300] flex flex-col items-center justify-center bg-black/90 backdrop-blur-2xl animate-in fade-in duration-1000">
            <div className="relative w-12 h-12">
               <svg className="animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-10" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"></circle>
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
            </div>
            <div className="mt-8 text-[9px] font-bold tracking-[0.6em] uppercase text-white/40">
                Synchronizing Core Vision
            </div>
        </div>
      )}

      {/* VIEW LAYERS: Using Apple-style Vertical Transitions */}
      
      {/* Layer 1: Landing */}
      <div 
        className="absolute inset-0 z-10 apple-ease duration-[1200ms] will-change-transform"
        style={{
            transform: view === 'landing' ? 'translateY(0)' : 'translateY(-100vh)',
            opacity: view === 'landing' ? 1 : 0,
            filter: view === 'landing' ? 'blur(0)' : 'blur(40px)',
            pointerEvents: view === 'landing' ? 'auto' : 'none'
        }}
      >
        <LandingPage 
          onStartInteraction={handleStartInteraction}
          onStartAuto={handleStartAuto}
        />
      </div>

      {/* Layer 2: Director Setup (Chat) */}
      <div 
        className="absolute inset-0 z-20 apple-ease duration-[1200ms] will-change-transform bg-black/40"
        style={{
            transform: view === 'director_setup' 
                ? 'translateY(0)' 
                : view === 'landing' 
                    ? 'translateY(100vh)' 
                    : 'translateY(-100vh)',
            opacity: view === 'director_setup' ? 1 : 0,
            filter: view === 'director_setup' ? 'blur(0)' : 'blur(40px)',
            pointerEvents: view === 'director_setup' ? 'auto' : 'none'
        }}
      >
        {view === 'director_setup' && setupData && (
            <ChatInterface 
                activeStory={null}
                initialPrompt={setupData.prompt}
                onStartGeneration={handleDirectorFinish}
                onBack={() => setView('landing')}
            />
        )}
      </div>

      {/* Layer 3: Studio */}
      <div 
        className="absolute inset-0 z-30 apple-ease duration-[1200ms] will-change-transform"
        style={{
            transform: view === 'studio' ? 'translateY(0)' : 'translateY(100vh)',
            opacity: view === 'studio' ? 1 : 0,
            pointerEvents: view === 'studio' ? 'auto' : 'none'
        }}
      >
        {activeStory && (
          <Studio 
            story={activeStory}
            onBack={() => {
                setView('landing');
                setActiveStory(null);
                setSetupData(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default App;
