import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandEmblem } from "@/components/brand";
import { PressableScale } from "@/components/motion";
import { TourProvider, TourTarget, TOUR_TARGETS } from "@/components/tour";
import { AuthGate, useRuntime } from "@/providers/runtime-provider";
import { Feedback } from "@/services/haptics";
import { colors, radius, spacing } from "@/theme/tokens";
import { useDeviceLayout } from "@/hooks/use-device-layout";
import { fonts } from "@/theme/typography";
import { useTheme } from "@/theme/use-theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: Array<{ name: string; title: string; icon: IconName }> = [
  { name: "index", title: "Board", icon: "grid" },
  { name: "sessions", title: "Abende", icon: "dice" },
  { name: "stats", title: "Statistik", icon: "stats-chart" },
  { name: "cashbox", title: "Kasse", icon: "wallet" },
  { name: "history", title: "Log", icon: "time" },
  { name: "settings", title: "Setup", icon: "settings" },
];

/** The evening detail lives under "Abende" in the navigation. */
function activeTabName(routeName: string) {
  return routeName === "session/[id]" ? "sessions" : routeName;
}

function AppTabBar({ state, navigation, rail, themeId }: BottomTabBarProps & { rail: boolean; themeId: string }) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const active = activeTabName(state.routes[state.index]?.name ?? "index");

  const items = TABS.map((tab) => {
    const route = state.routes.find((candidate) => candidate.name === tab.name);
    if (!route) return null;
    const focused = active === tab.name;
    const onPress = () => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!event.defaultPrevented && state.routes[state.index]?.name !== tab.name) {
        Feedback.tap();
        navigation.navigate(route.name, route.params);
      }
    };
    const item = (
      <PressableScale
        key={tab.name}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={tab.title}
        onPress={onPress}
        pressedScale={0.92}
        style={{ alignItems: "center", justifyContent: "center", gap: 4, minHeight: rail ? 64 : 56, width: "100%" }}
      >
        <View
          style={{
            width: rail ? 56 : 60,
            height: 32,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: focused ? colors.accentSoft : "transparent",
          }}
        >
          <Ionicons name={(focused ? tab.icon : `${tab.icon}-outline`) as IconName} size={22} color={focused ? colors.accentStrong : colors.muted} />
        </View>
        <Text
          numberOfLines={1}
          style={[t.caption, { color: focused ? colors.text : colors.muted, fontFamily: focused ? fonts.semibold : fonts.medium }]}
        >
          {tab.title}
        </Text>
      </PressableScale>
    );
    if (tab.name !== "cashbox") return <View key={tab.name} style={{ flex: rail ? undefined : 1, width: rail ? "100%" : undefined }}>{item}</View>;
    return (
      <TourTarget key={tab.name} id={TOUR_TARGETS.cashboxTab} onPress={onPress} style={{ flex: rail ? undefined : 1, width: rail ? "100%" : undefined }}>
        {item}
      </TourTarget>
    );
  });

  if (rail) {
    return (
      <View
        accessibilityRole="tablist"
        style={{
          width: 100,
          backgroundColor: colors.tabBar,
          borderRightWidth: 1,
          borderRightColor: colors.border,
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          alignItems: "center",
          gap: spacing.xs,
        }}
      >
        <View style={{ marginBottom: spacing.md }}>
          <BrandEmblem size={36} themeId={themeId as never} />
        </View>
        {items}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: colors.tabBar,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 6),
        paddingHorizontal: 4,
      }}
    >
      {items}
    </View>
  );
}

export default function TabsLayout() {
  const runtime = useRuntime();
  const { isTablet } = useDeviceLayout();

  return (
    <AuthGate>
      <TourProvider>
      <Tabs
        tabBar={(props) => <AppTabBar {...props} rail={isTablet} themeId={runtime.themeId} />}
        screenOptions={{
          headerShown: false,
          tabBarPosition: isTablet ? "left" : "bottom",
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
        ))}
        <Tabs.Screen name="session/[id]" options={{ href: null, title: "Spielabend" }} />
      </Tabs>
      </TourProvider>
    </AuthGate>
  );
}
