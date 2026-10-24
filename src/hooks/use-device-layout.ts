import { useWindowDimensions } from "react-native";

export function classifyWindowWidth(width: number) {
  return width >= 1000 ? "expanded" : width >= 600 ? "medium" : "compact";
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
  };
}
