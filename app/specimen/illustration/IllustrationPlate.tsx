"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./lightbox.css";

type IllustrationPlateProps = {
  src: string;
  alt: string;
  className?: string;
};

export default function IllustrationPlate({ src, alt, className = "" }: IllustrationPlateProps) {
  const [open, setOpen] = useState(false);
  const resolvedSrc = useMemo(
    () => src.replace(/^\/specimen\/illustration\//, "/media/specimen-illustration/"),
    [src],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`illus-preview-button ${className}`.trim()}
        onClick={() => setOpen(true)}
        aria-label={`Open ${alt} full screen`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolvedSrc} alt={alt} className="illus-preview-image" />
        <span className="illus-expand-hint" aria-hidden="true">open plate ↗</span>
      </button>

      {open && createPortal(
        <div className="illus-lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
          <button type="button" className="illus-lightbox-close" onClick={() => setOpen(false)} aria-label="Close full screen image">
            close ×
          </button>
          <div className="illus-lightbox-stage" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolvedSrc} alt={alt} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
