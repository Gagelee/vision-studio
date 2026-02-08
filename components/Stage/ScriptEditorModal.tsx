import React, { useMemo } from 'react';
import { X, BookText, Copy } from 'lucide-react';
import { ElementType, Shot, Story } from '../../types';

interface ScriptEditorModalProps {
  story: Story;
  onClose: () => void;
  onUpdateShot: (shot: Shot) => void;
}

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({ story, onClose, onUpdateShot }) => {
  const getScript = (shot: Shot) => String(shot.elements?.[ElementType.SCRIPT]?.prompt || '').trim();

  const fullScript = useMemo(() => {
    return story.sequences
      .map((seq, seqIdx) => {
        const header = `SEQUENCE ${seqIdx + 1}: ${seq.title}`;
        const context = seq.context ? `Context: ${seq.context}` : '';
        const shots = seq.shots
          .map((shot) => {
            const script = getScript(shot);
            return [
              `SHOT ${shot.sequence}: ${shot.description}`,
              script || '[No script yet]',
            ].join('\n');
          })
          .join('\n\n');
        return [header, context, shots].filter(Boolean).join('\n');
      })
      .join('\n\n');
  }, [story]);

  const handleScriptChange = (shot: Shot, value: string) => {
    onUpdateShot({
      ...shot,
      elements: {
        ...shot.elements,
        [ElementType.SCRIPT]: {
          ...shot.elements?.[ElementType.SCRIPT],
          prompt: value,
          status: 'manual',
        },
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[980px] max-w-[95vw] max-h-[90vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
              <BookText className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Script Editor</div>
              <div className="text-[11px] text-zinc-500">Preview and edit screenplay text across all shots</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigator.clipboard?.writeText(fullScript)}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 hover:bg-indigo-500 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Full Script
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Full Script (Read-only)</div>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-zinc-700 dark:text-zinc-200">
              {fullScript || 'No script available yet.'}
            </pre>
          </div>

          {story.sequences.map((seq, seqIdx) => (
            <div key={seq.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded">
                  Story Part {seqIdx + 1}
                </span>
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{seq.title}</span>
              </div>
              {seq.context && (
                <div className="text-[11px] text-zinc-500 mb-4">{seq.context}</div>
              )}

              <div className="space-y-4">
                {seq.shots.map((shot) => (
                  <div key={shot.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Shot {shot.sequence}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate max-w-[60%]">{shot.description}</div>
                    </div>
                    <textarea
                      value={getScript(shot)}
                      onChange={(e) => handleScriptChange(shot, e.target.value)}
                      rows={4}
                      placeholder="Write screenplay-style action + dialogue here..."
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-[11px] text-zinc-700 dark:text-zinc-200 p-2"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
