(function (root, factory) {
  const api = factory();
  root.JapaneseHolidays = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function dateKey(year, month, day) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function add(map, year, month, day, name) {
    map.set(dateKey(year, month, day), name);
  }

  function nthMonday(year, month, nth) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    return 1 + ((8 - firstDay) % 7) + (nth - 1) * 7;
  }

  function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function addNationalHolidays(map, year) {
    add(map, year, 1, 1, "元日");

    if (year >= 2000) add(map, year, 1, nthMonday(year, 1, 2), "成人の日");
    else if (year >= 1949) add(map, year, 1, 15, "成人の日");

    if (year >= 2020) add(map, year, 2, 23, "天皇誕生日");
    else if (year >= 1989 && year <= 2018) add(map, year, 12, 23, "天皇誕生日");

    if (year >= 1967) add(map, year, 2, 11, "建国記念の日");
    add(map, year, 3, vernalEquinoxDay(year), "春分の日");

    if (year >= 2007) add(map, year, 4, 29, "昭和の日");
    else if (year >= 1989) add(map, year, 4, 29, "みどりの日");
    else add(map, year, 4, 29, "天皇誕生日");

    add(map, year, 5, 3, "憲法記念日");
    if (year >= 2007) add(map, year, 5, 4, "みどりの日");
    add(map, year, 5, 5, "こどもの日");

    if (year >= 1996) {
      const marineDay = year >= 2003 ? nthMonday(year, 7, 3) : 20;
      add(map, year, 7, marineDay, "海の日");
    }

    if (year >= 2016) add(map, year, 8, 11, "山の日");

    if (year >= 2003) add(map, year, 9, nthMonday(year, 9, 3), "敬老の日");
    else if (year >= 1966) add(map, year, 9, 15, "敬老の日");
    add(map, year, 9, autumnalEquinoxDay(year), "秋分の日");

    if (year >= 2000) add(map, year, 10, nthMonday(year, 10, 2), "スポーツの日");
    else if (year >= 1966) add(map, year, 10, 10, "体育の日");

    add(map, year, 11, 3, "文化の日");
    add(map, year, 11, 23, "勤労感謝の日");

    if (year === 1959) add(map, 1959, 4, 10, "皇太子明仁親王の結婚の儀");
    if (year === 1989) add(map, 1989, 2, 24, "昭和天皇の大喪の礼");
    if (year === 1990) add(map, 1990, 11, 12, "即位礼正殿の儀");
    if (year === 1993) add(map, 1993, 6, 9, "皇太子徳仁親王の結婚の儀");
    if (year === 2019) {
      add(map, 2019, 5, 1, "天皇の即位の日");
      add(map, 2019, 10, 22, "即位礼正殿の儀");
    }

    applyOlympicOverrides(map, year);
  }

  function applyOlympicOverrides(map, year) {
    if (year === 2020) {
      map.delete("2020-07-20");
      map.delete("2020-08-11");
      map.delete("2020-10-12");
      add(map, 2020, 7, 23, "海の日");
      add(map, 2020, 7, 24, "スポーツの日");
      add(map, 2020, 8, 10, "山の日");
    }
    if (year === 2021) {
      map.delete("2021-07-19");
      map.delete("2021-08-11");
      map.delete("2021-10-11");
      add(map, 2021, 7, 22, "海の日");
      add(map, 2021, 7, 23, "スポーツの日");
      add(map, 2021, 8, 8, "山の日");
    }
  }

  function addCitizensHolidays(map, year) {
    if (year < 1986) return;

    const date = new Date(year, 0, 2);
    const end = new Date(year, 11, 30);
    while (date <= end) {
      const previousDate = new Date(date);
      const nextDate = new Date(date);
      previousDate.setDate(date.getDate() - 1);
      nextDate.setDate(date.getDate() + 1);
      const key = dateKey(year, date.getMonth() + 1, date.getDate());
      const previous = dateKey(previousDate.getFullYear(), previousDate.getMonth() + 1, previousDate.getDate());
      const next = dateKey(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
      if (!map.has(key) && map.has(previous) && map.has(next)) map.set(key, "国民の休日");
      date.setDate(date.getDate() + 1);
    }
  }

  function addSubstituteHolidays(map, year) {
    if (year < 1973) return;
    const originalKeys = [...map.keys()].sort();

    for (const key of originalKeys) {
      const date = new Date(`${key}T00:00:00`);
      if (date.getDay() !== 0) continue;

      do {
        date.setDate(date.getDate() + 1);
      } while (year >= 2007 && map.has(dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate())));

      const substituteKey = dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
      if (!map.has(substituteKey)) map.set(substituteKey, "振替休日");
    }
  }

  function getHolidays(year) {
    const map = new Map();
    addNationalHolidays(map, year);
    addCitizensHolidays(map, year);
    addSubstituteHolidays(map, year);
    return map;
  }

  function getHolidayMapForYears(years) {
    const result = {};
    for (const year of years) {
      for (const [key, name] of getHolidays(year)) result[key] = name;
    }
    return result;
  }

  return { getHolidays, getHolidayMapForYears };
});
