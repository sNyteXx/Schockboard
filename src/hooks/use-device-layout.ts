import { useWindowDimensions } from "react-native";

import { typeScaleFor } from "@/theme/typography";

export function classifyWindowWidth(width: number) {
  return width >= 1000 ? "expanded" : width >= 600 ? "medium" : "compact";
}

/** Horizontal page padding per size class (4/8 grid). */
export function pagePaddingFor(width: number) {
  return width >= 1400 ? 32 : width >= 1000 ? 28 : width >= 600 ? 24 : 16;
}

export function useDeviceLayout() {
  const { width, height, fontScale } = useWindowDimensions();

  // Use available logical window width, not physical screen pixels. This also
  // adapts to Android split-screen and tablets held in portrait orientation.
  const sizeClass = classifyWindowWidth(width);

  return {
    width,
    height,
    fontScale,
    sizeClass,
    isTablet: sizeClass !== "compact",
    isWide: sizeClass === "expanded",
    isLandscape: width > height,
    /** Type multiplier (1 – 1.25), see typeScaleFor(). */
    typeScale: typeScaleFor(width),
    pagePadding: pagePaddingFor(width),
  };
}
