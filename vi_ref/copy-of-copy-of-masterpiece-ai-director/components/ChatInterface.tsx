
import React, { useState, useRef, useEffect } from 'react';
import { Message, Story, Attachment } from '../types';
import { sendDirectorMessage } from '../services/geminiService';
import { ArrowUp, X, Sparkles, Paperclip, FileText, Image as ImageIcon } from 'lucide-react';

interface ChatInterfaceProps {
  activeStory: Story | null;
  initialPrompt?: string;
  onStartGeneration?: (history: Message[]) => void;
  onBack?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ activeStory, initialPrompt, onStartGeneration, onBack }) => {
  const isSetupMode = !!onStartGeneration;
  const hasInitialized = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialPrompt && initialPrompt.trim()) {
        return [{ role: 'user', text: initialPrompt, timestamp: Date.now() }];
    }
    return [{
      role: 'model',
      text: "Director online. I'm ready to visualize your concept. What is the core visual emotion?",
      timestamp: Date.now()
    }];
  });

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showStartBtn, setShowStartBtn] = useState(false);

  useEffect(() => {
    const triggerInitialResponse = async () => {
      if (initialPrompt && initialPrompt.trim() && !hasInitialized.current) {
        hasInitialized.current = true;
        setIsLoading(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 800)); 
            const response = await sendDirectorMessage([{ role: 'user', text: initialPrompt, timestamp: Date.now() }], activeStory, initialPrompt);
            setMessages(prev => [...prev, { role: 'model', text: response, timestamp: Date.now() }]);
            setTimeout(() => setShowStartBtn(true), 600);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'model', text: "Ready to proceed.", timestamp: Date.now() }]);
            setShowStartBtn(true);
        } finally {
            setIsLoading(false);
        }
      }
    };
    triggerInitialResponse();
  }, [initialPrompt, activeStory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Fix: Explicitly type 'file' as File to resolve unknown type errors in URL.createObjectURL and readAsDataURL
    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newAttachment: Attachment = {
          id: Math.random().toString(36).substr(2, 9),
          url: URL.createObjectURL(file),
          type: file.type,
          data: reader.result as string
        };
        setAttachments(prev => [...prev, newAttachment]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;
    
    const userMessage: Message = { 
      role: 'user', 
      text: input, 
      attachments: [...attachments],
      timestamp: Date.now() 
    };
    
    setMessages(prev => [...prev, userMessage]);
    setAttachments([]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await sendDirectorMessage(messages, activeStory, input);
      setMessages(prev => [...prev, { role: 'model', text: response, timestamp: Date.now() }]);
      if (!showStartBtn) setShowStartBtn(true);
    } catch (error) {
       setMessages(prev => [...prev, { role: 'model', text: "Synchronized.", timestamp: Date.now() }]);
       if (!showStartBtn) setShowStartBtn(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-transparent text-white animate-in fade-in duration-1000 overflow-hidden">
      
      {/* Background Context Layer - Ensures Glassmorphism is visible */}
      <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-5%] left-[20%] w-[60vw] h-[60vh] bg-blue-500/10 blur-[160px] rounded-full"></div>
          <div className="absolute bottom-[0%] right-[10%] w-[50vw] h-[50vh] bg-orange-500/5 blur-[140px] rounded-full"></div>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[60px]"></div>
      </div>

      {/* Header */}
      <header className="relative z-50 h-24 flex items-center justify-between px-8 md:px-16 w-full max-w-6xl mx-auto border-b border-white/5">
        <div className="flex flex-col">
            <span className="text-[10px] font-black tracking-[0.6em] text-white/30 uppercase mb-1">Session</span>
            <h2 className="text-lg font-light tracking-widest text-white/80 uppercase">Director Phase</h2>
        </div>
        {onBack && (
            <button 
                onClick={onBack}
                className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center transition-all group"
            >
                <X className="w-5 h-5 text-white/40 group-hover:text-white transition-colors" />
            </button>
        )}
      </header>

      {/* Chat Messages */}
      <main className="flex-1 relative w-full max-w-2xl mx-auto flex flex-col overflow-hidden z-40">
        <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-10 space-y-10 no-scrollbar flex flex-col"
        >
            <div className="flex-1 min-h-[40px]"></div>

            {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-4 fade-in duration-700`}>
                    <div className={`text-[8px] font-black uppercase tracking-[0.4em] mb-3 opacity-20 ${m.role === 'user' ? 'mr-3' : 'ml-3'}`}>
                        {m.role === 'user' ? 'Auteur' : 'Directeur'}
                    </div>
                    
                    <div className={`max-w-[90%] px-7 py-5 text-[15px] leading-relaxed tracking-tight transition-all duration-700 ${
                        m.role === 'user' 
                        ? 'bg-white text-black font-semibold rounded-[28px] rounded-tr-none shadow-2xl' 
                        : 'bg-white/[0.04] border border-white/10 text-white/80 font-light rounded-[28px] rounded-tl-none backdrop-blur-3xl'
                    }`}>
                        {m.text}

                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mt-5 flex flex-wrap gap-3">
                            {m.attachments.map(att => (
                              <div key={att.id} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                                {att.type.startsWith('image/') ? (
                                  <img src={att.url} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <FileText className="w-10 h-10 text-white/10" />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                </div>
            ))}

            {isLoading && (
                <div className="flex flex-col items-start animate-in fade-in duration-500">
                    <div className="text-[8px] font-black uppercase tracking-[0.4em] mb-3 opacity-20 ml-3">Directeur</div>
                    <div className="px-6 py-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center gap-3">
                        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce"></div>
                        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:200ms]"></div>
                        <div className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:400ms]"></div>
                    </div>
                </div>
            )}
            
            <div className="min-h-[140px]"></div>
        </div>
      </main>

      {/* Control Area */}
      <footer className="relative z-[60] w-full max-w-2xl mx-auto px-6 pb-12 pt-6 flex flex-col gap-6">
        
        {attachments.length > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar animate-in slide-in-from-bottom-4 fade-in duration-500">
            {attachments.map(att => (
              <div key={att.id} className="relative group flex-shrink-0">
                <div className="w-24 h-24 rounded-2xl overflow-hidden border border-white/20 bg-black/40 backdrop-blur-2xl shadow-2xl">
                  {att.type.startsWith('image/') ? (
                    <img src={att.url} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="w-8 h-8 text-white/20" />
                    </div>
                  )}
                </div>
                <button 
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -top-2 -right-2 w-7 h-7 bg-white text-black rounded-full flex items-center justify-center shadow-2xl hover:scale-110 z-10 transition-transform"
                >
                  <X className="w-4 h-4" strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4 w-full">
            <div className="relative group">
                <div className="absolute -inset-1 bg-white/5 rounded-[36px] blur-xl opacity-0 group-focus-within:opacity-100 transition duration-1000"></div>
                <div className="relative bg-[#0a0a0a] border border-white/10 rounded-[32px] flex items-center px-6 py-2 shadow-2xl transition-all duration-700 group-focus-within:border-white/30">
                    
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 text-white/20 hover:text-white/60 transition-colors"
                    >
                      <Paperclip className="w-6 h-6" />
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      multiple 
                      accept="image/*"
                    />

                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Refine the visual language..."
                        className="flex-1 bg-transparent border-none outline-none text-base font-light tracking-wide text-white placeholder-white/5 h-14"
                    />
                    
                    <button 
                        onClick={handleSend}
                        disabled={!input.trim() && attachments.length === 0}
                        className="ml-4 w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-500 disabled:opacity-5 disabled:scale-100 shadow-2xl"
                    >
                        <ArrowUp className="w-6 h-6" strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {isSetupMode && (
                <div className={`transition-all apple-ease duration-[1200ms] ${
                    showStartBtn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
                }`}>
                    <button 
                        onClick={() => onStartGeneration?.(messages)}
                        className="group relative w-full h-[72px] bg-white text-black rounded-[32px] text-[11px] font-black uppercase tracking-[0.6em] transition-all duration-700 shadow-[0_0_60px_rgba(255,255,255,0.1)] hover:shadow-[0_0_80px_rgba(255,255,255,0.3)] flex items-center justify-center gap-4 overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                        <Sparkles className="w-5 h-5 fill-current" />
                        <span>Initialize Studio</span>
                    </button>
                </div>
            )}
        </div>

        <div className={`text-center text-[8px] text-white/10 font-black uppercase tracking-[0.8em] transition-opacity duration-1000 ${showStartBtn ? 'opacity-100' : 'opacity-0'}`}>
            System Ready • Project Alpha-1
        </div>
      </footer>
    </div>
  );
};

export default ChatInterface;
