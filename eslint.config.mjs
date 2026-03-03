import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: ["main.js", "node_modules/**", "*.mjs"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			globals: globals.browser,
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			"obsidianmd/sample-names": "off",
		},
	},
]);
