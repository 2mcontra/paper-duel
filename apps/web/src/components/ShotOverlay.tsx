import { useLayoutEffect, useRef } from "react";
import type { GameEvent } from "@paper-duel/engine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Centre of the figure for player `p`, slot `n`, in viewport coordinates. */
function centre(p: number, n: number): { x: number; y: number } | null {
  // Aim at the figure itself, not the whole row it sits in.
  const el =
    document.querySelector(`[data-slot="${p}-${n}"] svg`) ??
    document.querySelector(`[data-slot="${p}-${n}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Draws the moment of a shot over the whole page: a curved pencil line from the shooter's
 * figure to each target, then a "BANG!", shield or "miss" mark where it lands. Drawn
 * imperatively from the current reveal event, since it only needs the DOM positions.
 */
export function ShotOverlay({ current }: { current: { event: GameEvent; seq: number } | null }) {
  const svg = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const root = svg.current;
    if (!root) return;
    root.replaceChildren();
    const e = current?.event;
    if (!e) return;

    if (e.type === "ShotFired") {
      const from = centre(e.attacker, e.slot);
      for (const t of e.targets) {
        const to = centre(t, e.slot);
        if (!from || !to) continue;
        // Bow the line upward a little, like the curved lines drawn in the video.
        const mx = (from.x + to.x) / 2;
        const my = Math.min(from.y, to.y) - Math.max(40, Math.abs(to.x - from.x) * 0.25);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`);
        path.setAttribute("pathLength", "1");
        path.setAttribute("class", "shot-line");
        root.append(path);
      }
      return;
    }

    const mark = (target: number, slot: number, text: string, cls: string) => {
      const at = centre(target, slot);
      if (!at) return;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(at.x));
      t.setAttribute("y", String(at.y));
      t.setAttribute("class", `shot-mark ${cls}`);
      t.textContent = text;
      root.append(t);
    };
    if (e.type === "SlotEliminated") mark(e.target, e.slot, "BANG!", "shot-mark--bang");
    else if (e.type === "ShotBlocked") mark(e.target, e.slot, "🛡️", "shot-mark--block");
    else if (e.type === "AttackMissed") mark(e.target, e.slot, "miss", "shot-mark--miss");
    else if (e.type === "FigureDestroyed") mark(e.target, e.slot, "wiped!", "shot-mark--bang");
  }, [current]);

  return <svg ref={svg} className="shot-overlay" aria-hidden="true" />;
}
