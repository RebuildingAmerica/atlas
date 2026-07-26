"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import usAtlasStates from "us-atlas/states-10m.json";
import {
  FALLBACK_ISSUE_COLOR,
  issueColor,
} from "@rebuildingamerica/atlas-catalog/map/issue-colors";
import { api } from "@rebuildingamerica/atlas-api-client";
import type { Entry } from "@rebuildingamerica/atlas-api-client";
import { CITY_COORDS } from "./city-coords";

interface DotActor {
  name: string;
  issues: string[];
  city: string;
  coordinates: [number, number];
  color: string;
}

interface Stats {
  actors: number;
  cities: number;
  issueAreas: number;
}

interface MapGeography {
  id: string | number;
  properties: {
    name: string;
  };
  rsmKey: string;
}

const MAP_WIDTH = 975;
const MAP_HEIGHT = 610;

function buildDots(entries: Entry[]): DotActor[] {
  const dots: DotActor[] = [];
  for (const entry of entries) {
    if (!entry.city || !entry.state) continue;
    const key = `${entry.city}, ${entry.state}`;
    const coords = CITY_COORDS[key];
    if (!coords) continue;
    dots.push({
      name: entry.name,
      issues: entry.issue_areas,
      city: key,
      color:
        entry.issue_areas[0] !== undefined
          ? issueColor(entry.issue_areas[0])
          : FALLBACK_ISSUE_COLOR,
      coordinates: [coords.lon, coords.lat],
    });
  }
  return dots;
}

interface TooltipState {
  visible: boolean;
  name: string;
  issues: string[];
  city: string;
  left: number;
  top: number;
}

export function CivicMapPanel() {
  const [dots, setDots] = useState<DotActor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    name: "",
    issues: [],
    city: "",
    left: 0,
    top: 0,
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    void api.entries
      .list({ limit: 50 })
      .then((res) => {
        if (!active) {
          return;
        }
        setDots(buildDots(res.data));
        setStats({
          actors: res.pagination.total,
          cities: res.facets.cities.length,
          issueAreas: res.facets.issue_areas.length,
        });
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setDots([]);
        setStats(null);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleEnter(event: MouseEvent<SVGGElement>, idx: number, dot: DotActor) {
    setActiveIdx(idx);
    if (!wrapRef.current) return;
    const wrapRect = wrapRef.current.getBoundingClientRect();
    const markerRect = event.currentTarget.getBoundingClientRect();
    const relX = markerRect.left - wrapRect.left + markerRect.width / 2;
    const relY = markerRect.top - wrapRect.top + markerRect.height / 2;
    const tipW = 175;
    let left = relX + 12;
    if (left + tipW > wrapRect.width) left = relX - tipW - 12;
    setTooltip({
      visible: true,
      name: dot.name,
      issues: dot.issues,
      city: dot.city,
      left,
      top: Math.max(0, relY - 22),
    });
  }

  function handleLeave() {
    setActiveIdx(null);
    setTooltip((t) => ({ ...t, visible: false }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Map */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <ComposableMap
          projection="geoAlbersUsa"
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className="h-full w-full"
          aria-label="United States map"
        >
          <Geographies geography={usAtlasStates}>
            {({ geographies }) =>
              (geographies as MapGeography[]).map((geography) => (
                <Geography
                  key={geography.rsmKey}
                  geography={geography}
                  aria-label={geography.properties.name}
                  tabIndex={-1}
                  style={{
                    default: {
                      fill: "rgba(250,246,238,0.035)",
                      stroke: "rgba(250,246,238,0.13)",
                      strokeWidth: 0.65,
                      outline: "none",
                    },
                    hover: {
                      fill: "rgba(250,246,238,0.055)",
                      stroke: "rgba(250,246,238,0.18)",
                      strokeWidth: 0.65,
                      outline: "none",
                    },
                    pressed: {
                      fill: "rgba(250,246,238,0.055)",
                      stroke: "rgba(250,246,238,0.18)",
                      strokeWidth: 0.65,
                      outline: "none",
                    },
                  }}
                />
              ))
            }
          </Geographies>

          {dots.map((dot, idx) => {
            const active = activeIdx === idx;
            return (
              <Marker key={idx} coordinates={dot.coordinates}>
                <g
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(event) => {
                    handleEnter(event, idx, dot);
                  }}
                  onMouseLeave={handleLeave}
                >
                  <circle
                    cx={0}
                    cy={0}
                    r={active ? 10 : 0}
                    fill="none"
                    stroke={dot.color}
                    strokeWidth="0.8"
                    opacity={active ? 0.3 : 0}
                    style={{ transition: "r 0.18s ease, opacity 0.18s ease" }}
                  />
                  <circle
                    cx={0}
                    cy={0}
                    r={active ? 5 : 2.8}
                    fill={dot.color}
                    opacity={active ? 1 : 0.7}
                    style={{ transition: "r 0.18s ease, opacity 0.18s ease" }}
                  />
                </g>
              </Marker>
            );
          })}
        </ComposableMap>

        {tooltip.visible && (
          <div
            className="pointer-events-none absolute z-10 max-w-[200px] min-w-[150px] rounded-[10px] border px-[11px] py-2"
            style={{
              left: tooltip.left,
              top: tooltip.top,
              background: "rgba(28,25,23,0.92)",
              borderColor: "rgba(250,246,238,0.14)",
            }}
          >
            <div className="type-label-medium" style={{ color: "rgba(250,246,238,0.92)" }}>
              {tooltip.name}
            </div>
            {tooltip.issues.length > 0 && (
              <div className="type-body-small mt-0.5" style={{ color: "rgba(250,246,238,0.45)" }}>
                {tooltip.issues.join(" · ")}
              </div>
            )}
            <div className="type-body-small mt-0.5" style={{ color: "rgba(194,149,106,0.85)" }}>
              {tooltip.city}
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px flex-shrink-0" style={{ background: "rgba(250,246,238,0.07)" }} />

      {/* Stats */}
      <div className="flex flex-shrink-0 gap-6 pb-1">
        <StatItem value={stats?.actors} label="people and groups" />
        <StatItem value={stats?.cities} label="cities" />
        <StatItem value={stats?.issueAreas} label="issue areas" />
      </div>
    </div>
  );
}

interface StatItemProps {
  value: number | undefined;
  label: string;
}

function StatItem({ value, label }: StatItemProps) {
  return (
    <div>
      <div
        className="text-surface text-[26px] leading-none font-extrabold"
        style={{ letterSpacing: "0" }}
      >
        {/* Grouping separators differ by locale, so an unpinned call renders one
            string on the server and another in the browser. These are bare
            counts on an en-US surface -- pin them rather than reach for the
            hydration-aware date machinery. */}
        {value !== undefined ? value.toLocaleString("en-US") : "—"}
      </div>
      <div
        className="mt-[3px] text-[10px] uppercase"
        style={{ color: "rgba(250,246,238,0.38)", letterSpacing: "0" }}
      >
        {label}
      </div>
    </div>
  );
}
