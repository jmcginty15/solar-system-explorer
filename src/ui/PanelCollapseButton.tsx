type PanelCollapseSide = "left" | "right" | "bottom";

type PanelCollapseButtonProps = {
  side: PanelCollapseSide;
  collapsed: boolean;
  onToggle: () => void;
  label: string;
};

function chevronPoints(side: PanelCollapseSide, collapsed: boolean): string {
  // Points toward the collapse direction when expanded; reverses when collapsed.
  if (side === "left") {
    return collapsed ? "9 4 15 12 9 20" : "15 4 9 12 15 20";
  }
  if (side === "right") {
    return collapsed ? "15 4 9 12 15 20" : "9 4 15 12 9 20";
  }
  return collapsed ? "4 14 12 8 20 14" : "4 10 12 16 20 10";
}

export function PanelCollapseButton({
  side,
  collapsed,
  onToggle,
  label,
}: PanelCollapseButtonProps) {
  const action = collapsed ? "Expand" : "Collapse";
  const title = `${action} ${label}`;

  return (
    <button
      type="button"
      className={`panel-collapse-btn is-${side}`}
      aria-expanded={!collapsed}
      aria-label={title}
      title={title}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <polyline
          points={chevronPoints(side, collapsed)}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
