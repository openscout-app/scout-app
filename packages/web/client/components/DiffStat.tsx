/**
 * A change's size as "+120 −14": the added count in the theme's added colour,
 * the removed count in its removed colour (--diff-add, --diff-del in app.css).
 * One treatment everywhere a size shows: Home, the Feed, the For you cards.
 */
export function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={className ? `diff-stat ${className}` : "diff-stat"}>
      <span className="diff-add">+{additions}</span> <span className="diff-del">−{deletions}</span>
    </span>
  );
}
