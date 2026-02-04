import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { closeLightbox, getLightboxImage, subscribeLightbox } from '../../lib/ui/lightboxStore';

export const ImageLightbox: React.FC = () => {
  const [img, setImg] = useState(() => getLightboxImage());

  useEffect(() => {
    return subscribeLightbox(() => setImg(getLightboxImage()));
  }, []);

  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [img]);

  if (!img) return null;

  return (
    <div
      className="fixed inset-0 z-[5000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={() => closeLightbox()}
    >
      <div className="relative max-w-[95vw] max-h-[90vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => closeLightbox()}
          className="absolute -top-2 -right-2 p-2 rounded-xl bg-white/10 border border-white/15 text-white hover:bg-white/20"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
        <img src={img.url} alt={img.title || 'preview'} className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" />
        {img.title && (
          <div className="absolute left-0 right-0 -bottom-10 text-center text-xs text-white/70 font-medium truncate">{img.title}</div>
        )}
      </div>
    </div>
  );
};

