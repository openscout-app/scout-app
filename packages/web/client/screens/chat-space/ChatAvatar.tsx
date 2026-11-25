/**
 * Identity at cue size.
 *
 * People are initial coins on a deterministic neutral fill — the fill is
 * derived with the same `actorColor` hash the rest of the client uses, mixed
 * down into `--muted` so a roster of humans reads as one neutral set rather
 * than a color rainbow. Agents are the existing generative sprite (shape is
 * WHO, hue is HARNESS, brightness is STATE) with their owner's coin inset, so
 * "Maya's Codex" is legible as Maya's without reading the name.
 */

import { createContext, useContext, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";

import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { SpriteAvatar, agentSpriteProps } from "../../components/SpriteAvatar.tsx";
import { InitialsAvatar } from "../../components/InitialsAvatar.tsx";
import { projectNameFromRoot } from "../../lib/avatar-initials.ts";
import { useOptionalScout } from "../../scout/Provider.tsx";
import { actorColor } from "../../lib/colors.ts";
import type { ChannelMemberView } from "./chat-api.ts";
import { initialsFor, isAgentMember, memberDisplayName } from "./chat-space-model.ts";

export function coinFill(name: string): string {
  return `color-mix(in srgb, var(--muted) 82%, ${actorColor(name)})`;
}

export function MemberCoin({
  name,
  size = 24,
  className,
  title,
}: {
  name: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  if (useOptionalScout()?.appearanceDetails?.avatarStyle === "initials") {
    return <InitialsAvatar label={name} shape="circle" size={size} {...(className ? { className } : {})} title={title ?? name} />;
  }
  const style: CSSProperties = {
    width: size,
    height: size,
    background: coinFill(name),
    fontSize: Math.max(7, Math.round(size * 0.38)),
  };
  return (
    <span className={`chat-coin${className ? ` ${className}` : ""}`} style={style} title={title}>
      {initialsFor(name)}
    </span>
  );
}

export function AgentSprite({
  member,
  size = 24,
  className,
}: {
  member: ChannelMemberView;
  size?: number;
  className?: string;
}) {
  const sprite = agentSpriteProps({
    harness: member.harness ?? null,
    state: member.activity?.status ?? null,
  });
  const owner = member.owner?.displayName?.trim() || null;
  return (
    <span
      className={`chat-sprite${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      title={memberDisplayName(member)}
    >
      <SpriteAvatar
        name={member.displayName || member.actorId}
        size={size}
        {...(sprite.hue === undefined ? {} : { hue: sprite.hue })}
        tone={sprite.tone}
        tile
      />
      {owner ? (
        <span
          className="chat-sprite-owner"
          style={{
            background: coinFill(owner),
            width: Math.max(10, Math.round(size * 0.46)),
            height: Math.max(10, Math.round(size * 0.46)),
            fontSize: Math.max(5, Math.round(size * 0.24)),
          }}
          aria-hidden="true"
        >
          {owner.slice(0, 1).toUpperCase()}
        </span>
      ) : null}
    </span>
  );
}

/**
 * How a surface marks who is who. `faces` is the avatar the appearance picks.
 * `harness` is every chat surface, local and hosted: an agent carries its
 * harness mark (what it runs on, never a made-up face); a person keeps the
 * same initial coin used by the faces treatment when no profile photo exists.
 */
export type ChatAvatarMode = "faces" | "harness";
export const ChatAvatarModeContext = createContext<ChatAvatarMode>("faces");
export function useChatAvatarMode(): ChatAvatarMode {
  return useContext(ChatAvatarModeContext);
}

/** The harness an agent runs on, in words, for beside its name; null for a person or in faces mode. */
export function useMemberHarnessLabel(member: ChannelMemberView): string | null {
  const mode = useChatAvatarMode();
  if (mode !== "harness" || !isAgentMember(member) || !member.harness) return null;
  return harnessLabel(member.harness);
}

/** One avatar for either kind of member. */
export function MemberAvatar({
  member,
  size = 24,
  className,
}: {
  member: ChannelMemberView;
  size?: number;
  className?: string;
}) {
  const mode = useChatAvatarMode();
  const avatarStyle = useOptionalScout()?.appearanceDetails?.avatarStyle;
  if (member.avatarUrl) {
    return <img className={`chat-provider-avatar${className ? ` ${className}` : ""}`} src={member.avatarUrl} alt="" width={size} height={size} loading="lazy" />;
  }
  if (mode === "harness" && isAgentMember(member)) {
    const cell = `chat-harness-cell${className ? ` ${className}` : ""}`;
    // No known harness (Hosted Chat's API agents have none): keep the slot, draw nothing.
    // The lettered fallback would show "U" for "unknown", a face the agent does not have.
    if (!member.harness?.trim()) {
      return <span className={cell} data-empty="true" style={{ width: size, height: size }} title={memberDisplayName(member)} />;
    }
    return (
      <span className={cell} style={{ width: size, height: size }} title={memberDisplayName(member)}>
        <HarnessMark harness={member.harness ?? null} size={Math.max(9, Math.round(size * 0.6))} title={null} />
      </span>
    );
  }
  // Initials (Appearance): agents show their project's letters, people a circle.
  if (avatarStyle === "initials") {
    const agent = isAgentMember(member);
    const name = member.displayName || member.actorId;
    return (
      <InitialsAvatar
        label={agent ? (projectNameFromRoot(member.projectRoot) ?? name) : name}
        shape={agent ? "square" : "circle"}
        size={size}
        {...(className ? { className } : {})}
        title={memberDisplayName(member)}
      />
    );
  }
  return isAgentMember(member)
    ? <AgentSprite member={member} size={size} {...(className ? { className } : {})} />
    : (
      <MemberCoin
        name={member.displayName || member.actorId}
        size={size}
        {...(className ? { className } : {})}
        title={member.displayName}
      />
    );
}

/**
 * Up to four faces and the split count. Never "7 members": members is a mixed
 * set, and people-vs-agents is the useful fact.
 */
export function Facepile({
  members,
  countLabel,
  hereActorIds,
  onOpen,
  label: shownLabel,
  triggerHost,
}: {
  members: ChannelMemberView[];
  countLabel: string;
  /** Words in place of the count; the count stays in the accessible name. */
  label?: string;
  /** Members seen in this channel moments ago; their faces go first and carry a dot. */
  hereActorIds?: ReadonlySet<string>;
  onOpen: () => void;
  triggerHost?: HTMLElement | null;
}) {
  const here = hereActorIds ?? new Set<string>();
  // The pile stays on agents' harness marks; the roster names the people.
  const harnessMode = useChatAvatarMode() === "harness";
  const visible = [...members]
    .filter((member) => !harnessMode || (isAgentMember(member) && Boolean(member.harness?.trim())))
    .sort((a, b) => Number(here.has(b.actorId)) - Number(here.has(a.actorId)))
    .slice(0, 3);
  const hereCount = members.filter(member => here.has(member.actorId)).length;
  const label = `Members: ${countLabel}${hereCount ? `, ${hereCount} here recently` : ""}`;
  const trigger = <button type="button" className="chat-facepile" onClick={onOpen} aria-label={label} title={label}>
    <span className="chat-facepile-faces">
      {visible.length === 0 ? <Users className="chat-pile-glyph" size={14} aria-hidden="true" /> : null}
      {visible.map((member) => (
        <span key={member.actorId} className="chat-facepile-face" data-here={here.has(member.actorId) ? "true" : undefined}>
          <MemberAvatar member={member} size={20} />
        </span>
      ))}
    </span>
    <span className="chat-pile-count">{shownLabel ?? (members.length || "…")}</span>
  </button>;
  return triggerHost ? createPortal(trigger, triggerHost) : trigger;
}
