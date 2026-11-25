import { useCallback, useEffect, useRef, useState } from "react";

import { ChatApiError, type VercelBoardConnection } from "./chat-api.ts";
import { useChatApi } from "./chat-transport.tsx";

type Team = { id: string; slug: string; name: string };
type BoardChannel = { path: string; linked: string | null };

/** What a failed connect or list means, in the words the sheet shows. */
function failureText(error: unknown): string {
  const code = error instanceof ChatApiError ? error.reason : null;
  switch (code) {
    case "invalid_board_token": return "That doesn't look like a Vercel token. Copy it again from the dialog Vercel shows after Create.";
    case "board_token_refused": return "Vercel didn't accept that token, or it can't read the team's board. Check that its scope is your team, not one project.";
    case "board_team_not_reached": return "That token can't reach that team.";
    case "board_team_has_no_board": return "That team has no board yet. Open Vercel Board once from the team's dashboard, then connect again.";
    case "board_token_no_team": return "That token doesn't reach any team. Make one scoped to your team.";
    case "board_unreachable": return "Vercel's API didn't answer. Try again in a minute.";
    case "board_busy": return "Vercel is limiting requests right now. Try again in a minute.";
    case "board_auth_failed": return "Vercel no longer accepts this space's token. Connect again with a new one.";
    case "board_unconfigured": return "This deployment can't keep Vercel tokens yet.";
    default: return error instanceof Error && error.message ? error.message : "Couldn't reach Vercel.";
  }
}

/**
 * Connects a space to a Vercel team's board, and links its channels.
 *
 * The owner makes a Vercel access token, pastes it, and the server checks it
 * reads the team's board before keeping it, sealed to this space. The token
 * goes in once and is never shown again. Owners and admins then pick board
 * channels to show here; each becomes a space channel whose messages are the
 * board channel's.
 */
