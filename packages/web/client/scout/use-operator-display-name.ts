import { useScout } from "./Provider.tsx";

/**
 * The operator's name as the app shows it. The top row's identity and every
 * other place that draws the operator read it here, so a screen can never
 * show a different name (or a placeholder) for the same person.
 */
export function useOperatorDisplayName(): string | null {
  const { onboarding, operatorName } = useScout();
  return operatorName
    || onboarding?.operatorName?.trim()
    || onboarding?.operatorNameSuggestion?.trim()
    || null;
}
