import { Tabs } from "expo-router";
import { Text } from "react-native";

import { AuthGate, useRuntime } from "@/providers/runtime-provider";
import { colors } from "@/theme/tokens";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, color: focused ? colors.text : colors.muted }}>{label}</Text>;
}

export default function TabsLayout() {
  const runtime = useRuntime();
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
          },
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.muted,
          sceneStyle: {
            backgroundColor: colors.bg,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Board", tabBarIcon: ({ focused }) => <TabIcon label="📊" focused={focused} /> }} />
        <Tabs.Screen name="sessions" options={{ title: "Abende", tabBarIcon: ({ focused }) => <TabIcon label="🎲" focused={focused} /> }} />
        <Tabs.Screen name="cashbox" options={{ title: "Kasse", tabBarIcon: ({ focused }) => <TabIcon label="💰" focused={focused} /> }} />
        <Tabs.Screen name="history" options={{ title: "Log", tabBarIcon: ({ focused }) => <TabIcon label="📋" focused={focused} /> }} />
        <Tabs.Screen name="settings" options={{ title: "Setup", tabBarIcon: ({ focused }) => <TabIcon label="⚙️" focused={focused} /> }} />
        <Tabs.Screen name="session/[id]" options={{ href: null, title: "Spielabend" }} />
      </Tabs>
    </AuthGate>
  );
}
