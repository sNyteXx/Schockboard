import { Redirect } from "expo-router";

/** /setup re-runs the first-start assistant on demand. */
export default function SetupScreen() {
  return <Redirect href="/onboarding" />;
}
