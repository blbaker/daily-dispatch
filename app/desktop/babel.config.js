// Babel config for the desktop build: the stock React Native preset plus the
// EXPO_PUBLIC_* inlining that babel-preset-expo does for the phone and web
// builds (see babel-inline-env.js).
const { inlineExpoPublicEnv } = require("./babel-inline-env");

module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [inlineExpoPublicEnv],
};
