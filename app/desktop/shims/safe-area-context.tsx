// react-native-safe-area-context for the desktop build.
//
// The real package renders a native RNCSafeAreaProvider component that the
// Impeller engine does not implement. A desktop window has no notch, status
// bar or gesture area, so its safe-area insets are genuinely zero. This module
// keeps the package's API shape (the parts the app and common libraries use)
// and reports those zero insets.
import React, { createContext, useContext } from "react";
import { View, useWindowDimensions, type ViewProps } from "react-native";

export type EdgeInsets = { top: number; right: number; bottom: number; left: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Metrics = { insets: EdgeInsets; frame: Rect };

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const initialWindowMetrics: Metrics | null = null;
export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(ZERO);

export function SafeAreaProvider({ children, style, ...rest }: ViewProps & { initialMetrics?: Metrics | null }) {
  return (
    <SafeAreaInsetsContext.Provider value={ZERO}>
      <View style={[{ flex: 1 }, style]} {...rest}>
        {children}
      </View>
    </SafeAreaInsetsContext.Provider>
  );
}

export function SafeAreaView(props: ViewProps & { edges?: readonly string[] }) {
  const { edges: _edges, ...rest } = props;
  return <View {...rest} />;
}

export function useSafeAreaInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}

export function useSafeAreaFrame(): Rect {
  const { width, height } = useWindowDimensions();
  return { x: 0, y: 0, width, height };
}
