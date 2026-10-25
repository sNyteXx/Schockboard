import Ionicons from "@expo/vector-icons/Ionicons";
import { Picker } from "@react-native-picker/picker";
import { LinearGradient } from "expo-linear-gradient";
import { Children, forwardRef, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AnimatedNumber, PressableScale, enterCard, enterFade } from "@/components/motion";
import { Sparkline } from "@/components/charts/sparkline";
import { TourScrollContext, useTourScroller } from "@/components/tour/tour-target";
import { useDeviceLayout } from "@/hooks/use-device-layout";
import { colors, radius, spacing } from "@/theme/tokens";
import type { TypeVariant } from "@/theme/typography";
import { themedStyles, useTheme } from "@/theme/use-theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export type Tone = "default" | "accent" | "success" | "warning" | "danger";
type TextTone = "default" | "muted" | "subtle" | "accent" | "success" | "warning" | "danger" | "onAccent";

const useStyles = themedStyles(({ c, t, sizeClass }) => {
  const roomy = sizeClass !== "compact";
  return {
    screen: { flex: 1, backgroundColor: c.bg },
    scroll: { width: "100%", alignSelf: "center", paddingTop: roomy ? spacing.lg : spacing.md, paddingBottom: spacing.xxl },
    card: {
      gap: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      backgroundColor: c.bgElevated,
      padding: roomy ? spacing.lg - 4 : spacing.md,
      minWidth: 0,
      overflow: "hidden",
    },
    cardAccent: { borderColor: c.borderStrong, backgroundColor: c.surface },
    cardFlat: { backgroundColor: c.surface, borderColor: c.border },
    headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 32 },
    headerText: { flex: 1, minWidth: 0, gap: 2 },
    headerIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentSoft,
    },
    overline: { ...t.overline, color: c.subtle },
    heading: { ...t.heading, color: c.text },
    screenHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
    screenTitle: { ...t.title, color: c.text },
    screenContext: { ...t.caption, color: c.muted },
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: c.surfaceSoft,
      borderWidth: 1,
      borderColor: c.border,
    },
    badgeText: { ...t.caption, color: c.text },
    button: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    },
    buttonSm: { minHeight: 36, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
    buttonLg: { minHeight: 56, paddingHorizontal: spacing.lg },
    buttonPrimary: { backgroundColor: c.accent },
    buttonSecondary: { backgroundColor: c.surfaceSoft, borderWidth: 1, borderColor: c.borderStrong },
    buttonGhost: { backgroundColor: "transparent" },
    buttonDanger: { backgroundColor: c.dangerSoft, borderWidth: 1, borderColor: c.dangerSoft },
    buttonLabel: { ...t.label },
    chip: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceSoft,
    },
    chipSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
    chipText: { ...t.label, color: c.muted },
    chipTextSelected: { color: c.text },
    segmented: {
      flexDirection: "row",
      padding: 3,
      gap: 3,
      borderRadius: radius.md,
      backgroundColor: c.surfaceSoft,
      borderWidth: 1,
      borderColor: c.border,
    },
    segment: { flex: 1, minHeight: 36, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, borderRadius: radius.sm, paddingHorizontal: spacing.xs },
    segmentActive: { backgroundColor: c.bgElevated, borderWidth: 1, borderColor: c.borderStrong },
    field: { gap: 6 },
    fieldLabel: { ...t.caption, color: c.muted },
    fieldHint: { ...t.caption, color: c.subtle },
    input: {
      ...t.body,
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: radius.md,
      backgroundColor: c.surfaceSoft,
      color: c.text,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    textArea: { minHeight: 96, textAlignVertical: "top", paddingTop: spacing.sm },
    selectWrap: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surfaceSoft },
    select: { color: c.text, minHeight: 48 },
    notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1 },
    noticeSuccess: { borderColor: c.successSoft, backgroundColor: c.successSoft },
    noticeError: { borderColor: c.dangerSoft, backgroundColor: c.dangerSoft },
    noticeText: { ...t.body, color: c.text, flex: 1 },
    empty: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
    emptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSoft },
    emptyTitle: { ...t.subheading, color: c.text, textAlign: "center" },
    emptyText: { ...t.body, color: c.muted, textAlign: "center", maxWidth: 520 },
    listRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingVertical: spacing.xs },
    listText: { flex: 1, minWidth: 0, gap: 2 },
    listTitle: { ...t.bodyStrong, color: c.text },
    listDetail: { ...t.caption, color: c.muted },
    listValue: { ...t.numericSm, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    kpi: { gap: spacing.xs, flex: 1, minWidth: 0 },
    kpiTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    kpiIcon: { width: 28, height: 28, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSoft },
    kpiLabel: { ...t.overline, color: c.muted, flex: 1 },
    kpiValue: { ...t.display, color: c.text },
    kpiHint: { ...t.caption, color: c.muted },
    stat: { flex: 1, minWidth: 0, gap: 4, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    statLabel: { ...t.overline, color: c.subtle },
    statValue: { ...t.numeric, color: c.text },
    statHint: { ...t.caption, color: c.muted },
  };
});