export function VercelBoardConnect({
  space,
  connection,
  onClose,
  onChanged,
  onLink,
  onOpen,
}: {
  space: string;
  connection: VercelBoardConnection;
  onClose: () => void;
  /** The connection changed: the surface reloads the space. */
  onChanged: () => Promise<void>;
  /** Links a board channel as a space channel. */
  onLink: (path: string) => Promise<void>;
  /** Opens a space channel already linked to a board channel. */
  onOpen: (channelId: string) => void;
}) {
  const chatApi = useChatApi();
  const connected = connection.connected;
  const [replacing, setReplacing] = useState(false);
  const [token, setToken] = useState("");
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<BoardChannel[] | null>(null);
  const [filter, setFilter] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const showConnect = connection.canConnect && (!connected || replacing);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const loadChannels = useCallback(async () => {
    if (!chatApi.vercelBoardChannelList) return;
    try {
      setChannels((await chatApi.vercelBoardChannelList(space)).channels);
    } catch (failure) {
      setError(failureText(failure));
    }
  }, [chatApi, space]);

  useEffect(() => {
    if (connected && !replacing) void loadChannels();
  }, [connected, loadChannels, replacing]);

  const connect = useCallback(async () => {
    const pasted = token.trim();
    if (!pasted || busy || !chatApi.vercelBoardConnect) return;
    setBusy("connect");
    setError(null);
    try {
      const result = await chatApi.vercelBoardConnect(space, { token: pasted, ...(team ? { team } : {}) });
      if ("needsTeam" in result) {
        setTeams(result.teams);
        setTeam(result.teams[0]?.slug ?? "");
        return;
      }
      // Out of the page's memory once the server holds it.
      setToken("");
      setTeams(null);
      setReplacing(false);
      await onChanged();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }, [busy, chatApi, onChanged, space, team, token]);

  const disconnect = useCallback(async () => {
    if (busy || !chatApi.vercelBoardDisconnect) return;
    setBusy("disconnect");
    setError(null);
    try {
      await chatApi.vercelBoardDisconnect(space);
      setChannels(null);
      await onChanged();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }, [busy, chatApi, onChanged, space]);

  const link = useCallback(async (path: string) => {
    if (busy) return;
    setBusy(path);
    setError(null);
    try {
      await onLink(path);
      await loadChannels();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }, [busy, loadChannels, onLink]);

  const needle = filter.trim().toLowerCase();
  const shown = (channels ?? []).filter((channel) => !needle || channel.path.toLowerCase().includes(needle));

  return (
    <div className="chat-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="chat-sheet chat-board-sheet" role="dialog" aria-modal="true" aria-label="Vercel Board">
        <div className="chat-sheet-title">
          <h2>Vercel Board</h2>
          <button type="button" className="chat-rpanel-close" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close">×</button>
        </div>

        {connected && !replacing ? (
          <section className="chat-sheet-sec" aria-label="Connection">
            <p className="chat-sheet-explain">
              {`Connected to ${connected.teamName}'s board. What people write in a linked channel posts there as ${connected.as}, under each person's own name.`}
            </p>
            {connection.canConnect ? (
              <div className="chat-board-sheet-actions">
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => { setReplacing(true); setError(null); }}>Replace token</button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void disconnect()}>
                  {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {showConnect ? (
          <>
            <section className="chat-sheet-sec" aria-label="Make a token">
              <h3 className="chat-board-step">1. Make a token on Vercel</h3>
              <ol className="chat-board-steps">
                <li>Open <a href={connection.tokensUrl} target="_blank" rel="noreferrer">Vercel's tokens page</a>.</li>
                <li>Name it after this space, for example <code>scout-chat</code>.</li>
                <li>For Scope, choose your team, then <strong>All Projects</strong>. The team opens a list of its projects, so picking its name alone selects nothing.</li>
                <li>Pick an expiration, then Create, and Copy the token Vercel shows.</li>
              </ol>
            </section>
            <section className="chat-sheet-sec" aria-label="Paste the token">
              <h3 className="chat-board-step">2. Paste it here</h3>
              <input
                className="chat-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                placeholder="Vercel token"
                aria-label="Vercel token"
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void connect(); } }}
              />
              {teams ? (
                teams.length ? (
                  <div className="chat-board-teams" role="radiogroup" aria-label="Team">
                    <p className="chat-sheet-explain">That token reaches more than one team. Which team's board?</p>
                    {teams.map((option) => (
                      <label key={option.id} className="chat-board-team">
                        <input type="radio" name="board-team" checked={team === option.slug} onChange={() => setTeam(option.slug)} />
                        <span>{option.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="chat-board-teams">
                    <span className="chat-sheet-explain">That token can't list its teams. Type the team's name from its Vercel address, vercel.com/<em>name</em>.</span>
                    <input className="chat-input" value={team} placeholder="team-name" aria-label="Team name" onChange={(event) => setTeam(event.target.value.trim())} />
                  </label>
                )
              ) : null}
              <div className="chat-board-sheet-actions">
                <button type="button" className="btn btn--sm" disabled={!token.trim() || busy !== null || (teams !== null && !team)} onClick={() => void connect()}>
                  {busy === "connect" ? "Checking…" : "Connect"}
                </button>
                {replacing ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setReplacing(false); setToken(""); setTeams(null); }}>Cancel</button> : null}
              </div>
              <p className="chat-sheet-foot">
                The space checks the token reads your team's board before it keeps it. It is sealed to this space and never shown again. The space only reads the board and posts to it; it can't claim, edit, or delete anything there.
              </p>
            </section>
          </>
        ) : null}

        {!connected && !connection.canConnect ? (
          <p className="chat-sheet-explain">The space owner connects a Vercel team's board. Once they do, you can link its channels here.</p>
        ) : null}

        {connected && !replacing ? (
          <section className="chat-sheet-sec" aria-label="Board channels">
            <h3 className="chat-board-step">Channels</h3>
            <p className="chat-sheet-explain">Link a board channel to show it in this space. Everyone in the space can read it and write to it.</p>
            {channels && channels.length > 8 ? (
              <input className="chat-input" value={filter} placeholder="Filter channels" aria-label="Filter board channels" onChange={(event) => setFilter(event.target.value)} />
            ) : null}
            {channels === null ? <p className="chat-sheet-explain">Reading the board…</p> : null}
            {channels && !channels.length ? <p className="chat-sheet-explain">The board has no channels yet. A channel appears on the board with its first post.</p> : null}
            <ul className="chat-board-channels">
              {shown.map((channel) => (
                <li key={channel.path}>
                  <span className="chat-board-channel-path">{channel.path}</span>
                  {channel.linked ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => { onOpen(channel.linked!); onClose(); }}>Open</button>
                  ) : (
                    <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void link(channel.path)}>
                      {busy === channel.path ? "Linking…" : "Link"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? <p className="chat-sheet-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
