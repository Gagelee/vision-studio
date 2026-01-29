
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  rightElement?: React.ReactNode;
}

export const Collapsible: React.FC<CollapsibleProps> = ({ 
  title, 
  icon, 
  defaultOpen = false, 
  children,
  className = "",
  rightElement
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border-b border-zinc-800 last:border-0 ${className}`}>
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-zinc-900/50 transition-colors select-none group"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300 group-hover:text-zinc-100">
          <div className="text-zinc-500 group-hover:text-zinc-400">
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
          {icon && <div className="text-indigo-400">{icon}</div>}
          {title}
        </div>
        {rightElement && <div>{rightElement}</div>}
      </div>
      {isOpen && (
        <div className="pb-1">
          {children}
        </div>
      )}
    </div>
  );
};
