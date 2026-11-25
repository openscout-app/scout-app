import { HarnessMark } from "./HarnessMark.tsx";
import "./harness-coin.css";

/**
 * HarnessCoin — an agent in a dense list: a neutral coin carrying its
 * harness glyph. Every row that names an agent uses the same mark, so one
 * agent never looks like two. Generated faces stay on the agent's own page.
 */
export function HarnessCoin({ harness, size = 22, className }: { harness: string | null | undefined; size?: number; className?: string }) {
  return (
    <span className={className ? `harness-coin ${className}` : "harness-coin"} style={{ width: size, height: size }}>
      <HarnessMark harness={harness ?? ""} size={Math.round(size * 0.5)} />
    </span>
  );
}
