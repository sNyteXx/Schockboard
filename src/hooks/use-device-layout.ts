import { useWindowDimensions } from "react-native";

export function useDeviceLayout() {
  const { width } = useWindowDimensions();

  return {
    width,
    isTablet: width >= 900,
    isWide: width >= 1200,
  };
}
