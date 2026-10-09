import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // New in eslint-plugin-react-hooks 6+: flags existing, working patterns. Kept visible as warnings.
  { rules: { "react-hooks/set-state-in-effect": "warn" } },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/sw.js"] },
];

export default config;
