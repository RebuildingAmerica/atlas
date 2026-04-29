"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Entry } from "@/types";
import { CITY_COORDS } from "./city-coords";

interface DotActor {
  name: string;
  issues: string[];
  city: string;
  x: number;
  y: number;
  color: string;
}

interface Stats {
  actors: number;
  cities: number;
  issueAreas: number;
}

const ISSUE_COLORS: Record<string, string> = {
  housing: "#c2956a",
  labor: "#82aa8c",
  climate: "#64a0be",
  democracy: "#be786e",
  education: "#dcb464",
  health: "#8cb4a0",
};

const FALLBACK_COLOR = "#a89880";

const VIEWBOX_W = 360;
const VIEWBOX_H = 220;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = 18 + ((lon - -124.7) / (-66.9 - -124.7)) * (VIEWBOX_W - 36);
  const y = 10 + ((49.4 - lat) / (49.4 - 24.5)) * (VIEWBOX_H - 20);
  return { x, y };
}

function issueColor(issueAreaId: string): string {
  const [prefix] = issueAreaId.split("-");
  if (!prefix) return FALLBACK_COLOR;
  return ISSUE_COLORS[prefix.toLowerCase()] ?? FALLBACK_COLOR;
}

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
      color: entry.issue_areas[0] !== undefined ? issueColor(entry.issue_areas[0]) : FALLBACK_COLOR,
      ...project(coords.lat, coords.lon),
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
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.entries.list({ limit: 50 }).then((res) => {
      setDots(buildDots(res.data));
      setStats({
        actors: res.pagination.total,
        cities: res.facets.cities.length,
        issueAreas: res.facets.issue_areas.length,
      });
    });
  }, []);

  function handleEnter(idx: number, dot: DotActor) {
    setActiveIdx(idx);
    if (!svgRef.current || !wrapRef.current) return;
    const svgRect = svgRef.current.getBoundingClientRect();
    const wrapRect = wrapRef.current.getBoundingClientRect();
    const px = (dot.x / VIEWBOX_W) * svgRect.width;
    const py = (dot.y / VIEWBOX_H) * svgRect.height;
    const relX = svgRect.left - wrapRect.left + px;
    const relY = svgRect.top - wrapRect.top + py;
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
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* CONUS outline — simplified polygon */}
          <path
            d="M 16,48 L 18,42 L 26,34 L 38,26 L 54,20 L 72,15 L 92,11 L 114,9 L 138,8 L 162,8 L 184,9 L 204,8 L 224,9 L 242,12 L 258,16 L 272,21 L 284,27 L 294,34 L 300,42 L 304,50 L 302,58 L 296,66 L 284,74 L 270,80 L 254,86 L 238,91 L 222,96 L 205,102 L 188,108 L 170,113 L 152,116 L 134,114 L 116,110 L 98,104 L 80,97 L 62,88 L 46,78 L 32,66 L 20,56 Z"
            fill="rgba(250,246,238,0.025)"
            stroke="rgba(250,246,238,0.10)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {/* Florida peninsula */}
          <path
            d="M 214,113 L 220,124 L 217,138 L 210,142 L 205,134 L 208,120 Z"
            fill="rgba(250,246,238,0.025)"
            stroke="rgba(250,246,238,0.10)"
            strokeWidth="1"
          />
          {dots.map((dot, idx) => {
            const active = activeIdx === idx;
            return (
              <g
                key={idx}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => {
                  handleEnter(idx, dot);
                }}
                onMouseLeave={handleLeave}
              >
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={active ? 10 : 0}
                  fill="none"
                  stroke={dot.color}
                  strokeWidth="0.8"
                  opacity={active ? 0.3 : 0}
                  style={{ transition: "r 0.18s ease, opacity 0.18s ease" }}
                />
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={active ? 5 : 2.8}
                  fill={dot.color}
                  opacity={active ? 1 : 0.7}
                  style={{ transition: "r 0.18s ease, opacity 0.18s ease" }}
                />
              </g>
            );
          })}
        </svg>

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
        <StatItem value={stats?.actors} label="civic actors" />
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
        className="text-surface text-[26px] leading-none font-extrabold tracking-tight"
        style={{ letterSpacing: "-0.03em" }}
      >
        {value !== undefined ? value.toLocaleString() : "—"}
      </div>
      <div
        className="mt-[3px] text-[10px] tracking-[0.07em] uppercase"
        style={{ color: "rgba(250,246,238,0.38)" }}
      >
        {label}
      </div>
    </div>
  );
}
