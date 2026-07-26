import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/shift/holidays.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { getHolidays } = context.JapaneseHolidays;

test("2026年の代表的な祝日と振替休日を生成する", () => {
  const holidays = getHolidays(2026);
  assert.equal(holidays.get("2026-01-12"), "成人の日");
  assert.equal(holidays.get("2026-05-04"), "みどりの日");
  assert.equal(holidays.get("2026-05-06"), "振替休日");
  assert.equal(holidays.get("2026-09-22"), "国民の休日");
  assert.equal(holidays.get("2026-09-23"), "秋分の日");
});

test("2019年の即位に伴う国民の休日を生成する", () => {
  const holidays = getHolidays(2019);
  assert.equal(holidays.get("2019-04-30"), "国民の休日");
  assert.equal(holidays.get("2019-05-01"), "天皇の即位の日");
  assert.equal(holidays.get("2019-05-02"), "国民の休日");
});

test("2020年と2021年の五輪特例を反映する", () => {
  const holidays2020 = getHolidays(2020);
  const holidays2021 = getHolidays(2021);
  assert.equal(holidays2020.get("2020-07-23"), "海の日");
  assert.equal(holidays2020.get("2020-07-24"), "スポーツの日");
  assert.equal(holidays2021.get("2021-07-22"), "海の日");
  assert.equal(holidays2021.get("2021-08-09"), "振替休日");
});
