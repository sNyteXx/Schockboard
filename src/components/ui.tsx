import { Picker } from "@react-native-picker/picker";
import { forwardRef, useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/theme/tokens";
import { useDeviceLayout } from "@/hooks/use-device-layout";

/** Build fresh styles from the current `colors` bag. */
function makeStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.md, gap: spacing.md },
    stack: { gap: spacing.md },
    split: { gap: spacing.md },
    splitTablet: { flexDirection: "row", alignItems: "flex-start" },
    card: {
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.xl,
      backgroundColor: colors.bgElevated,
      padding: spacing.lg,
    },
    cardAccent: { backgroundColor: colors.surface },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    sectionText: { flex: 1, gap: 6 },
    eyebrow: {
      color: colors.accentStrong,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      fontSize: 12,
      fontWeight: "700",
    },
    sectionTitle: { color: colors.text, fontSize: 28, fontFamily: "serif" },
    badge: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      color: colors.text,
      backgroundColor: colors.surfaceSoft,
      overflow: "hidden",
    },
    statLabel: { color: colors.muted, fontSize: 14 },
    statValue: { color: colors.text, fontSize: 26, fontWeight: "700" },
    button: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    buttonPrimary: { backgroundColor: colors.accent },
    buttonSecondary: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.border,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonPressed: { transform: [{ scale: 0.98 }] },
    buttonPrimaryText: { color: colors.buttonPrimaryText, fontWeight: "800" },
    buttonSecondaryText: { color: colors.text, fontWeight: "700" },
    inlineRow: { gap: spacing.sm },
    inlineRowTablet: { flexDirection: "row", alignItems: "center" },
    field: { gap: 6 },
    fieldLabel: { color: colors.muted, fontSize: 14 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceSoft,
      color: colors.text,
      minHeight: 52,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    textArea: { minHeight: 96, textAlignVertical: "top" },
    selectWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      overflow: "hidden",
      backgroundColor: colors.surfaceSoft,
    },
    select: { color: colors.text, minHeight: 52 },
    notice: { borderRadius: radius.md, padding: spacing.md, borderWidth: 1 },
    noticeSuccess: {
      borderColor: "rgba(59, 178, 115, 0.35)",
      backgroundColor: "rgba(59, 178, 115, 0.12)",
    },
    noticeError: {
      borderColor: "rgba(222, 103, 92, 0.35)",
      backgroundColor: "rgba(222, 103, 92, 0.12)",
    },
    noticeText: { color: colors.text },
    empty: { color: colors.muted, lineHeight: 22 },
    muted: { color: colors.muted },
    listRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    listText: { flex: 1, gap: 4 },
    listTitle: { color: colors.text, fontWeight: "700" },
    listValue: { color: colors.text, fontWeight: "700" },
  });
}

let _cachedId = "";
let _cachedStyles = makeStyles();

/** Returns memoised styles that refresh whenever the active theme changes. */
function useStyles() {
  return useMemo(() => {
    if (_cachedId !== colors.id) {
      _cachedStyles = makeStyles();
      _cachedId = colors.id;
    }
    return _cachedStyles;
  }, [colors.id]);
}

const badgeToneStyles = StyleSheet.create({
  success: { backgroundColor: "rgba(59, 178, 115, 0.14)" },
  warning: { backgroundColor: "rgba(228, 177, 70, 0.14)" },
  danger: { backgroundColor: "rgba(222, 103, 92, 0.14)" },
});

export function Screen({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function Stack({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.stack}>{children}</View>;
}

export function Split({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { isTablet } = useDeviceLayout();
  return <View style={[styles.split, isTablet && styles.splitTablet]}>{children}</View>;
}

export function Card({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "accent";
}) {
  const styles = useStyles();
  return <View style={[styles.card, tone === "accent" && styles.cardAccent]}>{children}</View>;
}

export function SectionTitle({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionText}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {aside}
    </View>
  );
}

export function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" | "warning" | "danger" }) {
  const styles = useStyles();
  return <Text style={[styles.badge, tone !== "default" && badgeToneStyles[tone]]}>{children}</Text>;
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  const styles = useStyles();
  return (
    <Card>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{hint}</Text>
    </Card>
  );
}

export function Button({
  children,
  tone = "primary",
  onPress,
  disabled,
}: {
  children: React.ReactNode;
  tone?: "primary" | "secondary";
  onPress?: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={tone === "primary" ? styles.buttonPrimaryText : styles.buttonSecondaryText}>{children}</Text>
    </Pressable>
  );
}

export function InlineRow({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const { isTablet } = useDeviceLayout();
  return <View style={[styles.inlineRow, isTablet && styles.inlineRowTablet]}>{children}</View>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input(props, ref) {
  const styles = useStyles();
  const { style, ...rest } = props;
  return <TextInput ref={ref} placeholderTextColor={colors.muted} {...rest} style={[styles.input, props.multiline && styles.textArea, style]} />;
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
      <Picker selectedValue={selectedValue} onValueChange={(value) => onValueChange(String(value))} dropdownIconColor={colors.text} style={styles.select}>
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
    <View style={[styles.notice, type === "success" ? styles.noticeSuccess : styles.noticeError]}>
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.empty}>{children}</Text>;
}

export function ListRow({
  title,
  detail,
  value,
}: {
  title: string;
  detail?: string | null;
  value?: string | React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.listRow}>
      <View style={styles.listText}>
        <Text style={styles.listTitle}>{title}</Text>
        {detail ? <Text style={styles.muted}>{detail}</Text> : null}
      </View>
      {typeof value === "string" ? <Text style={styles.listValue}>{value}</Text> : value ?? null}
    </View>
  );
}
