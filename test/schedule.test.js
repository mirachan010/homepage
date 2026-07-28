import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  calculateMonth,
  calculateRange,
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
    "2026-01-02": { status: "work", shift: 1, note: "変更理由", memo: "公開メモ" }
  }
};

test("周期と例外から共有する1日分の勤務情報を計算する", () => {
  const schedule = calculateSchedule("2026-01-02", data);
  assert.deepEqual(schedule, {
    date: "2026-01-02",
    weekday: "fri",
    mode: "night",
    modeLabel: "夜",
    status: "work",
    statusLabel: "仕事",
    type: "regular_work",
    cycleGroup: "work",
    label: "夜勤",
    holiday: null,
    note: "変更理由",
    memo: "公開メモ"
  });
});

test("月間勤務表と次の休みを計算する", () => {
  const month = calculateMonth(2026, 2, data);
  assert.equal(month.length, 28);
  assert.equal(month[0].date, "2026-02-01");

  const nextRest = findNextStatus("2026-01-02", "rest", data);
  assert.equal(nextRest.date, "2026-01-04");
  assert.equal(nextRest.daysUntil, 2);
});

test("有給と休出は表示と周期グループを分ける", () => {
  const specialData = {
    ...data,
    exceptions: {
      "2026-01-02": { type: "paid_leave" },
      "2026-01-03": { type: "holiday_work" }
    }
  };

  const paidLeave = calculateSchedule("2026-01-02", specialData);
  assert.equal(paidLeave.status, "rest");
  assert.equal(paidLeave.type, "paid_leave");
  assert.equal(paidLeave.cycleGroup, "work");
  assert.equal(paidLeave.label, "有給");

  const holidayWork = calculateSchedule("2026-01-03", specialData);
  assert.equal(holidayWork.status, "work");
  assert.equal(holidayWork.type, "holiday_work");
  assert.equal(holidayWork.cycleGroup, "rest");
  assert.equal(holidayWork.label, "休出");
});

test("指定開始日から必要日数をまとめて計算する", () => {
  const schedule = calculateRange("2026-01-02", 3, data);
  assert.deepEqual(schedule.map(day => day.date), [
    "2026-01-02",
    "2026-01-03",
    "2026-01-04"
  ]);
});

test("取得範囲より前の周期補正を合計値から引き継ぐ", () => {
  const scopedData = {
    ...data,
    baseCycleShift: 1,
    exceptions: {}
  };
  assert.equal(calculateSchedule("2026-01-02", scopedData).status, "work");
});

test("D1の公式祝日が暫定計算より優先される", () => {
  const weekdayData = {
    patterns: {
      weekday: {
        type: "weekday",
        mode: "day",
        workdays: [1, 2, 3, 4, 5]
      }
    },
    periods: [
      { id: 1, from: "2026-01-01", pattern: "weekday" }
    ],
    exceptions: {},
    holidays: {
      "2026-07-27": "制度変更で追加された祝日"
    }
  };

  const schedule = calculateSchedule("2026-07-27", weekdayData);
  assert.equal(schedule.status, "rest");
  assert.equal(schedule.holiday, "制度変更で追加された祝日");
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
