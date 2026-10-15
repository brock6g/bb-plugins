declare module "monaco-editor/languages/features/json/tokenization.js" {
  import type { languages } from "monaco-editor";
  export function createTokenizationSupport(supportComments: boolean): languages.TokensProvider;
}
