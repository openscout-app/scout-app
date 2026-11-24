/** The standalone host sets this build flag without a browser process shim. */
declare const __SCOUT_FEED_READ_ONLY__: boolean;

export const readOnlyPreview = typeof __SCOUT_FEED_READ_ONLY__ === "boolean"
  ? __SCOUT_FEED_READ_ONLY__
  : typeof process !== "undefined" && process.env?.SCOUT_FEED_READ_ONLY === "1";
