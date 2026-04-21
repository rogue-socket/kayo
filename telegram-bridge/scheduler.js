const { loadConfig } = require('./lib/env');
const { ensureJobsFile, readJobsDocument, updateJobRuntime } = require('./lib/scheduler/job-store');
const { computeNextRun, normalizeTimezone } = require('./lib/scheduler/schedule-parser');
const { sendText } = require('./lib/transport/telegram-api');
const { runWorkflow } = require('./lib/scheduler/workflow-runner');

const config = loadConfig();
const runningJobs = new Set();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getReferenceDate(job) {
  const lastRunAt = parseTimestamp(job.lastRunAt);
  const definitionUpdatedAt = parseTimestamp(job.updatedAt) || parseTimestamp(job.createdAt) || new Date();

  if (lastRunAt && lastRunAt.getTime() >= definitionUpdatedAt.getTime()) {
    return lastRunAt;
  }

  return definitionUpdatedAt;
}

function planNextRun(job) {
  const effectiveTimezone = normalizeTimezone(job.timezone, config.defaultTimezone);
  const nextRun = computeNextRun(job.schedule, effectiveTimezone, getReferenceDate(job));

  return {
    effectiveTimezone,
    nextRun
  };
}

async function notifyJobFailure(job, error) {
  const delivery = job.workflow && job.workflow.delivery ? job.workflow.delivery : {};
  if (delivery.channel !== 'telegram' || !delivery.target || !config.telegramToken) {
    return;
  }

  try {
    await sendText(config.telegramToken, delivery.target, `Scheduled job \"${job.name}\" failed: ${error.message}`);
  } catch (notificationError) {
    console.error(`Failed to send job failure notification for ${job.id}: ${notificationError.message}`);
  }
}

async function runJob(job) {
  if (runningJobs.has(job.id)) {
    return;
  }

  runningJobs.add(job.id);
  await updateJobRuntime(config.jobsPath, job.id, () => ({
    lastStatus: 'running',
    lastError: null
  }));

  try {
    await runWorkflow(config, job);
    const completedAt = new Date();
    const nextRunAt = computeNextRun(job.schedule, normalizeTimezone(job.timezone, config.defaultTimezone), completedAt).toISOString();

    await updateJobRuntime(config.jobsPath, job.id, () => ({
      lastRunAt: completedAt.toISOString(),
      nextRunAt,
      lastStatus: 'ok',
      lastError: null
    }));
  } catch (error) {
    const completedAt = new Date();
    let nextRunAt = null;

    try {
      nextRunAt = computeNextRun(job.schedule, normalizeTimezone(job.timezone, config.defaultTimezone), completedAt).toISOString();
    } catch {
      nextRunAt = null;
    }

    await updateJobRuntime(config.jobsPath, job.id, () => ({
      lastRunAt: completedAt.toISOString(),
      nextRunAt,
      lastStatus: 'error',
      lastError: error.message
    }));

    await notifyJobFailure(job, error);
    console.error(`Scheduled job ${job.id} failed: ${error.message}`);
  } finally {
    runningJobs.delete(job.id);
  }
}

async function reconcileJobs() {
  const document = readJobsDocument(config.jobsPath);
  const now = new Date();

  for (const job of document.jobs) {
    if (!job.enabled || runningJobs.has(job.id)) {
      continue;
    }

    try {
      const plan = planNextRun(job);
      const plannedNextRunAt = plan.nextRun.toISOString();

      if (job.nextRunAt !== plannedNextRunAt || job.lastStatus === 'invalid') {
        await updateJobRuntime(config.jobsPath, job.id, () => ({
          nextRunAt: plannedNextRunAt,
          lastStatus: job.lastStatus === 'invalid' ? null : job.lastStatus,
          lastError: job.lastStatus === 'invalid' ? null : job.lastError
        }));
      }

      if (plan.nextRun.getTime() <= now.getTime()) {
        void runJob(job);
      }
    } catch (error) {
      if (job.lastStatus !== 'invalid' || job.lastError !== error.message || job.nextRunAt !== null) {
        await updateJobRuntime(config.jobsPath, job.id, () => ({
          nextRunAt: null,
          lastStatus: 'invalid',
          lastError: error.message
        }));
      }

      console.error(`Scheduled job ${job.id} is invalid: ${error.message}`);
    }
  }
}

async function main() {
  ensureJobsFile(config.jobsPath);
  console.log(`Scheduler started. Poll interval: ${config.schedulerPollIntervalMs}ms`);
  console.log(`Jobs store: ${config.jobsPath}`);

  while (true) {
    try {
      await reconcileJobs();
    } catch (error) {
      console.error(`Scheduler tick failed: ${error.message}`);
    }

    await delay(config.schedulerPollIntervalMs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});