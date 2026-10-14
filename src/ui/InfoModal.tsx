import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { TextureCreditsModal } from "./TextureCreditsModal";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Brief about dialog for Solar System Explorer. */
export function InfoModal({ open, onClose }: Props) {
  const titleId = useId();
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setCreditsOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (creditsOpen) {
          setCreditsOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, creditsOpen]);

  if (!open) return null;

  const host =
    typeof document !== "undefined"
      ? (document.querySelector(".app-shell") ?? document.body)
      : null;
  if (!host) return null;

  return (
    <>
      {createPortal(
        <div
          className="system-select-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creditsOpen) onClose();
          }}
        >
          <div
            className="system-select-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-hidden={creditsOpen || undefined}
          >
            <header className="system-select-header">
              <h2 id={titleId} className="system-select-title">
                About
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
            <div className="info-modal-body">
              <p>
                Solar System Explorer is an interactive 3D atlas of planetary
                systems. Explore our Solar System with high-fidelity
                ephemerides, or switch to nearby exoplanet systems such as
                TRAPPIST-1, HD 110067, HD 10180, HD 219134, and Kepler-90 to
                compare their scales, orbits, and worlds side by side.
              </p>
              <p>
                Scrub time from realtime to centuries per second, focus any body
                or system barycenter, and toggle name tags and orbit paths.
                Selection details show masses, sizes, orbital elements, and
                other catalog facts so you can inspect each object as you
                navigate.
              </p>
              <p>
                This simulator is intended for entertainment purposes and is not
                intended to be 100% scientifically accurate. Some assumptions
                and speculations have been made where hard data is lacking.
              </p>
              <p>
                For our own Solar System, real initial conditions (positions and
                velocities) are generated at the selected epoch from SPK files
                downloaded from{" "}
                <a
                  href="https://ssd.jpl.nasa.gov/horizons/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  NASA&apos;s JPL Horizons System
                </a>
                . For extrasolar stellar systems, initial conditions are
                generated from the best available orbital data in the{" "}
                <a
                  href="https://exoplanetarchive.ipac.caltech.edu/index.html"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  NASA Exoplanet Archive
                </a>
                . Data for extrasolar systems is necessarily more speculative
                and less precise that for our own solar system.
              </p>
              <div className="info-modal-footer">
                <button
                  type="button"
                  className="hud-btn info-modal-credits-btn"
                  onClick={() => setCreditsOpen(true)}
                >
                  Texture Credits
                </button>
              </div>
            </div>
          </div>
        </div>,
        host,
      )}
      <TextureCreditsModal
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
      />
    </>
  );
}
