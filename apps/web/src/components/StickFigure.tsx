import type { Stage } from "@paper-duel/engine";

interface Props {
  stage: Stage;
  eliminated: boolean;
  /** Opponent figures face left so the guns point at each other. */
  mirrored?: boolean;
  label: string;
}

/** A plain stick figure that gains one part per stage. Animation comes in M4. */
export function StickFigure({ stage, eliminated, mirrored = false, label }: Props) {
  return (
    <svg
      className={`figure${eliminated ? " figure--dead" : ""}`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <g transform={mirrored ? "translate(100 0) scale(-1 1)" : undefined}>
        {stage === 0 && !eliminated && <circle cx="35" cy="22" r="12" className="figure__ghost" />}
        {stage >= 1 && <circle cx="35" cy="22" r="12" />}
        {stage >= 2 && <path d="M35 34 V68 M35 68 L24 92 M35 68 L46 92 M35 46 L22 60" />}
        {stage >= 3 && (
          <>
            <circle cx="31" cy="19" r="1.6" className="figure__fill" />
            <circle cx="39" cy="19" r="1.6" className="figure__fill" />
            <path d="M30 26 Q35 30 40 26" />
          </>
        )}
        {stage >= 2 && stage < 4 && <path d="M35 46 L48 58" />}
        {stage >= 4 && (
          <>
            <path d="M35 46 L56 44" />
            <path d="M54 40 H78 V46 H62 L60 54 H55 L56 46 H54 Z" className="figure__gun" />
          </>
        )}
        {stage >= 5 && (
          <g className="figure__fill">
            <circle cx="84" cy="43" r="2.2" />
            <circle cx="90" cy="43" r="2.2" />
            <circle cx="96" cy="43" r="2.2" />
          </g>
        )}
      </g>
      {eliminated && <path d="M10 10 L90 90 M90 10 L10 90" className="figure__x" />}
    </svg>
  );
}
