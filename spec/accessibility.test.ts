import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

async function documentAt(path: string): Promise<Document> {
  const response = await fetch(new URL(path, baseUrl));
  expect(response.status).toBe(200);
  return new JSDOM(await response.text()).window.document;
}

function hasLabel(control: Element, document: Document): boolean {
  if (control.closest("label")) return true;
  if (control.getAttribute("aria-label")?.trim()) return true;
  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy && labelledBy.split(/\s+/).every((id) => document.getElementById(id))) return true;
  const id = control.id;
  return Boolean(id && document.querySelector(`label[for="${id}"]`));
}

describe("semantic accessibility floor", () => {
  it("gives the museum document a language, title, main landmark, heading, and viewport", async () => {
    const document = await documentAt("/");

    expect(document.documentElement.lang).toBe("en-AU");
    expect(document.title.trim()).toBe("The Cursed Museum");
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain("width=device-width");
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("main")?.getAttribute("role")).not.toBe("application");
    expect(document.querySelector("h1")?.textContent?.trim()).toBe("The Cursed Museum");
  });

  it("keeps image alternatives and form labels explicit in the server HTML", async () => {
    const document = await documentAt("/");

    for (const image of document.querySelectorAll("img")) {
      expect(image.hasAttribute("alt"), image.getAttribute("src") ?? "image without src").toBe(true);
    }

    for (const control of document.querySelectorAll("input, select, textarea")) {
      if ((control as HTMLInputElement).type === "hidden") continue;
      expect(hasLabel(control, document), `${control.tagName.toLowerCase()}#${control.id} needs a label`).toBe(true);
    }
  });

  it("gives every declared dialog an accessible naming reference", async () => {
    const document = await documentAt("/");

    for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const directName = dialog.getAttribute("aria-label")?.trim();
      const labelledBy = dialog.getAttribute("aria-labelledby")?.trim();
      const referencesExistingLabel = Boolean(
        labelledBy && labelledBy.split(/\s+/).every((id) => document.getElementById(id)),
      );
      expect(Boolean(directName) || referencesExistingLabel, `${dialog.id || dialog.className} needs an accessible name`).toBe(true);
    }
  });

  it("publishes the marker guide with the same document-level floor", async () => {
    const document = await documentAt("/readme/");

    expect(document.documentElement.lang).toBe("en-AU");
    expect(document.title.trim().length).toBeGreaterThan(0);
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toContain("The Cursed Museum");
  });
});
