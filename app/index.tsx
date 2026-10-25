import { useRuntime } from '@/providers/runtime-provider';
import { Redirect } from "expo-router";
import { View } from "react-native";

import { useStartTarget } from "@/hooks/use-onboarding";
import { colors } from "@/theme/tokens";

export default function IndexRoute() {
  const target = useStartTarget();
  const runtime = useRuntime();
  if (runtime.linkedHost || runtime.handoffLocked) return <Redirect href="/connect" />;
  if (!target) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return <Redirect href={target} />;
}
