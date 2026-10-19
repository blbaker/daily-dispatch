// processColor for the desktop build: keep "transparent" distinct from "unset".
//
// React Native's C++ renderer stores colours as 32-bit ARGB and, on the
// generic (cxx) platform the Impeller engine compiles, uses 0 as the
// "no colour set" sentinel (HostPlatformColor::UndefinedColor). processColor
// turns "transparent" into exactly 0, so the engine cannot tell a transparent
// border from a border with no colour, and paints it in the default border
// colour: black. The app's slanted hero wedge (a border triangle with a
// transparent side) showed up as a black triangle because of this.
//
// Fully transparent is fully transparent whatever the RGB channels hold, so
// map 0 to alpha 0 with a non-zero blue channel. Every other value passes
// through untouched. Remove this once the engine uses a sentinel that is not
// a real colour.
//
// The .d.ts beside processColor.js declares a named export, but the JS file
// only has a default export, so read the default through the namespace.
import * as processColorModule from "react-native/Libraries/StyleSheet/processColor";

type ProcessColor = typeof processColorModule.processColor;
const baseProcessColor = (processColorModule as unknown as { default: ProcessColor }).default;

export const TRANSPARENT_NOT_UNSET = 0x00000001;

export default function processColor(color?: Parameters<ProcessColor>[0]): ReturnType<ProcessColor> {
  const value = baseProcessColor(color);
  return value === 0 ? TRANSPARENT_NOT_UNSET : value;
}
