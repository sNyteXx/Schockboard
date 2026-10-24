import "react-native-gesture-handler";
// Registers the background sync task at module scope (required by Android).
import "@/remote/background";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RuntimeProvider>
        <RootNavigation />
      </RuntimeProvider>
    </GestureHandlerRootView>
  );
}
