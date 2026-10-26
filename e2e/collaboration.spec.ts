import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("two browser views preserve text, caret and local undo across structural changes", async ({
  page,
  context,
}) => {
  const path = `/test-editor?session=${randomUUID()}`;
  const second = await context.newPage();
  await Promise.all([page.goto(path), second.goto(path)]);
  const firstText = page.getByRole("textbox", { name: "Texto de prova" });
  const secondText = second.getByRole("textbox", { name: "Texto de prova" });
  await expect(firstText).toHaveText("Beta");
  await expect(secondText).toHaveText("Beta");
  for (const peer of [page, second]) await peer.getByRole("button", { name: "Pausar troca" }).click();
  await firstText.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("-local");
  await page.getByRole("button", { name: "Mover ao fim" }).click();
  await secondText.click();
  await second.keyboard.press("End");
  await second.keyboard.insertText("-remote");
  // Resume receiver first, then sender. Explicit full-state exchange simulates missed events.
  await second.getByRole("button", { name: "Retomar troca" }).click();
  await page.getByRole("button", { name: "Retomar troca" }).click();
  await second.getByRole("button", { name: "Retomar troca" }).click();
  for (const peer of [page, second]) {
    await expect(peer.getByLabel("Ordem visível")).toHaveText("first,last,subject");
    await expect(peer.getByRole("textbox")).toContainText("-local");
    await expect(peer.getByRole("textbox")).toContainText("-remote");
  }
  await expect(firstText).toHaveText((await secondText.textContent()) ?? "");
  await page.getByRole("button", { name: "Desfazer local" }).click();
  await expect(page.getByLabel("Ordem visível")).toHaveText("first,subject,last");
  await page.getByRole("button", { name: "Desfazer local" }).click();
  await expect(firstText).toHaveText("Beta-remote");
  await expect(secondText).toHaveText("Beta-remote");
  // Native browser selection remains attached to the stable content after a remote move.
  await secondText.click();
  await second.keyboard.press("End");
  await page.getByRole("button", { name: "Mover ao fim" }).click();
  await expect(second.getByLabel("Ordem visível")).toHaveText("first,last,subject");
  expect(
    await second.evaluate(() => {
      const selection = window.getSelection();
      return {
        text: selection?.anchorNode?.textContent,
        offset: selection?.anchorOffset,
        collapsed: selection?.isCollapsed,
      };
    }),
  ).toEqual({ text: "Beta-remote", offset: 11, collapsed: true });
  await second.keyboard.insertText("-caret");
  await expect(firstText).toHaveText("Beta-remote-caret");
  for (const peer of [page, second]) await peer.getByRole("button", { name: "Pausar troca" }).click();
  await page.getByRole("button", { name: "Ocultar bloco" }).click();
  await secondText.click();
  await second.keyboard.press("End");
  await second.keyboard.insertText("-hidden");
  await second.getByRole("button", { name: "Retomar troca" }).click();
  await page.getByRole("button", { name: "Retomar troca" }).click();
  await second.getByRole("button", { name: "Retomar troca" }).click();
  await expect(page.getByLabel("Ordem visível")).toHaveText("first,last");
  await page.getByRole("button", { name: "Restaurar bloco" }).click();
  await expect(firstText).toHaveText("Beta-remote-caret-hidden");
  await expect(secondText).toHaveText("Beta-remote-caret-hidden");
});
