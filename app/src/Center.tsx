// Centred full-screen container and the load-error screen.
import React from "react";
import { Pressable, Text, View } from "react-native";
import { space, Theme } from "./theme";
import { styles } from "./appStyles";

export function ErrScreen({ theme, err, onRetry }: { theme: Theme; err: string; onRetry: () => void }) {
  const s = styles(theme);
  return (
    <Center theme={theme}>
      <Text style={s.errTitle}>Can’t load digests</Text>
      <Text style={s.errBody}>{err}</Text>
      <Pressable style={s.retry} onPress={onRetry}><Text style={s.retryText}>Retry</Text></Pressable>
    </Center>
  );
}
export function Center({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.articleBg, padding: space.lg }}>
      {children}
    </View>
  );
}
