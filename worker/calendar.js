const CALENDAR_NAME = "みら勤務表";
const PROD_ID = "-//mirachan.net//Mira Work Schedule//JA";

export function createScheduleCalendar(days, generatedAt = new Date()) {
  const stamp = formatTimestamp(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PROD_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D"
  ];

  for (const day of days) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:work-${day.date}@mirachan.net`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatDate(day.date)}`,
      `DTEND;VALUE=DATE:${formatDate(addDays(day.date, 1))}`,
      `SUMMARY:${escapeText(day.label)}`,
      ...descriptionLines(day),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function descriptionLines(day) {
  const details = [day.holiday, day.memo].filter(Boolean);
  return details.length > 0
    ? [`DESCRIPTION:${escapeText(details.join(" / "))}`]
    : [];
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts = [];
  let current = "";
  let currentLength = 0;

  for (const character of line) {
    const length = encoder.encode(character).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (currentLength + length > limit) {
      parts.push(current);
      current = character;
      currentLength = length;
    } else {
      current += character;
      currentLength += length;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function formatDate(dateKey) {
  return dateKey.replaceAll("-", "");
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
