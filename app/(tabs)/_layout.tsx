import { Tabs } from "expo-router";
import { Text } from "react-native";

import { AuthGate, useRuntime } from "@/providers/runtime-provider";
import { colors } from "@/theme/tokens";
import { useDeviceLayout } from "@/hooks/use-device-layout";

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, fontWeight: "900", color: focused ? colors.accentStrong : colors.muted }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const runtime = useRuntime();
  const { isTablet } = useDeviceLayout();
  // Force re-render when theme changes by reading dataVersion
  const _v = runtime.dataVersion;

  return (
    <AuthGate>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            borderRightColor: colors.border,
            borderRightWidth: isTablet ? 1 : 0,
            width: isTablet ? 88 : undefined,
            height: isTablet ? undefined : 66,
          },
          tabBarPosition: isTablet ? "left" : "bottom",
          tabBarVariant: isTablet ? "material" : "uikit",
          tabBarLabelPosition: "below-icon",
          tabBarLabelStyle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.25 },
          tabBarItemStyle: { borderRadius: 14, marginVertical: isTablet ? 4 : 0 },
          tabBarActiveTintColor: colors.accentStrong,
          tabBarInactiveTintColor: colors.muted,
          sceneStyle: {
            backgroundColor: colors.bg,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Board", tabBarIcon: ({ focused }) => <TabIcon symbol="◈" focused={focused} /> }} />
        <Tabs.Screen name="sessions" options={{ title: "Abende", tabBarIcon: ({ focused }) => <TabIcon symbol="⚄" focused={focused} /> }} />
        <Tabs.Screen name="cashbox" options={{ title: "Kasse", tabBarIcon: ({ focused }) => <TabIcon symbol="€" focused={focused} /> }} />
        <Tabs.Screen name="history" options={{ title: "Log", tabBarIcon: ({ focused }) => <TabIcon symbol="≡" focused={focused} /> }} />
        <Tabs.Screen name="settings" options={{ title: "Setup", tabBarIcon: ({ focused }) => <TabIcon symbol="⚙" focused={focused} /> }} />
        <Tabs.Screen name="session/[id]" options={{ href: null, title: "Spielabend" }} />
      </Tabs>
    </AuthGate>
  );
}
