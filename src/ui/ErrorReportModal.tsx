import { useEffect, useId, useState, type ReactNode } from "react";
import {
  formatEccentricityDelta,
  formatInclinationDeltaDeg,
  formatLengthError,
  formatVelocityError,
  lengthUnitForMagnitude,
  statusLabel,
  type BodyErrorRow,
  type ErrorReport,
} from "../ephemeris/errorReport";
import { formatSimDatetime } from "../ephemeris/time";

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  report: ErrorReport | null;
  onClose: () => void;
};

const TOOLTIP = {
  absDr:
    "How far the simulated body is from where the SPK ephemeris says it should be right now. Large values usually mean the n-body integration has drifted in phase or orbit shape since the last epoch load.",
  absDv:
    "How different the simulated speed/direction is from the SPK velocity. Velocity error often shows up before position error grows large, and it drives further drift as time advances.",
  deltaA:
    "Change in orbital size (semimajor axis). Positive means the sim orbit is larger than SPK’s; this is a shape/energy error, not just being ahead or behind on the same path.",
  deltaE:
    "Change in how elongated the orbit is. Near zero means the sim and SPK agree on shape; growing |Δe| means the ellipse itself is wrong, not only the body’s place along it.",
  deltaI:
    "Change in the orbit’s tilt relative to the reference plane. Nonzero values mean the simulated orbital plane has tipped away from the SPK plane.",
  status:
    "Whether a full comparison was possible. “Missing API/sim” means one side lacked a state; “Degenerate els” means orbital elements could not be formed (e.g. nearly singular geometry).",
  maxDr:
    "Worst-case spatial miss in the catalog: the body that is farthest from its SPK position. Use this as a quick “how bad can it get?” check at this epoch.",
  medianDr:
    "Typical spatial miss across the catalog. More robust than the max when a single moon or comet is wildly off while most planets are still close.",
  maxDv:
    "Worst-case velocity miss in the catalog. High values flag bodies whose future paths will diverge fastest even if they look near the right place today.",
  aboveRe:
    "How many bodies are off by more than one Earth radius (~6,371 km). A practical tally of “meaningfully wrong” positions, not just numerically nonzero ones.",
  radial:
    "Error toward or away from the orbital center. Positive means the sim is farther out than SPK; this often tracks a wrong orbital size or energy.",
  alongTrack:
    "Error along the direction of motion. Dominates when the body is early or late on roughly the right path (phase / timing drift).",
  crossTrack:
    "Error out of the orbital plane. Large values mean the simulated path has the wrong tilt or node, not just the wrong place along the ellipse.",
} as const;

function TipLabel({
  className,
  tip,
  role,
  children,
}: {
  className?: string;
  tip: string;
  role?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={"error-report-tip" + (className ? ` ${className}` : "")}
      data-tooltip={tip}
      aria-label={tip}
      role={role}
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="error-report-stat">
      <TipLabel className="error-report-stat-label" tip={tip}>
        {label}
      </TipLabel>
      <span className="error-report-stat-value">{value}</span>
    </div>
  );
}

function ExpandedDetail({ row }: { row: BodyErrorRow }) {
  const unit = lengthUnitForMagnitude(row.positionErrorM);
  return (
    <div className="error-report-detail">
      {row.rtnM ? (
        <dl className="error-report-rtn">
          <div>
            <dt>
              <TipLabel tip={TOOLTIP.radial}>Radial</TipLabel>
            </dt>
            <dd>{formatLengthError(row.rtnM.radialM, unit)}</dd>
          </div>
          <div>
            <dt>
              <TipLabel tip={TOOLTIP.alongTrack}>Along-track</TipLabel>
            </dt>
            <dd>{formatLengthError(row.rtnM.alongTrackM, unit)}</dd>
          </div>
          <div>
            <dt>
              <TipLabel tip={TOOLTIP.crossTrack}>Cross-track</TipLabel>
            </dt>
            <dd>{formatLengthError(row.rtnM.crossTrackM, unit)}</dd>
          </div>
        </dl>
      ) : (
        <p className="error-report-detail-note">
          RTN decomposition unavailable (degenerate orbital frame).
        </p>
      )}
      <p className="error-report-detail-note">
        Element deltas are osculating values about the live orbital parent /
        barycenter (sim − SPK).
      </p>
    </div>
  );
}

