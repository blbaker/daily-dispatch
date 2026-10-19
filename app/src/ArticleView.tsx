import React, { useEffect, useRef } from "react";
import { Dimensions, Pressable, ScrollView, Text, View } from "react-native";
import ArticleBody from "./ArticleBody";
import { space, Theme } from "./theme";
import type { Edition } from "./api";
import { styles } from "./appStyles";

/* ---------------- ARTICLE (hero + inline images, summary/divider/full, swipe) -- */
export default function ArticleView({
  theme, ed, index, topInset, onIndex, onBack,
}: {
  theme: Theme; ed: Edition; index: number; topInset: number;
  onIndex: (i: number) => void; onBack: () => void;
}) {
  const s = styles(theme);
  const W = Dimensions.get("window").width;
  const ref = useRef<ScrollView>(null);
  useEffect(() => { ref.current?.scrollTo({ x: index * W, animated: false }); }, [W]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.articleBg }}>
      <View style={[s.topbar, { paddingTop: topInset + space.sm }]}>
        <Pressable onPress={onBack} hitSlop={16}>
          <Text style={[s.chevronBig, { color: theme.textLight }]}>‹</Text>
        </Pressable>
        <Text style={s.topbarTitle}>{index + 1} of {ed.stories.length}</Text>
        <View style={{ width: 34 }} />
      </View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / W);
          if (i !== index) onIndex(i);
        }}
      >
        {ed.stories.map((st, i) => (
          <ScrollView key={i} style={{ width: W }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
            <ArticleBody theme={theme} st={st} />
          </ScrollView>
        ))}
      </ScrollView>
    </View>
  );
}
