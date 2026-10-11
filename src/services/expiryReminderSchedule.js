const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const REMINDER_OFFSETS_DAYS = Object.freeze([7, 1]);

function assertCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new TypeError('A valid UTC calendar date in YYYY-MM-DD format is required.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError('A valid UTC calendar date in YYYY-MM-DD format is required.');
  }

  return parsed;
}

function toUtcCalendarDate(date) {
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Date is outside the supported UTC calendar range.');
  }
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) {
    throw new TypeError('Expiry must normalize to a UTC date between years 0000 and 9999.');
  }

  return [
    String(year).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function normalizeExpiryUtcDate(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Expiry must be a date-only value or an ISO date-time.');
  }

  if (DATE_PATTERN.test(value)) {
    assertCalendarDate(value);
    return value;
  }

  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) {
    throw new TypeError('Expiry must be a date-only value or an ISO date-time with a timezone.');
  }

  const [, datePart, hour, minute, second, , zone, , offsetHour, offsetMinute] = match;
  assertCalendarDate(datePart);
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new TypeError('Expiry date-time must contain a valid hour, minute, and second.');
  }
  if (zone !== 'Z' && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    throw new TypeError('Expiry date-time must contain a valid timezone offset.');
  }

  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new TypeError('Expiry must be a valid ISO date-time.');
  }

  return toUtcCalendarDate(instant);
}

function getUtcDateDaysBefore(date, days) {
  const parsed = assertCalendarDate(date);
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new TypeError('The number of calendar days must be a non-negative safe integer.');
  }

  parsed.setUTCDate(parsed.getUTCDate() - days);
  return toUtcCalendarDate(parsed);
}

function getExpiryReminderSchedule(expiresAt) {
  const expiryDate = normalizeExpiryUtcDate(expiresAt);
  return {
    expiryDate,
    reminders: REMINDER_OFFSETS_DAYS.map((leadDays) => ({
      leadDays,
      scheduledDate: getUtcDateDaysBefore(expiryDate, leadDays)
    }))
  };
}

module.exports = {
  getExpiryReminderSchedule,
  getUtcDateDaysBefore,
  normalizeExpiryUtcDate
};