const TEXT_TONES: Record<TextTone, () => string> = {
  default: () => colors.text,
  muted: () => colors.muted,
  subtle: () => colors.subtle,
  accent: () => colors.accentStrong,
  success: () => colors.success,
  warning: () => colors.warning,
  danger: () => colors.danger,
  onAccent: () => colors.buttonPrimaryText,
};

/** Every text in the app goes through the type scale. */
export function AppText({
  variant = "body",
  tone = "default",
  align,
  style,
  children,
  ...rest
}: TextProps & { variant?: TypeVariant; tone?: TextTone; align?: TextStyle["textAlign"]; children?: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <Text {...rest} style={[t[variant], { color: TEXT_TONES[tone]() }, align ? { textAlign: align } : null, style]}>
      {children}
    </Text>
  );
}

/**
 * Scrollable page. `footer` renders a sticky area below the scroll view (e.g. a
 * thumb-reachable action bar). `maxWidth` limits reading-heavy screens.
 */
export function Screen({
  children,
  footer,
  maxWidth = 1680,
  scroll: scrollProp = true,
  fixedOnTablet = false,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
  scroll?: boolean;
  /**
   * Tablets: no page scroll – the content fills the window height (flex) and
   * only inner lists scroll (<InnerScroll>). Phones keep page scrolling.
   */
  fixedOnTablet?: boolean;
}) {
  const styles = useStyles();
  const { pagePadding, isTablet } = useDeviceLayout();
  const scroll = scrollProp && !(fixedOnTablet && isTablet);
  const insets = useSafeAreaInsets();
  const content = { maxWidth, paddingHorizontal: pagePadding, gap: isTablet ? spacing.lg - 4 : spacing.md };
  // Lets the first-use tour scroll a highlighted target into view.
  const scrollRef = useRef<ScrollView>(null);
  const innerRef = useRef<View>(null);
  const scroller = useTourScroller(scrollRef, innerRef);
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          innerViewRef={innerRef as React.RefObject<View>}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, content, isTablet && { paddingBottom: spacing.xxl + insets.bottom }]}
        >
          <TourScrollContext.Provider value={scroller}>{children}</TourScrollContext.Provider>
        </ScrollView>
      ) : (
        <View style={[styles.scroll, content, { flex: 1, minHeight: 0, paddingBottom: isTablet ? spacing.lg : spacing.xxl }]}>{children}</View>
      )}
      {footer ? <View style={{ paddingBottom: isTablet ? insets.bottom : 0, backgroundColor: colors.tabBar }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** True when the current screen uses the fixed, non-scrolling tablet layout. */
export function useFixedLayout() {
  return useDeviceLayout().isTablet;
}

/**
 * Scrolling region inside a fixed tablet layout (lists, feeds, long chip
 * sets). Fills the remaining height of its flex parent; tour targets inside
 * stay measurable and can be scrolled into view.
 */
export function InnerScroll({
  children,
  style,
  contentStyle,
  fill = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** flex: 1 inside the parent (default). false = size to content up to the parent's max height. */
  fill?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const innerRef = useRef<View>(null);
  const scroller = useTourScroller(scrollRef, innerRef);
  return (
    <ScrollView
      ref={scrollRef}
      innerViewRef={innerRef as React.RefObject<View>}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      style={[fill ? { flex: 1, minHeight: 0 } : { flexGrow: 0, flexShrink: 1, minHeight: 0 }, style]}
      contentContainerStyle={contentStyle}
    >
      <TourScrollContext.Provider value={scroller}>{children}</TourScrollContext.Provider>
    </ScrollView>
  );
}

/** Flex region that reports its measured height (charts that need a number). */
export function MeasuredFill({ children, style, minHeight = 0 }: { children: (height: number, width: number) => React.ReactNode; style?: StyleProp<ViewStyle>; minHeight?: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View
      style={[{ flex: 1, minHeight }, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width: Math.floor(width), height: Math.floor(height) }));
      }}
    >
      {size.height > 0 ? children(size.height, size.width) : null}
    </View>
  );
}

