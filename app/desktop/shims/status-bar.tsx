// expo-status-bar for the desktop build.
//
// A desktop window has no system status bar to restyle, so StatusBar renders
// nothing and the imperative setters do nothing. The props stay typed so a
// misspelled style still fails the desktop typecheck.
export type StatusBarStyle = "auto" | "inverted" | "light" | "dark";

export type StatusBarProps = {
  style?: StatusBarStyle;
  hidden?: boolean;
  animated?: boolean;
  translucent?: boolean;
  backgroundColor?: string;
};

export function StatusBar(_props: StatusBarProps): null {
  return null;
}

export function setStatusBarStyle(_style: StatusBarStyle): void {}
export function setStatusBarHidden(_hidden: boolean): void {}
export function setStatusBarBackgroundColor(_color: string): void {}
export function setStatusBarTranslucent(_translucent: boolean): void {}
