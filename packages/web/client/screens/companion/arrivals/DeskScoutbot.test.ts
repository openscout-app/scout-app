import { expect, test } from "bun:test";
import { docksOnBoard } from "./DeskScoutbot.tsx";

const board = { left: 1000, top: 700, right: 1336, bottom: 860 };

test("a drop on the board, beside it or just above its edge docks Scoutbot", () => {
  expect(docksOnBoard(board, { x: 1168, y: 780 })).toBe(true);
  expect(docksOnBoard(board, { x: 1168, y: 640 })).toBe(true);
  expect(docksOnBoard(board, { x: 990, y: 800 })).toBe(true);
});

test("a drop out on the desk leaves Scoutbot where it fell", () => {
  expect(docksOnBoard(board, { x: 1168, y: 600 })).toBe(false);
  expect(docksOnBoard(board, { x: 400, y: 780 })).toBe(false);
  expect(docksOnBoard(null, { x: 1168, y: 780 })).toBe(false);
});
