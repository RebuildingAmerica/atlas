/** @type {import("prettier").Config} */
export default {
  plugins: ["prettier-plugin-tailwindcss"],
  overrides: [
    { files: "app/**/*.{ts,tsx,css}", options: { printWidth: 100 } },
    { files: "*.md", options: { proseWrap: "always", printWidth: 80 } },
  ],
};
