import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import {
  BODY_CATALOG,
  STELLAR_SYSTEMS,
  type BodyData,
  type BodyId,
  type StellarSystemId,
} from "../data";
import {
  allTagFocusIds,
  isStellarBarycenterFocusId,
  type OrbitalParentMap,
} from "../simulation";
import { orbitBodyIds, type OrbitId } from "../scene/orbitEllipses";
import {
  buildBodyFocusGroups,
  entryHasDropdown,
  entryHeaderId,
  entryHeaderName,
  entryNestedBodies,
  filterBodyFocusGroups,
  flattenBodyFocusIds,
  focusTreeParentId,
  satelliteGroupExpandKey,
  satelliteGroupExpandKeyForBody,
  satelliteGroupSections,
  satelliteSectionsShowLabels,
  ungroupedSatellites,
  type BodyFocusEntry,
  type FocusId,
  type SatelliteGroupSection,
} from "./bodyFocusGroups";
import { InfoModal } from "./InfoModal";
import { PanelCollapseButton } from "./PanelCollapseButton";
import { SystemSelectModal } from "./SystemSelectModal";

type VisibilityTriState = "all" | "some" | "none";

type BodyFocusPickerProps = {
  value: FocusId;
  onChange: (focusId: FocusId) => void;
  /** Active star system (Sol vs TRAPPIST-1, …). */
  stellarSystemId: StellarSystemId;
  onStellarSystemChange: (systemId: StellarSystemId) => void;
  /**
   * Bodies that currently have ephemeris / are in the scene. When set, moons
   * without states are hidden and primaries with no available moons are shown
   * as singular bodies (not systems).
   */
  availableBodyIds?: ReadonlySet<BodyId> | null;
  /**
   * Live orbital parents from the n-body hierarchy. Drives capture / ejection
   * grouping in the selector.
   */
  parentByBodyId?: OrbitalParentMap | null;
  /** Body / planetary-system ids whose name tags are currently shown. */
  labelVisibleIds: ReadonlySet<FocusId>;
  onSetLabels: (ids: readonly FocusId[], visible: boolean) => void;
  onToggleAllLabels: (visible: boolean) => void;
  /** Body / planetary-system ids whose orbit ellipses are currently shown. */
  orbitVisibleIds: ReadonlySet<OrbitId>;
  onSetOrbits: (ids: readonly OrbitId[], visible: boolean) => void;
  onToggleAllOrbits: (visible: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function optionClassName(selected: boolean, active: boolean): string {
  return (
    "focus-picker-option" +
    (selected ? " is-selected" : "") +
    (active ? " is-active" : "")
  );
}

function visibilityTriState(
  ids: readonly string[],
  visible: ReadonlySet<string>,
): VisibilityTriState {
  if (ids.length === 0) return "none";
  let on = 0;
  for (const id of ids) {
    if (visible.has(id)) on += 1;
  }
  if (on === 0) return "none";
  if (on === ids.length) return "all";
  return "some";
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.5 2.5h5.2L13.5 8.3a1.2 1.2 0 0 1 0 1.7l-3.5 3.5a1.2 1.2 0 0 1-1.7 0L2.5 7.7V2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <circle cx="5.2" cy="5.2" r="1" fill="currentColor" />
    </svg>
  );
}

function OrbitIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <ellipse
        cx="8"
        cy="8"
        rx="6.2"
        ry="3.4"
        transform="rotate(-28 8 8)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <circle cx="8" cy="8" r="1.65" fill="currentColor" />
    </svg>
  );
}

