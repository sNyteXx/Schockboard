import "react-native-gesture-handler";

import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold";
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { TableLock } from '@/components/table-lock';
import { DialogHost } from "@/components/dialog";
import { RuntimeProvider, useRuntime } from "@/providers/runtime-provider";
import { colors } from "@/theme/tokens";

function RootNavigation() {
  // Subscribing to the runtime re-renders the stack background on theme switch.
  useRuntime();
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
  // Weight lives in the family name (see src/theme/typography.ts).
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      {fontsLoaded || fontError ? (
        <RuntimeProvider>
          <RootNavigation />
          {/* In-app replacement for Android's system dialogs (see components/dialog). */}
          <DialogHost />
          <TableLock />
        </RuntimeProvider>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
