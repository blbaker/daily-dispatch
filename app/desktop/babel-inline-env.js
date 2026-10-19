// Babel plugin for the desktop build: inline EXPO_PUBLIC_* environment values.
//
// The shared app source reads process.env.EXPO_PUBLIC_* (API URL, key, e-ink
// flag). On the phone and web builds babel-preset-expo inlines those at build
// time. The desktop build uses the plain React Native preset, so this plugin
// does the same job: each process.env.EXPO_PUBLIC_X member expression becomes
// the string value from the bundling process's environment, or undefined when
// unset. Nothing else in process.env is touched.
const PREFIX = "EXPO_PUBLIC_";

function expoPublicEnv() {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(PREFIX) && value !== undefined) out[key] = value;
  }
  return out;
}

function inlineExpoPublicEnv({ types: t }) {
  const isProcessEnv = (node) =>
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object, { name: "process" }) &&
    t.isIdentifier(node.property, { name: "env" });
  return {
    name: "inline-expo-public-env",
    visitor: {
      MemberExpression(p) {
        const { node } = p;
        if (node.computed || !isProcessEnv(node.object) || !t.isIdentifier(node.property)) return;
        const key = node.property.name;
        if (!key.startsWith(PREFIX)) return;
        // Never rewrite an assignment target (process.env.X = ...).
        if (p.parentPath.isAssignmentExpression({ left: node })) return;
        const value = process.env[key];
        p.replaceWith(value === undefined ? t.identifier("undefined") : t.stringLiteral(value));
      },
    },
  };
}

module.exports = { inlineExpoPublicEnv, expoPublicEnv };
