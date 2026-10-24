import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { RuntimeProvider, useRuntime } from "@/providers/runtime-provider";
import { colors } from "@/theme/tokens";

function RootNavigation() {
  const { themeId } = useRuntime();
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.bg,
          },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <RuntimeProvider>
      <RootNavigation />
    </RuntimeProvider>
  );
}
