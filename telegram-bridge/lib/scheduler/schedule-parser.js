const cronParser = require('cron-parser');
const { DateTime } = require('luxon');

function normalizeTimezone(timezone, fallbackTimezone) {
  const candidate = (timezone || fallbackTimezone || 'UTC').trim();
  const probe = DateTime.now().setZone(candidate);

  if (!probe.isValid) {
    throw new Error(`Invalid timezone: ${candidate}`);
  }

  return candidate;
}

function parseExpression(expression, options) {
  if (typeof cronParser.parseExpression === 'function') {
    return cronParser.parseExpression(expression, options);
  }

  if (cronParser.CronExpressionParser && typeof cronParser.CronExpressionParser.parse === 'function') {
    return cronParser.CronExpressionParser.parse(expression, options);
  }

  throw new Error('Unsupported cron-parser version.');
}

function cronValueToDate(value) {
  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }

  return new Date(value);
}

function computeNextRun(expression, timezone, fromDate) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Missing cron expression.');
  }

  const effectiveTimezone = normalizeTimezone(timezone, 'UTC');
  const iterator = parseExpression(expression.trim(), {
    currentDate: fromDate instanceof Date ? fromDate : new Date(fromDate),
    tz: effectiveTimezone
  });

  return cronValueToDate(iterator.next());
}

module.exports = {
  computeNextRun,
  normalizeTimezone
};