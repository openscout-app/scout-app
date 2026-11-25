/**
 * Message — write to one agent from here; Send opens its chat.
 *
 * Shows:  the composer: To (the last recipient, then agents in recent
 *         projects, then the rest by last update; each row shows its state;
 *         agents that cannot receive go last), the text, the runtime chip
 *         (harness, model, effort; the agent's own unless changed) and Send.
 *         A failed send keeps the draft and says why. It draws in the Mac
 *         app's /embed/home too: Home has no host composer.
 * Data:   useScout().agents for To; /api/runner/options once per agent's
 *         project for the runtime chip ("Check now" forces it). No polling.
 * Scope:  machine: "This page's machine" (the page's ?machineId=) or one
 *         machine, narrowing To; "" = every machine.
 * Opens:  Send: POST /api/send into the agent's chat, then the conversation.
 */
import { QuietStartPanel, useHomeScope } from "../../home/home-panels.tsx";
import { homePanelMachine } from "../../home/home-view.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { homeMachineScope } from "./home-shared.tsx";

function HomeMessagePanel({ route, navigate, config }: ModuleProps) {
  // the fleet is not needed to narrow agents; the roster is
  const { agents } = useHomeScope(null, homePanelMachine(route, config));
  return (
    <div className="vw-home vw-home--message">
      <QuietStartPanel agents={agents} navigate={navigate} head={false} />
    </div>
  );
}

export const homeMessageModule = defineModule({
  type: "home-message",
  title: "Message",
  blurb: "Write to one agent; Send opens its chat",
  docs: {
    shows: "To (last recipient, then recent projects), the text, the runtime chip and Send; a failed send keeps the draft.",
    data: "useScout().agents; /api/runner/options once per agent's project. No polling.",
    opens: "Send: the agent's conversation.",
  },
  size: { w: 4, h: 6 },
  // the text box over one toolbar row (To, runtime, Send)
  minSize: { w: 3, h: 5 },
  scopes: [homeMachineScope],
  // as tall as what it holds, up to its cell
  fit: true,
  Component: HomeMessagePanel,
});
