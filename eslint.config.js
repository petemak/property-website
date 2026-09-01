// Flat ESLint config (ESLint v9+). Minimal by design: the frontend is
// framework-free vanilla ES modules, so this lints for real problems
// (parse errors, undefined names, duplicate keys) without imposing a style
// regime on the existing hand-written code.

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  location: "readonly",
  history: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  FormData: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Node: "readonly",
  HTMLElement: "readonly",
  PopStateEvent: "readonly",
  IntersectionObserver: "readonly",
  requestAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
  Intl: "readonly",
  structuredClone: "readonly",
  getComputedStyle: "readonly",
  alert: "readonly",
  confirm: "readonly",
  sessionStorage: "readonly",
  localStorage: "readonly",
  process: "readonly",
  Buffer: "readonly",
  globalThis: "readonly",
};

export default [
  {
    ignores: ["**/node_modules/**", "**/.cpcache/**", "**/.netlify/**", "tutorial/**"],
  },
  {
    files: ["src/frontend/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: {
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
];