export function ErrorReportModal({
  open,
  loading,
  error,
  report,
  onClose,
}: Props) {
  const titleId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setExpandedId(null);
      return;
    }
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

  const lengthUnit = lengthUnitForMagnitude(
    report?.summary.maxPositionErrorM ?? null,
  );

  return (
    <div
      className="error-report-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="error-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="error-report-header">
          <div className="error-report-header-text">
            <h2 id={titleId} className="error-report-title">
              Error Report
            </h2>
            {report ? (
              <p className="error-report-subtitle">
                Sim vs SPK at {formatSimDatetime(report.simJd)} ·{" "}
                {report.summary.comparedCount} compared
                {report.summary.missingApiCount > 0
                  ? ` · ${report.summary.missingApiCount} missing from API`
                  : ""}
              </p>
            ) : (
              <p className="error-report-subtitle">
                Comparing n-body state to ephemeris at the current simulation
                time.
              </p>
            )}
          </div>
          <button
            type="button"
            className="hud-btn hud-btn-icon error-report-close"
            onClick={onClose}
            aria-label="Close error report"
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

        {loading && (
          <p className="error-report-status" role="status">
            Fetching ephemeris states…
          </p>
        )}

        {!loading && error && (
          <p
            className="error-report-status error-report-status-error"
            role="alert"
          >
            {error}
          </p>
        )}

        {!loading && !error && report && (
          <>
            <div className="error-report-summary">
              <SummaryStat
                label="Max |Δr|"
                tip={TOOLTIP.maxDr}
                value={formatLengthError(
                  report.summary.maxPositionErrorM,
                  lengthUnit,
                )}
              />
              <SummaryStat
                label="Median |Δr|"
                tip={TOOLTIP.medianDr}
                value={formatLengthError(
                  report.summary.medianPositionErrorM,
                  lengthUnit,
                )}
              />
              <SummaryStat
                label="Max |Δv|"
                tip={TOOLTIP.maxDv}
                value={formatVelocityError(report.summary.maxVelocityErrorMS)}
              />
              <SummaryStat
                label="|Δr| > R⊕"
                tip={TOOLTIP.aboveRe}
                value={String(report.summary.aboveEarthRadiusCount)}
              />
            </div>

            <p className="error-report-note">
              Position and velocity are absolute (SSB, invariable frame).
              Element deltas use the same parent/barycenter frame as orbit
              ellipses. Drift accumulates from n-body propagation after the last
              epoch load.
            </p>

            <div
              className="error-report-table-wrap"
              role="table"
              aria-label="Per-body ephemeris error"
            >
              <div className="error-report-table">
                <div
                  className="error-report-row-grid error-report-head"
                  role="row"
                >
                  <span role="columnheader">Body</span>
                  <TipLabel tip={TOOLTIP.absDr} role="columnheader">
                    |Δr|
                  </TipLabel>
                  <TipLabel tip={TOOLTIP.absDv} role="columnheader">
                    |Δv|
                  </TipLabel>
                  <TipLabel tip={TOOLTIP.deltaA} role="columnheader">
                    Δa
                  </TipLabel>
                  <TipLabel tip={TOOLTIP.deltaE} role="columnheader">
                    Δe
                  </TipLabel>
                  <TipLabel tip={TOOLTIP.deltaI} role="columnheader">
                    Δi
                  </TipLabel>
                  <TipLabel tip={TOOLTIP.status} role="columnheader">
                    Status
                  </TipLabel>
                </div>
                {report.rows.map((row) => {
                  const expanded = expandedId === row.bodyId;
                  return (
                    <div
                      key={row.bodyId}
                      className={
                        "error-report-row" +
                        (expanded ? " is-expanded" : "") +
                        (row.status !== "ok" &&
                        row.status !== "degenerate_elements"
                          ? " is-muted"
                          : "")
                      }
                      role="row"
                    >
                      <button
                        type="button"
                        className="error-report-row-btn"
                        onClick={() =>
                          setExpandedId(expanded ? null : row.bodyId)
                        }
                        aria-expanded={expanded}
                      >
                        <span className="error-report-row-grid">
                          <span className="error-report-body-name" role="cell">
                            {row.name}
                          </span>
                          <span role="cell">
                            {formatLengthError(row.positionErrorM, lengthUnit)}
                          </span>
                          <span role="cell">
                            {formatVelocityError(row.velocityErrorMS)}
                          </span>
                          <span role="cell">
                            {formatLengthError(
                              row.deltaSemiMajorAxisM,
                              lengthUnitForMagnitude(row.deltaSemiMajorAxisM),
                            )}
                          </span>
                          <span role="cell">
                            {formatEccentricityDelta(row.deltaEccentricity)}
                          </span>
                          <span role="cell">
                            {formatInclinationDeltaDeg(row.deltaInclinationRad)}
                          </span>
                          <span
                            className="error-report-status-cell"
                            role="cell"
                          >
                            {statusLabel(row.status)}
                          </span>
                        </span>
                      </button>
                      {expanded && <ExpandedDetail row={row} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
