/**
 * Brand panel displayed on the left side of the auth flow layout.
 *
 * Shows the Atlas logo, tagline, operator subtitle, and decorative
 * data-viz dots on a dark background.
 */
export function AuthBrandPanel() {
  return (
    <div className="bg-inverse-surface relative flex h-full flex-col justify-between px-8 py-10 lg:px-12 lg:py-14">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-xl text-white">
            <span className="type-label-medium leading-none">A</span>
          </div>
          <span className="type-title-medium text-inverse-on-surface">Atlas</span>
        </div>

        <div className="space-y-3">
          <p className="type-headline-medium text-inverse-on-surface">
            Map the people rebuilding America.
          </p>
          <p className="type-body-large text-inverse-primary">Team workspace</p>
        </div>
      </div>

      <DecorativeDots />
    </div>
  );
}

/**
 * Compact brand header shown on mobile in place of the full brand panel.
 */
export function AuthBrandHeader() {
  return (
    <div className="bg-inverse-surface flex items-center gap-3 px-6 py-4">
      <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-xl text-white">
        <span className="type-label-medium leading-none">A</span>
      </div>
      <span className="type-title-medium text-inverse-on-surface">Atlas</span>
    </div>
  );
}

interface DotStyle {
  width: string;
  height: string;
  top: string;
  left: string;
  opacity: number;
}

const DOTS: DotStyle[] = [
  { width: "6px", height: "6px", top: "12%", left: "8%", opacity: 0.3 },
  { width: "8px", height: "8px", top: "28%", left: "72%", opacity: 0.5 },
  { width: "5px", height: "5px", top: "45%", left: "35%", opacity: 0.2 },
  { width: "10px", height: "10px", top: "18%", left: "55%", opacity: 0.6 },
  { width: "7px", height: "7px", top: "60%", left: "18%", opacity: 0.4 },
  { width: "6px", height: "6px", top: "72%", left: "82%", opacity: 0.25 },
  { width: "9px", height: "9px", top: "55%", left: "65%", opacity: 0.45 },
  { width: "5px", height: "5px", top: "85%", left: "42%", opacity: 0.35 },
];

function DecorativeDots() {
  return (
    <div className="relative mt-auto h-32">
      {DOTS.map((dot, index) => (
        <span
          key={index}
          className="bg-primary absolute rounded-full"
          style={{
            width: dot.width,
            height: dot.height,
            top: dot.top,
            left: dot.left,
            opacity: dot.opacity,
          }}
        />
      ))}
    </div>
  );
}
