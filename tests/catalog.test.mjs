import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({});
vm.runInContext(fs.readFileSync("src/catalog.js", "utf8"), context);
const rows = context.readCatalog(fs.readFileSync("data/mp-rotator.csv", "utf8"));
test("complete table, unique operating points and metric units", () => {
  assert.equal(rows.length, 103);
  assert.equal(new Set(rows.map(r => [r.model,r.arc,r.bar].join("/"))).size, 103);
  assert.ok(rows.every(r => r.flow > 0 && r.radius > 0));
  assert.equal(rows.find(r => r.model==="MP-2000" && r.bar===2.8 && r.arc===180).flow, 2.92);
  assert.equal(rows.find(r => r.model==="MP-3000" && r.bar===2.8 && r.arc===360).radius, 9.1);
});
