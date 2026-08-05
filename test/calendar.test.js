import assert from "node:assert/strict";
import test from "node:test";

import { createScheduleCalendar } from "../worker/calendar.js";

test("勤務日を重複しない終日予定のICSにする", () => {
  const calendar = createScheduleCalendar([
    {
      date: "2026-08-05",
      label: "夜勤",
      holiday: null,
      memo: "引き継ぎ,あり"
    },
    {
      date: "2026-08-06",
      label: "休み",
      holiday: "休日;特例"
    }
  ], new Date("2026-08-05T10:20:30Z"));

  assert.match(calendar, /BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(calendar, /UID:work-2026-08-05@mirachan\.net\r\n/);
  assert.match(calendar, /DTSTAMP:20260805T102030Z\r\n/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20260805\r\n/);
  assert.match(calendar, /DTEND;VALUE=DATE:20260806\r\n/);
  assert.match(calendar, /SUMMARY:夜勤\r\n/);
  assert.match(calendar, /DESCRIPTION:引き継ぎ\\,あり\r\n/);
  assert.match(calendar, /DESCRIPTION:休日\\;特例\r\n/);
  assert.ok(calendar.endsWith("END:VCALENDAR\r\n"));
});

test("長い日本語の行はUTF-8の75オクテット以内で折り返す", () => {
  const calendar = createScheduleCalendar([
    {
      date: "2026-08-05",
      label: "夜勤",
      memo: "とても長い公開メモです。勤務カレンダーで正しく折り返されることを確認します。"
    }
  ], new Date("2026-08-05T00:00:00Z"));

  for (const line of calendar.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).length <= 75, line);
  }
  assert.match(calendar, /DESCRIPTION:.*\r\n /);
});
