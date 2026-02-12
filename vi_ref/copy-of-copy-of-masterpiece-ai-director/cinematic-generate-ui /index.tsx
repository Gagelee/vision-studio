
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GenerateButton } from './components/GenerateButton';

const App = () => {
  const handleGenerate = async () => {
    // Simulate a cinematic generation process
    return new Promise<void>((resolve) => {
      setTimeout(resolve, 3500);
    });
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-12">
      <header className="text-center space-y-2">
        <h1 className="text-4xl font-black tracking-tighter sm:text-6xl text-zinc-100">
          VEO <span className="text-amber-500">STUDIO</span>
        </h1>
        <p className="text-zinc-500 text-lg max-w-md mx-auto">
          Experience high-fidelity cinematic video generation with our new animated workflow.
        </p>
      </header>

      <div className="p-12 rounded-[3rem] border border-zinc-900 bg-zinc-950/50 shadow-2xl backdrop-blur-xl">
        <GenerateButton onGenerate={handleGenerate} />
      </div>

      <footer className="text-zinc-600 text-sm font-medium">
        Press 🎬 to start rendering
      </footer>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
