import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { RuntimeProvider } from "@/providers/runtime-provider";
import { colors } from "@/theme/tokens";

export default function RootLayout() {
  return (
    <RuntimeProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.bg,
          },
        }}
      />
    </RuntimeProvider>
  );
}
