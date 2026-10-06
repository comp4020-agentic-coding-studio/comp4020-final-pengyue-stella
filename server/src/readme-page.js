import { readFileSync } from "node:fs";
import { renderMarkdown } from "./markdown.js";

// Reads README.md fresh each request — traffic here is low (a visitor reads
// it once, before using the app) and it means an edit to README.md shows up
// without a restart.
export function renderReadmePage() {
  const md = readFileSync(resolveReadmePath(), "utf8");
  const body = renderMarkdown(md);
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Traces of ANU — About</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="readme-page">
    <main class="readme">
      <p class="readme-back"><a href="/">&larr; Back to the map</a></p>
      ${body}
    </main>
  </body>
</html>
`;
}

function resolveReadmePath() {
  return new URL("../../README.md", import.meta.url);
}
