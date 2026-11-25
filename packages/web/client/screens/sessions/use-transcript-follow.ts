import { useLayoutEffect, useRef, useState } from "react";

type ScrollPort = Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">;
export const atTranscriptEnd = (port: ScrollPort) => port.scrollHeight - port.clientHeight - port.scrollTop <= 48;

/** A reader keeps their place; following also covers text growing inside an existing row. */
export function useTranscriptFollow(sessionKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastScrollTop = useRef(0);
  const [following, setFollowing] = useState(true);
  const follow = (value: boolean) => {
    followingRef.current = value;
    setFollowing(value);
  };
  const jump = () => {
    follow(true);
    const port = scrollRef.current;
    if (port) { port.scrollTop = port.scrollHeight; lastScrollTop.current = port.scrollTop; }
  };

  useLayoutEffect(() => {
    follow(true);
    const port = scrollRef.current;
    const content = contentRef.current;
    if (!port || !content) return;
    const pin = () => {
      if (followingRef.current) { port.scrollTop = port.scrollHeight; lastScrollTop.current = port.scrollTop; }
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(pin);
    observer?.observe(port);
    observer?.observe(content);
    pin();
    return () => observer?.disconnect();
  }, [sessionKey]);

  // React commits catch new events; ResizeObserver also catches markdown/images
  // growing without a new event id or count.
  useLayoutEffect(() => {
    const port = scrollRef.current;
    if (port && followingRef.current) { port.scrollTop = port.scrollHeight; lastScrollTop.current = port.scrollTop; }
  });

  return { scrollRef, contentRef, following, jump, pause: () => follow(false),
    onScroll: () => {
      const port = scrollRef.current;
      if (!port) return;
      const previous = lastScrollTop.current;
      lastScrollTop.current = port.scrollTop;
      if (atTranscriptEnd(port)) follow(true);
      // Reflow can grow the tail before ResizeObserver pins it. Only moving
      // back into the transcript pauses following, not a changed bottom gap.
      else if (port.scrollTop < previous - 1) follow(false);
    } };
}