export function BodyFocusPicker({
  value,
  onChange,
  stellarSystemId,
  onStellarSystemChange,
  availableBodyIds = null,
  parentByBodyId = null,
  labelVisibleIds,
  onSetLabels,
  onToggleAllLabels,
  orbitVisibleIds,
  onSetOrbits,
  onToggleAllOrbits,
  collapsed,
  onToggleCollapsed,
}: BodyFocusPickerProps) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<FocusId>(value);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  const searching = query.trim().length > 0;
  const catalogGroups = buildBodyFocusGroups(BODY_CATALOG, {
    availableBodyIds,
    parentByBodyId,
  });
  const groups = filterBodyFocusGroups(catalogGroups, query);
  const flatIds = flattenBodyFocusIds(groups, expanded, searching);
  const availableIds =
    availableBodyIds != null
      ? [...availableBodyIds]
      : BODY_CATALOG.map((body) => body.id as BodyId);
  const allTagIds = allTagFocusIds(availableIds, parentByBodyId);
  const allOrbitIds = orbitBodyIds(availableIds, parentByBodyId);
  const allLabelsState = visibilityTriState(allTagIds, labelVisibleIds);
  const allOrbitsState = visibilityTriState(allOrbitIds, orbitVisibleIds);

  const selectFocus = useEffectEvent((focusId: FocusId) => {
    onChange(focusId);
    setActiveId(focusId);
  });

  const toggleExpanded = useEffectEvent((headerId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(headerId)) next.delete(headerId);
      else next.add(headerId);
      return next;
    });
  });

  useEffect(() => {
    setActiveId(value);
    const tree = buildBodyFocusGroups(BODY_CATALOG, {
      availableBodyIds,
      parentByBodyId,
    });
    const parentId = focusTreeParentId(tree, value);
    const satKey = satelliteGroupExpandKeyForBody(tree, value);
    if (parentId || satKey) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        if (parentId) {
          const key = String(parentId);
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
        if (satKey && !next.has(satKey)) {
          next.add(satKey);
          changed = true;
        }
        return changed ? next : prev;
      });
    }
    const frame = requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-focus-id="${value}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [value, availableBodyIds, parentByBodyId]);

  useEffect(() => {
    if (flatIds.length === 0) return;
    if (!flatIds.includes(activeId)) {
      setActiveId(flatIds[0]!);
    }
  }, [flatIds, activeId]);

  const moveActive = (delta: number) => {
    if (flatIds.length === 0) return;
    const index = Math.max(0, flatIds.indexOf(activeId));
    const next = flatIds[(index + delta + flatIds.length) % flatIds.length]!;
    setActiveId(next);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-focus-id="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  const entryForActive = (): BodyFocusEntry | null => {
    for (const group of groups) {
      for (const entry of group.entries) {
        if (entryHeaderId(entry) === activeId) return entry;
      }
    }
    return null;
  };

  const renderVisibilityToggle = (
    kind: "tag" | "orbit",
    state: VisibilityTriState,
    label: string,
    onToggle: (visible: boolean) => void,
    options?: { scope?: boolean },
  ) => {
    const pressed = state === "all" ? true : state === "some" ? "mixed" : false;
    const nextVisible = state !== "all";
    return (
      <button
        type="button"
        className={
          "focus-vis-toggle" +
          (kind === "tag" ? " is-tag" : " is-orbit") +
          (state === "all" ? " is-on" : "") +
          (state === "some" ? " is-mixed" : "") +
          (options?.scope ? " is-scope" : "")
        }
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(nextVisible);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {kind === "tag" ? <TagIcon /> : <OrbitIcon />}
      </button>
    );
  };

  const renderItemToggles = (id: FocusId, name: string) => (
    <span
      className="focus-vis-pair"
      role="group"
      aria-label={`${name} visibility`}
    >
      {renderVisibilityToggle(
        "tag",
        labelVisibleIds.has(id) ? "all" : "none",
        `${labelVisibleIds.has(id) ? "Hide" : "Show"} tag for ${name}`,
        (visible) => onSetLabels([id], visible),
      )}
      {renderVisibilityToggle(
        "orbit",
        orbitVisibleIds.has(id) ? "all" : "none",
        `${orbitVisibleIds.has(id) ? "Hide" : "Show"} orbit for ${name}`,
        (visible) => onSetOrbits([id], visible),
      )}
    </span>
  );

  const renderScopeToggles = (ids: readonly FocusId[], scopeLabel: string) => {
    if (ids.length === 0) return null;
    const tagState = visibilityTriState(ids, labelVisibleIds);
    const orbitState = visibilityTriState(ids, orbitVisibleIds);
    return (
      <span
        className="focus-vis-pair is-scope-pair"
        role="group"
        aria-label={`${scopeLabel} visibility`}
      >
        {renderVisibilityToggle(
          "tag",
          tagState,
          tagState === "all"
            ? `Hide all tags in ${scopeLabel}`
            : `Show all tags in ${scopeLabel}`,
          (visible) => onSetLabels(ids, visible),
          { scope: true },
        )}
        {renderVisibilityToggle(
          "orbit",
          orbitState,
          orbitState === "all"
            ? `Hide all orbits in ${scopeLabel}`
            : `Show all orbits in ${scopeLabel}`,
          (visible) => onSetOrbits(ids, visible),
          { scope: true },
        )}
      </span>
    );
  };

  const renderTwistie = (
    expandedNow: boolean,
    controlsId: string,
    label: string,
    onToggle: () => void,
  ) => (
    <button
      type="button"
      className={"focus-picker-twistie" + (expandedNow ? " is-expanded" : "")}
      aria-expanded={expandedNow}
      aria-controls={controlsId}
      aria-label={expandedNow ? `Collapse ${label}` : `Expand ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M6 4.2 10 8 6 11.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  const renderChildBody = (child: BodyData) => {
    const childId = child.id as BodyId;
    return (
      <li key={childId}>
        <div className="focus-picker-row is-child-row">
          <span className="focus-picker-twistie-spacer" aria-hidden="true" />
          {renderItemToggles(childId, child.name)}
          <button
            type="button"
            role="option"
            data-focus-id={childId}
            className={
              optionClassName(childId === value, childId === activeId) +
              " is-child"
            }
            aria-selected={childId === value}
            onMouseEnter={() => setActiveId(childId)}
            onClick={() => selectFocus(childId)}
          >
            <span className="focus-picker-option-label">{child.name}</span>
          </button>
        </div>
      </li>
    );
  };

  const renderSatGroup = (
    parentHeaderKey: string,
    section: SatelliteGroupSection,
  ) => {
    const satKey = satelliteGroupExpandKey(parentHeaderKey, section.group);
    const isSatExpanded = searching || expanded.has(satKey);
    const satListId = `${listId}-${satKey}-members`;
    const memberIds = section.bodies.map((body) => body.id as BodyId);

    return (
      <li
        key={section.group}
        className={
          "focus-picker-sat-group" + (isSatExpanded ? " is-expanded" : "")
        }
        data-sat-group={section.group}
      >
        <div className="focus-picker-row is-sat-group-row">
          {renderTwistie(isSatExpanded, satListId, section.label, () => {
            if (!searching) toggleExpanded(satKey);
          })}
          {renderScopeToggles(memberIds, section.label)}
          <button
            type="button"
            className="focus-picker-sat-group-toggle"
            aria-expanded={isSatExpanded}
            aria-controls={satListId}
            onClick={(event) => {
              event.stopPropagation();
              if (!searching) toggleExpanded(satKey);
            }}
          >
            <span className="focus-picker-sat-group-label">
              {section.label}
            </span>
            <span className="focus-picker-moon-count">
              {section.bodies.length}
            </span>
          </button>
        </div>
        {isSatExpanded && (
          <ul
            id={satListId}
            className="focus-picker-sat-group-list"
            aria-label={section.label}
          >
            {section.bodies.map((child) => renderChildBody(child))}
          </ul>
        )}
      </li>
    );
  };

  const renderEntry = (entry: BodyFocusEntry) => {
    const headerId = entryHeaderId(entry);
    const headerName = entryHeaderName(entry);
    const headerKey = String(headerId);
    const selected = headerId === value;
    const active = headerId === activeId;
    const hasDropdown = entryHasDropdown(entry);
    const isSystem = entry.systemHeader != null;
    const isExpanded = searching || expanded.has(headerKey);
    const childListId = `${listId}-${headerKey}-members`;
    const nestedBodies = entryNestedBodies(entry);
    const isStellarBarycenterHeader = isStellarBarycenterFocusId(
      String(headerId),
    );
    const moonSections = satelliteGroupSections(entry.children);
    const showGroupLabels = satelliteSectionsShowLabels(moonSections);
    const ungroupedMoons = ungroupedSatellites(entry.children);

    return (
      <li
        key={headerKey}
        className={
          "focus-picker-entry" +
          (isSystem ? " is-system" : "") +
          (isSystem && isExpanded ? " is-expanded" : "")
        }
      >
        <div
          className={
            "focus-picker-row" +
            (isStellarBarycenterHeader ? " is-full-width-option" : "")
          }
        >
          {isStellarBarycenterHeader ? null : hasDropdown ? (
            renderTwistie(isExpanded, childListId, headerName, () => {
              if (!searching) toggleExpanded(headerKey);
            })
          ) : (
            <span className="focus-picker-twistie-spacer" aria-hidden="true" />
          )}
          {isStellarBarycenterHeader
            ? null
            : renderItemToggles(headerId, headerName)}
          <button
            type="button"
            role="option"
            data-focus-id={headerId}
            className={
              optionClassName(selected, active) +
              (isSystem ? " is-system-header" : "")
            }
            aria-selected={selected}
            onMouseEnter={() => setActiveId(headerId)}
            onClick={() => selectFocus(headerId)}
          >
            <span className="focus-picker-option-label">{headerName}</span>
            {nestedBodies.length > 0 && (
              <span className="focus-picker-moon-count">
                {nestedBodies.length}
              </span>
            )}
          </button>
        </div>
        {hasDropdown && isExpanded && (
          <ul
            id={childListId}
            className="focus-picker-children"
            aria-label={headerName}
          >
            {nestedBodies.length > 0 && (
              <li className="focus-picker-members-bar" key={`${headerKey}-all`}>
                <div className="focus-picker-row is-members-bar-row">
                  <span
                    className="focus-picker-twistie-spacer"
                    aria-hidden="true"
                  />
                  {renderScopeToggles(
                    nestedBodies.map((body) => body.id as BodyId),
                    `${headerName} members`,
                  )}
                  <div className="focus-picker-members-bar-label">
                    <span>All members</span>
                    <span className="focus-picker-moon-count">
                      {nestedBodies.length}
                    </span>
                  </div>
                </div>
              </li>
            )}
            {entry.systemHeader && renderChildBody(entry.body)}
            {showGroupLabels
              ? moonSections.map((section) =>
                  renderSatGroup(headerKey, section),
                )
              : null}
            {showGroupLabels
              ? ungroupedMoons.map((child) => renderChildBody(child))
              : entry.children.map((child) => renderChildBody(child))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className={"focus-rail-shell" + (collapsed ? " is-collapsed" : "")}>
      <aside
        className={"focus-rail" + (collapsed ? " is-collapsed" : "")}
        aria-label="Focus body"
      >
        <div
          className="focus-rail-body"
          aria-hidden={collapsed}
          inert={collapsed || undefined}
        >
          <header className="focus-rail-header">
            <div className="stellar-system-picker">
              <p className="stellar-system-current">
                {STELLAR_SYSTEMS[stellarSystemId].name}
              </p>
              <button
                type="button"
                className="stellar-system-select-btn"
                aria-haspopup="dialog"
                aria-expanded={systemModalOpen}
                onClick={() => setSystemModalOpen(true)}
              >
                Select System
              </button>
            </div>
          </header>
          <SystemSelectModal
            open={systemModalOpen}
            value={stellarSystemId}
            onChange={onStellarSystemChange}
            onClose={() => setSystemModalOpen(false)}
          />
          <div className="focus-picker-select-alls">
            <button
              type="button"
              className={
                "focus-picker-select-all" +
                (allLabelsState === "all" ? " is-on" : "") +
                (allLabelsState === "some" ? " is-mixed" : "")
              }
              aria-pressed={
                allLabelsState === "all"
                  ? true
                  : allLabelsState === "some"
                    ? "mixed"
                    : false
              }
              title={
                allLabelsState === "all" ? "Hide all tags" : "Show all tags"
              }
              onClick={() => onToggleAllLabels(allLabelsState !== "all")}
            >
              <span
                className="focus-vis-toggle is-tag is-inline"
                aria-hidden="true"
              >
                <TagIcon />
              </span>
              <span>Tags</span>
            </button>
            <button
              type="button"
              className={
                "focus-picker-select-all" +
                (allOrbitsState === "all" ? " is-on" : "") +
                (allOrbitsState === "some" ? " is-mixed" : "")
              }
              aria-pressed={
                allOrbitsState === "all"
                  ? true
                  : allOrbitsState === "some"
                    ? "mixed"
                    : false
              }
              title={
                allOrbitsState === "all" ? "Hide all orbits" : "Show all orbits"
              }
              onClick={() => onToggleAllOrbits(allOrbitsState !== "all")}
            >
              <span
                className="focus-vis-toggle is-orbit is-inline"
                aria-hidden="true"
              >
                <OrbitIcon />
              </span>
              <span>Orbits</span>
            </button>
          </div>
          <input
            className="focus-picker-search"
            type="search"
            placeholder="Search bodies…"
            value={query}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls={listId}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
              } else if (event.key === "ArrowRight") {
                const entry = entryForActive();
                if (entry && entryHasDropdown(entry) && !searching) {
                  event.preventDefault();
                  setExpanded((prev) =>
                    new Set(prev).add(String(entryHeaderId(entry))),
                  );
                }
              } else if (event.key === "ArrowLeft") {
                const entry = entryForActive();
                const headerKey = entry ? String(entryHeaderId(entry)) : null;
                if (
                  entry &&
                  entryHasDropdown(entry) &&
                  headerKey &&
                  expanded.has(headerKey)
                ) {
                  event.preventDefault();
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    next.delete(headerKey);
                    return next;
                  });
                } else {
                  const parentId = focusTreeParentId(groups, activeId);
                  if (parentId) {
                    event.preventDefault();
                    setActiveId(parentId);
                    if (!searching) {
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        next.delete(String(parentId));
                        return next;
                      });
                    }
                  }
                }
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (flatIds.includes(activeId)) selectFocus(activeId);
                else if (flatIds[0]) selectFocus(flatIds[0]);
              }
            }}
          />
          <div
            ref={listRef}
            id={listId}
            className="focus-picker-list"
            role="listbox"
            aria-label="Bodies"
          >
            {groups.length === 0 ? (
              <p className="focus-picker-empty">No matches</p>
            ) : (
              groups.map((group) => (
                <section
                  key={group.id}
                  className={
                    "focus-picker-group" + (group.label ? "" : " is-unlabeled")
                  }
                >
                  {group.label ? (
                    <h3 className="focus-picker-group-label">{group.label}</h3>
                  ) : null}
                  <ul className="focus-picker-group-list">
                    {group.entries.map((entry) => renderEntry(entry))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
        <PanelCollapseButton
          side="left"
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
          label="body selector"
        />
      </aside>
      {!collapsed ? (
        <button
          type="button"
          className="hud-btn hud-btn-icon focus-rail-info-btn"
          aria-label="About"
          title="About"
          aria-haspopup="dialog"
          aria-expanded={infoModalOpen}
          onClick={() => setInfoModalOpen(true)}
        >
          <svg
            className="hud-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
        </button>
      ) : null}
      <InfoModal open={infoModalOpen} onClose={() => setInfoModalOpen(false)} />
    </div>
  );
}
