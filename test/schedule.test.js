import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  calculateMonth,
  calculateSchedule,
  findNextStatus,
  getHolidayList,
  getTodayInTokyo
} from "../worker/schedule.js";

const data = {
  patterns: {
    cycle: {
      type: "cycle",
      patternBlocks: [
        { mode: "night", status: "rest", days: 2 },
        { mode: "night", status: "work", days: 2 }
      ]
    }
  },
  periods: [
    { id: 1, from: "2026-01-01", pattern: "cycle", baseDate: "2026-01-01" }
  ],
  exceptions: {
    "2026-01-02": { status: "work", shift: 1, note: "非公開", memo: "非公開" }
  }
};

test("周期と例外から公開勤務状態だけを計算する", () => {
  const schedule = calculateSchedule("2026-01-02", data);
  assert.deepEqual(schedule, {
    date: "2026-01-02",
    weekday: "fri",
    mode: "night",
    modeLabel: "夜",
    status: "work",
    statusLabel: "仕事",
    holiday: null
  });
  assert.equal("note" in schedule, false);
  assert.equal("memo" in schedule, false);
});

test("月間勤務表と次の休みを計算する", () => {
  const month = calculateMonth(2026, 2, data);
  assert.equal(month.length, 28);
  assert.equal(month[0].date, "2026-02-01");

  const nextRest = findNextStatus("2026-01-02", "rest", data);
  assert.equal(nextRest.date, "2026-01-04");
  assert.equal(nextRest.daysUntil, 2);
});

test("取得範囲より前の周期補正を合計値から引き継ぐ", () => {
  const scopedData = {
    ...data,
    baseCycleShift: 1,
    exceptions: {}
  };
  assert.equal(calculateSchedule("2026-01-02", scopedData).status, "work");
});

test("祝日一覧と日本時間の日付を返す", () => {
  const holidays = getHolidayList(2026);
  assert.deepEqual(
    holidays.find(item => item.date === "2026-05-06"),
    { date: "2026-05-06", name: "振替休日" }
  );
  assert.equal(getTodayInTokyo(new Date("2026-07-26T15:30:00Z")), "2026-07-27");
});

test("Workerとブラウザの祝日計算結果が一致する", async () => {
  const source = await readFile(new URL("../public/shift/holidays.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);

  for (const year of [2019, 2020, 2021, 2026, 2027]) {
    const browserHolidays = [...context.JapaneseHolidays.getHolidays(year)]
      .map(([date, name]) => ({ date, name }))
      .sort((left, right) => left.date.localeCompare(right.date));
    assert.deepEqual(getHolidayList(year), browserHolidays);
  }
});
