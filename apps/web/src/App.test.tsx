import { expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App.js";

it("renders the placeholder", () => {
  expect(renderToString(<App />)).toContain("Paper Duel");
});
