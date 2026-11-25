import { LedSign } from "../../../components/led/LedSign.tsx";
import { ledInitials, ledName } from "../../../components/led/led-model.ts";
import { ledChestColumns, ledChestLayout } from "../chest-number/chest-art.tsx";
import { chestNumberShows } from "../chest-number/chest-number-model.ts";
import type { EdgeVisible } from "../edge-model.ts";
import { ledPitch, type FigureLook } from "./figure-look-model.ts";
import "./led-figure.css";

/**
 * A companion figure as an LED tile: the agent's initials, or its name
 * streaming through the tile, in the accent while it asks for you. Its roster
 * code, where it reads, is the tile's lower band (chest-number/).
 */
export function LedFigure({
  name,
  look,
  visible,
  size,
  reduced = false,
  chest,
}: {
  name: string;
  look: Exclude<FigureLook, "character">;
  visible: EdgeVisible;
  size: number;
  reduced?: boolean;
  /** Its roster code ("003"). */
  chest?: string | null;
}) {
  const pitch = ledPitch(size);
  const columns = Math.max(7, Math.round((size * 1.15) / pitch) - 2);
  const text = look === "led-name" ? ledName(name) : ledInitials(name);
  // Its roster code as a still band of finer dots under the text, in the tile's own canvas (chest-art.tsx).
  const tileWidth = (columns + 2) * pitch;
  const code = chest && chestNumberShows("led", size) ? ledChestColumns(chest) : [];
  const band = code.length ? ledChestLayout(size, tileWidth) : null;
  const asks = visible === "needs";
  return (
    <span className={`led-fig is-${visible}`} aria-hidden="true">
      <span className="led-fig__tile">
        {band
          ? <LedSign text={text} columns={band.upperColumns} pitch={band.upperPitch} width={tileWidth} tone={asks ? "accent" : "ink"} reduced={reduced} speed={9}
              band={{ cols: code, rows: band.rows, pitch: band.pitch, ink: band.onInk }} />
          : <LedSign text={text} columns={columns} pitch={pitch} tone={asks ? "accent" : "ink"} reduced={reduced} speed={9} />}
      </span>
    </span>
  );
}
