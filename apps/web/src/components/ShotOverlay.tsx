import { useLayoutEffect, useRef } from "react";
import type { GameEvent } from "@paper-duel/engine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Centre of player `p`'s figure `f` on screen, in viewport coordinates. */
function centre(p: number, f: number): { x: number; y: number } | null {
  const el =
    document.querySelector(`[data-fig="${p}-${f}"] .tfig__hit`) ??
    document.querySelector(`[data-fig="${p}-${f}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Draws the moment of a shot over the whole page: a curved pencil line from the shooter to
 * each target, then a "BANG!", shield or "STOMP!" mark where it lands. Drawn imperatively
 * from the current playback event, since it only needs the DOM positions.
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
      const from = centre(e.player, e.figure);
      for (const t of e.targets) {
        const to = centre(t.player, t.figure);
        if (!from || !to) continue;
        // Bow the line a little, like the curved lines drawn on paper.
        const mx = (from.x + to.x) / 2;
        const my = Math.min(from.y, to.y) - Math.max(30, Math.abs(to.x - from.x) * 0.25);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`);
        path.setAttribute("pathLength", "1");
        path.setAttribute("class", "shot-line");
        root.append(path);
      }
      return;
    }

    const mark = (p: number, f: number, text: string, cls: string) => {
      const at = centre(p, f);
      if (!at) return;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(at.x));
      t.setAttribute("y", String(at.y));
      t.setAttribute("class", `shot-mark ${cls}`);
      t.textContent = text;
      root.append(t);
    };
    if (e.type === "FigureKilled") mark(e.target, e.targetFigure, "BANG!", "shot-mark--bang");
    else if (e.type === "ShieldBroken") mark(e.target, e.targetFigure, "🛡️", "shot-mark--block");
    else if (e.type === "Stomped") mark(e.player, e.figure, "STOMP!", "shot-mark--bang");
    else if (e.type === "Passed") mark(e.player, 0, "pass", "shot-mark--miss");
  }, [current]);

  return <svg ref={svg} className="shot-overlay" aria-hidden="true" />;
}
