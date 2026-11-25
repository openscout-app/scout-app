import "@openscout/runtime/instance-checkout-bootstrap";
import { enforceOpenScoutInstanceIsolation } from "@openscout/runtime/instance";
import { runPairingRuntimeController } from "@openscout/pairing/controller";
enforceOpenScoutInstanceIsolation("the pairing controller");
await runPairingRuntimeController();
