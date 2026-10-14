import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import {
  STELLAR_SYSTEM_ORDER,
  STELLAR_SYSTEMS,
  stellarSystemInventory,
  type StellarSystemId,
} from "../data";

function systemBlurb(id: StellarSystemId): string {
  switch (id) {
    case "sol": {
      const {
        planetCount,
        dwarfPlanetCount,
        moonCount,
        asteroidCount,
        cometCount,
      } = stellarSystemInventory("sol");
      return (
        "Our home planetary system around the Sun. " +
        `Simulation currently features ${planetCount} planets, ${dwarfPlanetCount} dwarf planets, ${moonCount} moons, ${asteroidCount} asteroids, and ${cometCount} comets. ` +
        "Stay tuned for more objects being added in the future."
      );
    }
    case "trappist-1":
      return "Ultra-cool red dwarf star about 40.66 light-years away in the constellation Aquarius. Features seven Earth-sized planets packed into an orbit less than a sixth the size of Mercury's orbit around our Sun.";
    case "hd-110067":
      return "K-type main-sequence star about 105.1 light-years away in the constellation Coma Berenices. Host of a resonant system of six sub-Neptunes packed into an orbit smaller than Mercury's orbit around our Sun.";
    case "hd-10180":
      return "Sun-like star about 127.1 light-years away in the constellation Hydrus. Host of a compact multi-planet system discovered via radial velocity.";
    case "hd-219134":
      return "Orange dwarf star about 21.3 light-years away in the constellation Cassiopeia. Host of a compact multi-planet system including two known transiting rocky worlds.";
    case "kepler-90":
      return "F-type star about 2,790 light-years away in the constellation Draco. Host of an eight-planet system with the same planet count as our Solar System, all closer to their star than Earth is to our Sun.";
  }
}

type Props = {
  open: boolean;
  value: StellarSystemId;
  onChange: (systemId: StellarSystemId) => void;
  onClose: () => void;
};

export function SystemSelectModal({ open, value, onChange, onClose }: Props) {
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
      className="system-select-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="system-select-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="system-select-header">
          <h2 id={titleId} className="system-select-title">
            Select System
          </h2>
          <button
            type="button"
            className="hud-btn hud-btn-icon system-select-close"
            onClick={onClose}
            aria-label="Close system selector"
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

        <ul className="system-select-list" role="listbox" aria-label="Systems">
          {STELLAR_SYSTEM_ORDER.map((id) => {
            const selected = id === value;
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    "system-select-option" + (selected ? " is-selected" : "")
                  }
                  onClick={() => {
                    onChange(id);
                    onClose();
                  }}
                >
                  <span className="system-select-option-name">
                    {STELLAR_SYSTEMS[id].name}
                  </span>
                  <span className="system-select-option-blurb">
                    {systemBlurb(id)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    host,
  );
}
