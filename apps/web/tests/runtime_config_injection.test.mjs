import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function readPage(name) {
  return readFileSync(join(ROOT, "pages", name), "utf8");
}

test("runtime-config endpoint が存在する", () => {
  const hasFunction = existsSync(join(ROOT, "functions", "runtime-config.js.ts"));
  assert.equal(hasFunction, true);
});

test("主要ページは runtime-config を先に読み込む", () => {
  const pages = ["index.html", "dashboard.html", "app.html", "purchase.html"];
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /<script\s+src="\/runtime-config\.js"><\/script>/i, page);
  }
});