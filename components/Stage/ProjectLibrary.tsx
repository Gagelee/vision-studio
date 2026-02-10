import React from 'react';
import { Plus, FolderOpen, Trash2, Copy, Pencil, Settings, Sun, Moon, Bug, Upload, Download } from 'lucide-react';
import { Story } from '../../types';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface ProjectLibraryProps {
  projects: Story[];
  currentUserId?: string;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
  onCreateDemoProject: () => void;
  onRenameProject: (projectId: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onExportProject: (projectId: string) => void;
  onImportProjects: () => void;
  onOpenAiSettings: () => void;
  onOpenDebug: () => void;
}

const formatDateTime = (ts?: number) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const ProjectLibrary: React.FC<ProjectLibraryProps> = ({
  projects,
  currentUserId,
  theme,
  toggleTheme,
  onOpenProject,
  onCreateProject,
  onCreateDemoProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onExportProject,
  onImportProjects,
  onOpenAiSettings,
  onOpenDebug,
}) => {
  return (
    <div className="min-h-screen w-full bg-white dark:bg-[#050505] text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
      {/* Top Bar */}
      <div className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-black/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 min-w-8 min-h-8 aspect-square shrink-0 rounded-full border border-zinc-300/80 dark:border-white/45 bg-white/90 dark:bg-white/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_20px_rgba(255,255,255,0.45)]">
              <div className="pointer-events-none absolute -inset-[4px] rounded-full bg-white/35 dark:bg-white/45 blur-[5px] opacity-70 animate-[pulse_2.8s_ease-in-out_infinite]"></div>
              <div className="absolute inset-[7px] rounded-full bg-zinc-900/90 dark:bg-white/90"></div>
            </div>
            <div className="leading-tight">
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">Shopee Vision Studio</div>
              <div className="text-sm font-bold tracking-tight">Project Library</div>
              <div className="text-[10px] font-mono tracking-wide text-zinc-400">User: {String(currentUserId || 'local')}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenDebug}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-300"
              title="Debug (Cmd/Ctrl+Shift+D)"
            >
              <Bug className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenAiSettings}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-300"
              title="AI Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-300"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={onCreateProject}
              className="ml-2 flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-300 dark:border-white/30 bg-[linear-gradient(145deg,#ffffff_0%,#e7edf6_52%,#c0cada_100%)] text-zinc-900 font-black uppercase tracking-widest text-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_12px_28px_rgba(0,0,0,0.22)] hover:brightness-[1.03] transition-all"
            >
              <Plus className="w-4 h-4" />
              Start Project
            </button>
            <button
              onClick={onImportProjects}
              className="ml-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold uppercase tracking-wider hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all"
              title="Import Project JSON"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-10">
        {projects.length === 0 ? (
          <div className="mt-16 rounded-[48px] border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-zinc-50 to-white dark:from-zinc-950 dark:to-black overflow-hidden shadow-sm">
            <div className="p-12 md:p-16">
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-400 mb-4">Local-first Workspace</div>
              <h1 className="text-5xl md:text-6xl font-black tracking-tighter leading-[0.95] mb-6">
                Create your first project
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 text-lg max-w-2xl leading-relaxed mb-10">
                Start from a one-sentence intent. The Agent will scaffold story structure, assets, and shots into a controllable workflow.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={onCreateProject}
                  className="flex items-center justify-center gap-3 px-10 py-5 border border-zinc-300 dark:border-white/30 bg-[linear-gradient(145deg,#ffffff_0%,#e7edf6_52%,#c0cada_100%)] text-zinc-900 rounded-2xl text-sm font-black uppercase tracking-widest transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_16px_34px_rgba(0,0,0,0.22)] hover:brightness-[1.03] hover:scale-[1.02] active:scale-[0.99]"
                >
                  <Plus className="w-5 h-5" />
                  Start Production
                </button>
                <button
                  onClick={onCreateDemoProject}
                  className="flex items-center justify-center gap-3 px-10 py-5 bg-white/60 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10 rounded-2xl text-sm font-bold transition-all backdrop-blur-xl"
                >
                  <FolderOpen className="w-5 h-5" />
                  Load Demo Project
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {projects
              .slice()
              .sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0))
              .map((p) => (
                <div
                  key={p.id}
                  className="group rounded-[36px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden hover:shadow-2xl hover:shadow-black/10 transition-all"
                >
                  <button onClick={() => onOpenProject(p.id)} className="w-full text-left">
                    <div className="relative h-56 overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent z-10"></div>
                      <img
                        src={p.keyVisualUrl}
                        alt={p.title}
                        className="w-full h-full object-cover transition-transform duration-[8s] ease-out group-hover:scale-110 cursor-zoom-in"
                        loading="lazy"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (p.keyVisualUrl) openLightbox({ url: p.keyVisualUrl, title: p.title });
                        }}
                      />
                      <div className="absolute bottom-5 left-6 right-6 z-20">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-xs font-black uppercase tracking-[0.3em] text-white/60">Format</div>
                            <div className="text-white font-mono font-black">{p.aspectRatio}</div>
                          </div>
                          <div className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white/80 text-[10px] font-black uppercase tracking-widest">
                            Local
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xl font-black tracking-tight truncate">{p.title}</div>
                        <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                          {p.logline}
                        </div>
                        <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          Updated {formatDateTime(p.updatedAt || p.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => onRenameProject(p.id)}
                          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          title="Rename"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDuplicateProject(p.id)}
                          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          title="Duplicate"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteProject(p.id)}
                          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onExportProject(p.id)}
                          className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          title="Export"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-6">
                      <button
                        onClick={() => onOpenProject(p.id)}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-black font-black uppercase tracking-widest text-[11px] hover:opacity-90 transition-all"
                      >
                        <FolderOpen className="w-4 h-4" />
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
