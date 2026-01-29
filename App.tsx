
import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Layout/Sidebar';
import { StageView } from './components/Stage/StageView';
import { LocationEditor } from './components/Stage/LocationEditor';
import { CharacterEditor } from './components/Stage/CharacterEditor';
import { ShotEditor } from './components/Stage/ShotEditor';
import { ProjectDashboard } from './components/Stage/ProjectDashboard';
import { InspectorPanel } from './components/Inspector/InspectorPanel';
import { DirectorConsole } from './components/Console/DirectorConsole';
import { ProjectCreationWizard } from './components/Stage/ProjectCreationWizard';
import { MasterPlayer } from './components/Player/MasterPlayer';
import { INITIAL_STORY } from './constants';
import { SelectionState, Story, AspectRatio, Location, Character, Shot, ElementType, DialogueLine, Sequence, AgentLogEntry } from './types';
import { CheckCircle, Info, X, Play } from 'lucide-react';

export default function App() {
  const [story, setStory] = useState<Story | null>(INITIAL_STORY);
  const [selection, setSelection] = useState<SelectionState>({ 
    type: 'story', 
    id: INITIAL_STORY.id 
  });
  
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const [toasts, setToasts] = useState<Array<{id: string, message: string, type: 'success' | 'info'}>>([]);
  const [agentHistory, setAgentHistory] = useState<AgentLogEntry[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const addToast = (message: string, type: 'success' | 'info' = 'info') => {
      const id = Math.random().toString(36).substring(7);
      setToasts(prev => [...prev, { id, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const handleCreateProject = (intent: string, ratio: AspectRatio) => {
    setSelection({ type: 'creation', id: 'new' });
    setTimeout(() => {
        const newStory: Story = {
            ...INITIAL_STORY,
            id: `proj-${Date.now()}`,
            title: intent.split(' ').slice(0, 3).join(' ') || 'New Masterpiece',
            intent: intent,
            logline: `An AI-generated epic based on: "${intent}"`,
            aspectRatio: ratio,
            status: 'ready'
        };
        setStory(newStory);
        setSelection({ type: 'story', id: newStory.id });
        addToast("Project scaffolded by Director AI", "success");
    }, 4500);
  };

  const handleSelect = (sel: SelectionState) => setSelection(sel);

  // --- Asset Management Handlers ---

  const handleCreateLocation = () => {
    const newId = `loc-${Date.now()}`;
    const newLoc: Location = {
      id: newId,
      name: 'New Environment',
      description: 'Describe the atmospheric details...',
      visualStyle: 'Cinematic style details...',
      previewUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=2148&auto=format&fit=crop',
      status: 'draft'
    };
    setStory(prev => prev ? ({ ...prev, locations: [...prev.locations, newLoc] }) : null);
    setSelection({ type: 'location', id: newId });
    addToast("New environment added to library", "success");
  };

  const handleCreateCharacter = () => {
    const newId = `char-${Date.now()}`;
    const newChar: Character = {
      id: newId,
      name: 'New Character',
      description: 'Describe physical traits and personality...',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1287&auto=format&fit=crop',
      status: 'draft',
      looks: []
    };
    setStory(prev => prev ? ({ ...prev, characters: [...prev.characters, newChar] }) : null);
    setSelection({ type: 'character', id: newId });
    addToast("New character casted", "success");
  };

  const handleUpdateLocation = (loc: Location) => {
    setStory(prev => prev ? ({ ...prev, locations: prev.locations.map(l => l.id === loc.id ? loc : l) }) : null);
    addToast("Environment updated", "info");
  };

  const handleUpdateCharacter = (char: Character) => {
    setStory(prev => prev ? ({ ...prev, characters: prev.characters.map(c => c.id === char.id ? char : c) }) : null);
    addToast("Character profile updated", "info");
  };

  const handleDeleteLocation = (id: string) => {
    setStory(prev => prev ? ({ ...prev, locations: prev.locations.filter(l => l.id !== id) }) : null);
    setSelection({ type: 'story', id: story?.id || '' });
    addToast("Environment removed", "info");
  };

  const handleDeleteCharacter = (id: string) => {
    setStory(prev => prev ? ({ ...prev, characters: prev.characters.filter(c => c.id !== id) }) : null);
    if (selection.type === 'character' && selection.id === id) {
        setSelection({ type: 'story', id: story?.id || '' });
    }
    addToast("Character removed from casting", "info");
  };

  // --- Core Story Handlers ---

  const handleSequenceUpdate = (updatedSeq: Sequence) => {
    if (!story) return;
    setStory({
      ...story,
      sequences: story.sequences.map(s => s.id === updatedSeq.id ? updatedSeq : s)
    });
  };

  const handleShotUpdate = (updatedShot: Shot) => {
    if (!story) return;
    setStory({
      ...story,
      sequences: story.sequences.map(seq => {
        // Find if shot belongs to this sequence
        if (seq.shots.some(s => s.id === updatedShot.id)) {
           return {
             ...seq,
             shots: seq.shots.map(s => s.id === updatedShot.id ? updatedShot : s)
           };
        }
        return seq;
      })
    });
  };

  const handleCastingUpdate = (shotId: string, seqId: string, newCharacters: Character[]) => {
    if (!story) return;
    const updatedSequences = story.sequences.map(seq => {
        if (seq.id !== seqId) return seq;
        return {
            ...seq,
            shots: seq.shots.map(shot => {
                if (shot.id !== shotId) return shot;
                return {
                    ...shot,
                    elements: {
                        ...shot.elements,
                        [ElementType.CASTING]: {
                            ...shot.elements[ElementType.CASTING],
                            metadata: {
                                ...shot.elements[ElementType.CASTING].metadata,
                                characters: newCharacters
                            },
                            status: 'manual' as const
                        }
                    }
                };
            })
        };
    });
    setStory({ ...story, sequences: updatedSequences });
  };

  const handleCharacterPromptChange = (shotId: string, seqId: string, charId: string, prompt: string) => {
      // Placeholder for visual prompt overrides per shot
      console.log('Update char prompt', shotId, charId, prompt);
  };

  const handleScriptUpdate = (shotId: string, seqId: string, dialogue: DialogueLine[]) => {
      // Placeholder for script updates
      console.log('Update script', shotId, dialogue);
  };

  // --- Agent & Console Handlers ---

  const handleDirectorMessage = (msg: string) => {
    // Add user message
    const userEntry: AgentLogEntry = {
        id: Date.now().toString(),
        role: 'user',
        content: msg,
        timestamp: Date.now()
    };
    setAgentHistory(prev => [...prev, userEntry]);

    // Simulate Agent Response
    setTimeout(() => {
        const agentEntry: AgentLogEntry = {
            id: (Date.now() + 1).toString(),
            role: 'agent',
            content: `I've analyzed your request: "${msg}". Updating the scene parameters to match this directive.`,
            timestamp: Date.now(),
            actionDetails: { type: 'UPDATE_SHOT_PARAMETERS' }
        };
        setAgentHistory(prev => [...prev, agentEntry]);
        addToast("Director AI executed changes", "success");
    }, 1500);
  };

  // --- Render Helpers ---

  const getActiveItem = () => {
      if (!story) return null;
      switch (selection.type) {
          case 'sequence': return story.sequences.find(s => s.id === selection.id);
          case 'shot': 
             // Find shot across all sequences
             for (const seq of story.sequences) {
                 const shot = seq.shots.find(s => s.id === selection.id);
                 if (shot) return shot;
             }
             return null;
          case 'location': return story.locations.find(l => l.id === selection.id);
          case 'character': return story.characters.find(c => c.id === selection.id);
          default: return story;
      }
  };

  const activeItem = getActiveItem();
  
  // Find context location for shots
  const getContextLocation = () => {
     if (selection.type === 'shot' && story && activeItem) {
        const shot = activeItem as Shot;
        return story.locations.find(l => l.id === shot.locationId);
     }
     return undefined;
  };

  if (selection.type === 'creation') {
      return <ProjectCreationWizard onComplete={handleCreateProject} onCancel={() => setSelection({ type: 'story', id: INITIAL_STORY.id })} />;
  }

  if (!story) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Loading Vision Studio...</div>;

  return (
    <div className={`flex h-screen w-full overflow-hidden bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-300 ${isCinemaMode ? 'fullscreen-mode' : ''}`}>
      
      {/* Global Player Overlay */}
      {isPlayingMaster && (
          <MasterPlayer story={story} onClose={() => setIsPlayingMaster(false)} />
      )}

      {/* 1. Left Sidebar */}
      {!isCinemaMode && !isPlayingMaster && (
        <Sidebar 
            story={story} 
            selection={selection}
            theme={theme}
            toggleTheme={toggleTheme}
            onSelect={handleSelect}
            onCreateLocation={handleCreateLocation}
            onCreateCharacter={handleCreateCharacter}
            onCreateSequence={() => addToast("Sequence creation coming soon", "info")}
        />
      )}

      {/* 2. Middle Stage (Main Content) */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 overflow-hidden relative z-0">
            {selection.type === 'story' && (
                <ProjectDashboard 
                    story={story} 
                    onSelect={handleSelect} 
                    onPlayCinema={() => { setIsPlayingMaster(true); addToast("Starting Master Screen...", "success"); }}
                />
            )}
            
            {selection.type === 'sequence' && activeItem && (
                <StageView 
                    sequence={activeItem as Sequence}
                    allLocations={story.locations}
                    aspectRatio={story.aspectRatio}
                    isImmersive={isCinemaMode}
                    onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
                    onSelectShot={(id) => setSelection({ type: 'shot', id, parentId: (activeItem as Sequence).id })}
                    onAddShot={() => addToast("New shot added to sequence", "success")}
                    onDeleteShot={() => addToast("Shot removed", "info")}
                    onMoveShot={() => {}}
                    onUpdateShot={handleShotUpdate}
                    onBackToSequence={() => setSelection({ type: 'story', id: story.id })}
                    onEditLocation={() => {}}
                    onPlay={() => setIsPlayingMaster(true)}
                />
            )}

            {selection.type === 'shot' && activeItem && (
                <ShotEditor 
                    shot={activeItem as Shot}
                    aspectRatio={story.aspectRatio}
                    isImmersive={isCinemaMode}
                    onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
                    onUpdateShot={handleShotUpdate}
                    onBack={() => setSelection({ type: 'sequence', id: selection.parentId || story.sequences[0].id })}
                />
            )}

            {selection.type === 'location' && activeItem && (
                <LocationEditor 
                    location={activeItem as Location}
                    sequences={story.sequences}
                    onSave={handleUpdateLocation}
                    onPropagate={(id) => addToast("Changes propagated to 12 shots", "success")}
                    onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
                />
            )}

            {selection.type === 'character' && activeItem && (
                <CharacterEditor 
                    character={activeItem as Character}
                    sequences={story.sequences}
                    onSave={handleUpdateCharacter}
                    onPropagate={(id) => addToast("Look updated across scenes", "success")}
                    onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
                />
            )}
        </div>

        {/* Director Console Overlay */}
        {!isCinemaMode && !isPlayingMaster && (
            <div className="relative z-20">
                <DirectorConsole 
                    context={{ 
                        type: selection.type as any, 
                        label: activeItem ? (activeItem as any).title || (activeItem as any).name || (activeItem as any).description : story.title,
                        id: selection.id 
                    }}
                    history={agentHistory}
                    onSendMessage={handleDirectorMessage}
                />
            </div>
        )}
        
        {/* Floating Console for Cinema Mode */}
        {isCinemaMode && !isPlayingMaster && (
             <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
                 <DirectorConsole 
                    variant="floating"
                    context={{ type: 'shot', label: 'Cinema Mode', id: 'cinema' }}
                    history={agentHistory}
                    onSendMessage={handleDirectorMessage}
                />
             </div>
        )}
      </div>

      {/* 3. Right Inspector (Contextual) - STRICTLY LIMITED TO SHOTS */}
      {!isCinemaMode && !isPlayingMaster && (selection.type === 'shot') && (
         <InspectorPanel 
            selection={selection}
            selectedItem={activeItem}
            type={selection.type}
            contextLocation={getContextLocation()}
            availableLocations={story.locations}
            availableCharacters={story.characters}
            keyVisualUrl={story.keyVisualUrl}
            onCastingUpdate={handleCastingUpdate}
            onCharacterPromptChange={handleCharacterPromptChange}
            onScriptUpdate={handleScriptUpdate}
            onSequenceUpdate={handleSequenceUpdate}
            onShotUpdate={handleShotUpdate}
         />
      )}

      {/* Global Toast Notification */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
              <div key={toast.id} className="bg-zinc-900 text-white px-4 py-3 rounded-lg shadow-2xl border border-zinc-800 flex items-center gap-3 animate-in slide-in-from-right-10 fade-in duration-300">
                  {toast.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Info className="w-4 h-4 text-blue-500" />}
                  <span className="text-sm font-medium">{toast.message}</span>
              </div>
          ))}
      </div>

    </div>
  );
}