/** Compact page header: title, context line, optional badge, actions and small emblem. */
export function ScreenHeader({
  title,
  context,
  badge,
  actions,
  leading,
}: {
  title: string;
  context?: string | null;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  /** e.g. <BrandEmblem size={32} /> or a back button. */
  leading?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Animated.View entering={enterFade} style={styles.screenHeader}>
      {leading}
      <View style={styles.headerText}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
          <Text style={styles.screenTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {badge}
        </View>
        {context ? <Text style={styles.screenContext} numberOfLines={2}>{context}</Text> : null}
      </View>
      {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>{actions}</View> : null}
    </Animated.View>
  );
}

export function Stack({ children, gap = spacing.md, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Row({
  children,
  gap = spacing.xs,
  wrap = false,
  align = "center",
  justify,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  wrap?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: "row", alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

/**
 * Side-by-side on tablets, stacked on phones. `weights` gives column spans
 * (12-column feel, e.g. [8, 4]); default equal.
 */
export function Split({
  children,
  gap,
  weights,
  breakpoint = "medium",
  fill = false,
}: {
  children: React.ReactNode;
  gap?: number;
  weights?: number[];
  breakpoint?: "medium" | "expanded";
  /** Side by side: take the remaining height, columns stretch (fixed tablet layouts). */
  fill?: boolean;
}) {
  const { sizeClass, isTablet } = useDeviceLayout();
  const items = Children.toArray(children).filter(Boolean);
  const sideBySide = breakpoint === "expanded" ? sizeClass === "expanded" : isTablet;
  const resolvedGap = gap ?? (isTablet ? spacing.lg - 4 : spacing.md);
  if (!sideBySide) return <View style={{ gap: resolvedGap }}>{items}</View>;
  return (
    <View style={[{ flexDirection: "row", alignItems: fill ? "stretch" : "flex-start", gap: resolvedGap }, fill && { flex: 1, minHeight: 0 }]}>
      {items.map((child, index) => (
        <View key={index} style={[{ flex: weights?.[index] ?? 1, minWidth: 0, gap: resolvedGap }, fill && { minHeight: 0 }]}>{child}</View>
      ))}
    </View>
  );
}

/** Equal-width grid: column count per size class; last row keeps alignment. */
export function Grid({
  children,
  columns,
  gap = spacing.sm,
}: {
  children: React.ReactNode;
  columns: { compact: number; medium: number; expanded: number };
  gap?: number;
}) {
  const { sizeClass } = useDeviceLayout();
  const count = Math.max(1, columns[sizeClass as keyof typeof columns]);
  const items = Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let index = 0; index < items.length; index += count) rows.push(items.slice(index, index + count));
  return (
    <View style={{ gap }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: "row", gap, alignItems: "stretch" }}>
          {row.map((child, index) => <View key={index} style={{ flex: 1, minWidth: 0 }}>{child}</View>)}
          {Array.from({ length: count - row.length }, (_, index) => <View key={`pad-${index}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

export function Card({
  children,
  tone = "default",
  style,
  animated = true,
}: {
  children: React.ReactNode;
  /** hero = subtle accent gradient (KPI tiles only). */
  tone?: "default" | "accent" | "flat" | "hero";
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
}) {
  const styles = useStyles();
  return (
    <Animated.View entering={animated ? enterCard : undefined} style={[styles.card, tone === "accent" && styles.cardAccent, tone === "flat" && styles.cardFlat, tone === "hero" && { borderColor: colors.borderStrong }, style]}>
      {tone === "hero" ? (
        <LinearGradient
          pointerEvents="none"
          colors={[colors.heroFrom, colors.heroTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

/** Card heading: optional icon tile, overline + heading, right-side slot. */
export function CardHeader({ title, overline, icon, aside }: { title: string; overline?: string; icon?: IconName; aside?: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.headerRow}>
      {icon ? (
        <View style={styles.headerIcon}>
          <Ionicons name={icon} size={17} color={colors.accentStrong} />
        </View>
      ) : null}
      <View style={styles.headerText}>
        {overline ? <Text style={styles.overline} numberOfLines={1}>{overline}</Text> : null}
        <Text style={styles.heading} numberOfLines={2} accessibilityRole="header">{title}</Text>
      </View>
      {aside}
    </View>
  );
}

/** Back-compat alias of CardHeader. */
export function SectionTitle({ eyebrow, title, aside, icon }: { eyebrow?: string; title: string; aside?: React.ReactNode; icon?: IconName }) {
  return <CardHeader overline={eyebrow} title={title} aside={aside} icon={icon} />;
}

const BADGE_COLORS: Record<Tone, () => { bg: string; fg: string; border: string }> = {
  default: () => ({ bg: colors.surfaceSoft, fg: colors.text, border: colors.border }),
  accent: () => ({ bg: colors.accentSoft, fg: colors.accentStrong, border: colors.accentSoft }),
  success: () => ({ bg: colors.successSoft, fg: colors.success, border: colors.successSoft }),
  warning: () => ({ bg: colors.warningSoft, fg: colors.warning, border: colors.warningSoft }),
  danger: () => ({ bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft }),
};

export function Badge({ children, tone = "default", icon, dot }: { children: React.ReactNode; tone?: Tone; icon?: IconName; dot?: boolean }) {
  const styles = useStyles();
  const palette = BADGE_COLORS[tone]();
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {dot ? <LiveDot color={palette.fg} /> : null}
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} /> : null}
      <Text style={[styles.badgeText, { color: palette.fg }]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

/** Pulsing status dot (static with reduce motion). */
export function LiveDot({ color, size = 7 }: { color: string; size?: number }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export function Button({
  children,
  tone = "primary",
  size = "md",
  icon,
  iconRight,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconRight?: IconName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const fg = tone === "primary" ? colors.buttonPrimaryText : tone === "danger" ? colors.danger : tone === "ghost" ? colors.accentStrong : colors.text;
  const iconSize = size === "sm" ? 16 : size === "lg" ? 20 : 18;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        size === "sm" && styles.buttonSm,
        size === "lg" && styles.buttonLg,
        tone === "primary" && styles.buttonPrimary,
        tone === "secondary" && styles.buttonSecondary,
        tone === "ghost" && styles.buttonGhost,
        tone === "danger" && styles.buttonDanger,
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={iconSize} color={fg} /> : null}
      <Text style={[styles.buttonLabel, { color: fg }]} numberOfLines={1}>{children}</Text>
      {iconRight ? <Ionicons name={iconRight} size={iconSize} color={fg} /> : null}
    </PressableScale>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  tone = "secondary",
  size = 40,
  disabled,
  color,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  tone?: "primary" | "secondary" | "ghost";
  size?: number;
  disabled?: boolean;
  color?: string;
}) {
  const bg = tone === "primary" ? colors.accent : tone === "secondary" ? colors.surfaceSoft : "transparent";
  const fg = color ?? (tone === "primary" ? colors.buttonPrimaryText : colors.text);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      pressedScale={0.9}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: tone === "secondary" ? 1 : 0,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </PressableScale>
  );
}

/** Selectable pill (filters, player picks, presets). */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  leading,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  leading?: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, leading ? { paddingLeft: 4 } : null, disabled && { opacity: 0.5 }]}
    >
      {leading}
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.accentStrong : colors.muted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
    </PressableScale>
  );
}

/** Segmented control for 2–5 mutually exclusive options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; icon?: IconName }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => { if (!active) onChange(option.value); }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {option.icon ? <Ionicons name={option.icon} size={15} color={active ? colors.accentStrong : colors.muted} /> : null}
            <Text style={[styles.chipText, active && styles.chipTextSelected]} numberOfLines={1}>{option.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * KPI tile with count-up value and optional sparkline. `tone="hero"` adds the
 * subtle gradient – use it for the one or two most important numbers only.
 */
export function KpiTile({
  label,
  value,
  format,
  hint,
  icon,
  tone = "default",
  sparkline,
  sparkColor,
  valueTone = "default",
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  hint?: string;
  icon?: IconName;
  tone?: "default" | "hero";
  sparkline?: number[];
  sparkColor?: string;
  valueTone?: TextTone;
}) {
  const styles = useStyles();
  return (
    <Card tone={tone === "hero" ? "hero" : "default"} style={{ flex: 1, gap: spacing.xs }}>
      <View style={styles.kpiTop}>
        {icon ? (
          <View style={[styles.kpiIcon, tone === "hero" && { backgroundColor: colors.accentSoft }]}>
            <Ionicons name={icon} size={15} color={tone === "hero" ? colors.accentStrong : colors.muted} />
          </View>
        ) : null}
        <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
        <AnimatedNumber value={value} format={format} style={[styles.kpiValue, { color: TEXT_TONES[valueTone]() }, { flexShrink: 1 }]} />
        {sparkline && sparkline.length > 1 ? (
          <View style={{ flex: 1, minWidth: 64, maxWidth: 160, paddingBottom: 6 }}>
            <Sparkline data={sparkline} height={34} color={sparkColor ?? colors.accent} />
          </View>
        ) : null}
      </View>
      {hint ? <Text style={styles.kpiHint} numberOfLines={2}>{hint}</Text> : null}
    </Card>
  );
}

/** Compact stat tile for records / secondary numbers. */
export function StatTile({ label, value, hint, icon, tone = "default" }: { label: string; value: string; hint?: string; icon?: IconName; tone?: Tone }) {
  const styles = useStyles();
  const iconColor = tone === "default" ? colors.muted : BADGE_COLORS[tone]().fg;
  return (
    <View style={styles.stat}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Ionicons name={icon} size={14} color={iconColor} /> : null}
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text style={styles.statHint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

/** Back-compat: label / value / hint tile. */
export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <StatTile label={label} value={value} hint={hint} />;
}

export function InlineRow({ children }: { children: React.ReactNode }) {
  const { isTablet } = useDeviceLayout();
  return <View style={[{ gap: spacing.sm }, isTablet && { flexDirection: "row", alignItems: "center" }]}>{children}</View>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input(props, ref) {
  const styles = useStyles();
  const { style, ...rest } = props;
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.subtle}
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      {...rest}
      style={[styles.input, props.multiline && styles.textArea, style]}
    />
  );
});

export function Select({
  selectedValue,
  onValueChange,
  items,
}: {
  selectedValue: string;
  onValueChange: (value: string) => void;
  items: Array<{ label: string; value: string }>;
}) {
  const styles = useStyles();
  return (
    <View style={styles.selectWrap}>
      <Picker
        selectedValue={selectedValue}
        onValueChange={(value) => onValueChange(String(value))}
        dropdownIconColor={colors.muted}
        style={styles.select}
      >
        {items.map((item) => (
          <Picker.Item key={item.value} label={item.label} value={item.value} />
        ))}
      </Picker>
    </View>
  );
}

export function Notice({ message, type }: { message: string; type: "success" | "error" }) {
  const styles = useStyles();
  return (
    <Animated.View entering={enterFade} accessibilityLiveRegion="polite" style={[styles.notice, type === "success" ? styles.noticeSuccess : styles.noticeError]}>
      <Ionicons name={type === "success" ? "checkmark-circle" : "alert-circle"} size={20} color={type === "success" ? colors.success : colors.danger} />
      <Text style={styles.noticeText}>{message}</Text>
    </Animated.View>
  );
}

export function EmptyState({ children, icon = "sparkles-outline", title, action }: { children?: React.ReactNode; icon?: IconName; title?: string; action?: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={20} color={colors.muted} />
      </View>
      {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
      {children ? <Text style={styles.emptyText}>{children}</Text> : null}
      {action}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.divider, style]} />;
}

export function ListRow({
  title,
  detail,
  value,
  leading,
  trailing,
  onPress,
  valueTone = "default",
  accessibilityLabel,
}: {
  title: string;
  detail?: string | null;
  value?: string | React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  valueTone?: TextTone;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();
  const body = (
    <>
      {leading}
      <View style={styles.listText}>
        <Text style={styles.listTitle} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={styles.listDetail} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {typeof value === "string" ? <Text style={[styles.listValue, { color: TEXT_TONES[valueTone]() }]}>{value}</Text> : value ?? null}
      {trailing}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{body}</View>;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} pressedScale={0.985} style={styles.listRow}>
      {body}
    </PressableScale>
  );
}

/** Pulsing placeholder block. */
export function Skeleton({ width = "100%", height = 16, rounded = radius.sm, style }: { width?: ViewStyle["width"]; height?: number; rounded?: number; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surfaceSoft }, animated, style]} />;
}

/** Screen-shaped loading placeholder (instead of a lone spinner). */
export function SkeletonScreen({ variant = "dashboard" }: { variant?: "dashboard" | "list" | "board" | "form" }) {
  const { isTablet } = useDeviceLayout();
  const tile = (key: string | number, height: number) => (
    <View key={key} style={{ flex: 1, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated, padding: spacing.md, gap: spacing.sm, height }}>
      <Skeleton width="40%" height={10} />
      <Skeleton width="65%" height={height > 120 ? 28 : 18} />
      {height > 120 ? <Skeleton width="85%" height={10} /> : null}
    </View>
  );
  const columns = isTablet ? (variant === "board" ? 4 : 3) : variant === "board" ? 2 : 1;
  return (
    <Screen>
      <View accessibilityLabel="Lädt …" style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
        <Skeleton width={180} height={26} />
        <Skeleton width={260} height={12} />
      </View>
      {variant === "dashboard" ? <View style={{ flexDirection: isTablet ? "row" : "column", gap: spacing.sm }}>{[0, 1, 2].map((key) => tile(key, 132))}</View> : null}
      {Array.from({ length: variant === "list" ? 5 : 2 }, (_, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: "row", gap: spacing.sm }}>
          {Array.from({ length: variant === "list" ? 1 : columns }, (_, index) => tile(index, variant === "list" ? 72 : variant === "board" ? 170 : 200))}
        </View>
      ))}
    </Screen>
  );
}

/** Full-screen load failure with retry – never leave the user on a spinner. */
export function LoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <Screen maxWidth={720}>
      <Card>
        <CardHeader overline="Fehler" title="Daten konnten nicht geladen werden" icon="cloud-offline-outline" />
        <Notice type="error" message={error.message} />
        <Button icon="refresh" onPress={onRetry}>Erneut versuchen</Button>
      </Card>
    </Screen>
  );
}
