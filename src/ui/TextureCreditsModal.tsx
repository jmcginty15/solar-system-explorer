import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { TEXTURE_CREDIT_GROUPS } from "../data/textureCredits";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Compact texture provenance by source domain. */
export function TextureCreditsModal({ open, onClose }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const host =
    typeof document !== "undefined"
      ? (document.querySelector(".app-shell") ?? document.body)
      : null;
  if (!host) return null;

  return createPortal(
    <div
      className="system-select-overlay texture-credits-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="system-select-dialog texture-credits-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="system-select-header">
          <h2 id={titleId} className="system-select-title">
            Texture Credits
          </h2>
          <button
            type="button"
            className="hud-btn hud-btn-icon system-select-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <svg
              className="hud-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5z" />
            </svg>
          </button>
        </header>
        <div className="texture-credits-body">
          {TEXTURE_CREDIT_GROUPS.map((group) => (
            <section key={group.id} className="texture-credits-group">
              <h3 className="texture-credits-group-title">
                {group.url ? (
                  <a href={group.url} target="_blank" rel="noopener noreferrer">
                    {group.domain}
                  </a>
                ) : (
                  group.domain
                )}
              </h3>
              <ul className="texture-credits-list">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    host,
  );
}
