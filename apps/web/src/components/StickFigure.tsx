import { useState } from "react";
import type { Stage } from "@paper-duel/engine";

interface Props {
  stage: Stage;
  eliminated: boolean;
  /** Opponent figures face left so the guns point at each other. */
  mirrored?: boolean;
  label: string;
}

/**
 * A stick figure that gains one part per stage. Parts added since the last render are drawn
 * in with a pencil stroke; an elimination draws its red X. The first render never animates,
 * so loading or resuming a game shows the board as it is.
 */
export function StickFigure({ stage, eliminated, mirrored = false, label }: Props) {
  // Remember what was on screen before, to know which parts are new. Updating state during
  // render (not in an effect) is React's recommended way to react to a prop change.
  const [seen, setSeen] = useState({ stage, eliminated });
  const [from, setFrom] = useState({ stage, eliminated });
  if (seen.stage !== stage || seen.eliminated !== eliminated) {
    setFrom({ stage: Math.min(seen.stage, stage) as Stage, eliminated: seen.eliminated });
    setSeen({ stage, eliminated });
  }
  const ink = (partStage: number) => (partStage > from.stage ? " ink" : "");
  const inkFill = (partStage: number) => (partStage > from.stage ? " ink-fill" : "");

  return (
    <svg
      className={`figure${eliminated ? " figure--dead" : ""}${eliminated && !from.eliminated ? " figure--hit" : ""}`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <g transform={mirrored ? "translate(100 0) scale(-1 1)" : undefined} filter="url(#sketch)">
        {stage === 0 && !eliminated && <circle cx="35" cy="22" r="12" className="figure__ghost" />}
        {stage >= 1 && <circle cx="35" cy="22" r="12" pathLength={1} className={ink(1)} />}
        {stage >= 2 && (
          <path
            d="M35 34 V68 M35 68 L24 92 M35 68 L46 92 M35 46 L22 60"
            pathLength={1}
            className={ink(2)}
          />
        )}
        {stage >= 3 && (
          <g className={inkFill(3)}>
            <circle cx="31" cy="19" r="1.6" className="figure__fill" />
            <circle cx="39" cy="19" r="1.6" className="figure__fill" />
            <path d="M30 26 Q35 30 40 26" />
          </g>
        )}
        {stage >= 2 && stage < 4 && <path d="M35 46 L48 58" pathLength={1} className={ink(2)} />}
        {stage >= 4 && (
          <g className={inkFill(4)}>
            <path d="M35 46 L56 44" />
            <path d="M54 40 H78 V46 H62 L60 54 H55 L56 46 H54 Z" className="figure__gun" />
          </g>
        )}
        {stage >= 5 && (
          <g className={`figure__fill${inkFill(5)}`}>
            <circle cx="84" cy="43" r="2.2" />
            <circle cx="90" cy="43" r="2.2" />
            <circle cx="96" cy="43" r="2.2" />
          </g>
        )}
      </g>
      {eliminated && (
        <path
          d="M12 12 L88 88 M88 12 L12 88"
          pathLength={1}
          className={`figure__x${!from.eliminated ? " ink ink--x" : ""}`}
        />
      )}
    </svg>
  );
}

/** Shared SVG filter that gives every stroke a slightly hand-drawn wobble. Render once. */
export function SketchFilter() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <filter id="sketch" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
        <feDisplacementMap
          in="SourceGraphic"
          scale="2.2"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
