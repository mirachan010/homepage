import assert from "node:assert/strict";
import test from "node:test";

import { parseOfficialHolidayCsv } from "../worker/holidays.js";

test("内閣府CSVのShift_JIS日付と祝日名を読み取る", () => {
  const prefix = Buffer.from("date,name\r\n2026/1/1,", "ascii");
  const newYear = Buffer.from([0x8C, 0xB3, 0x93, 0xFA]); // 元日 (CP932)
  const suffix = Buffer.from("\r\n2026/1/12,Coming of Age Day\r\n", "ascii");
  const csv = Buffer.concat([prefix, newYear, suffix]);

  assert.deepEqual(parseOfficialHolidayCsv(csv.buffer.slice(
    csv.byteOffset,
    csv.byteOffset + csv.byteLength
  )), [
    { date: "2026-01-01", name: "元日" },
    { date: "2026-01-12", name: "Coming of Age Day" }
  ]);
});

test("祝日CSVの日付重複を拒否する", () => {
  const csv = Buffer.from(
    "date,name\r\n2026/1/1,New Year\r\n2026/1/1,Duplicate\r\n",
    "ascii"
  );

  assert.throws(
    () => parseOfficialHolidayCsv(csv.buffer.slice(
      csv.byteOffset,
      csv.byteOffset + csv.byteLength
    )),
    /重複/
  );
});
