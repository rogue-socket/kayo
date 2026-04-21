const fs = require('node:fs');
const path = require('node:path');

function createDefaultDocument() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    jobs: []
  };
}

function normalizeWorkflow(workflow) {
  const delivery = workflow && typeof workflow.delivery === 'object' && workflow.delivery !== null
    ? workflow.delivery
    : {};

  return {
    kind: typeof workflow?.kind === 'string' && workflow.kind.trim() ? workflow.kind.trim() : 'copilot-prompt',
    prompt: typeof workflow?.prompt === 'string' ? workflow.prompt.trim() : '',
    sessionId: typeof workflow?.sessionId === 'string' && workflow.sessionId.trim() ? workflow.sessionId.trim() : null,
    delivery: {
      channel: typeof delivery.channel === 'string' && delivery.channel.trim() ? delivery.channel.trim() : 'telegram',
      target: typeof delivery.target === 'string' ? delivery.target.trim() : ''
    }
  };
}

function normalizeJob(job, index) {
  const createdAt = typeof job.createdAt === 'string' && job.createdAt.trim()
    ? job.createdAt
    : new Date().toISOString();

  return {
    id: typeof job.id === 'string' && job.id.trim() ? job.id.trim() : `job-${String(index + 1).padStart(3, '0')}`,
    name: typeof job.name === 'string' && job.name.trim() ? job.name.trim() : `Job ${index + 1}`,
    schedule: typeof job.schedule === 'string' ? job.schedule.trim() : '',
    timezone: typeof job.timezone === 'string' ? job.timezone.trim() : '',
    enabled: job.enabled !== false,
    workflow: normalizeWorkflow(job.workflow || {}),
    sessionMode: typeof job.sessionMode === 'string' && job.sessionMode.trim() ? job.sessionMode.trim() : 'per-job',
    createdAt,
    updatedAt: typeof job.updatedAt === 'string' && job.updatedAt.trim() ? job.updatedAt : createdAt,
    runtimeUpdatedAt: typeof job.runtimeUpdatedAt === 'string' && job.runtimeUpdatedAt.trim() ? job.runtimeUpdatedAt : null,
    lastRunAt: typeof job.lastRunAt === 'string' && job.lastRunAt.trim() ? job.lastRunAt : null,
    nextRunAt: typeof job.nextRunAt === 'string' && job.nextRunAt.trim() ? job.nextRunAt : null,
    lastStatus: typeof job.lastStatus === 'string' && job.lastStatus.trim() ? job.lastStatus : null,
    lastError: typeof job.lastError === 'string' && job.lastError.trim() ? job.lastError : null
  };
}

function normalizeJobsDocument(document) {
  const jobs = Array.isArray(document?.jobs) ? document.jobs : [];

  return {
    version: 1,
    updatedAt: typeof document?.updatedAt === 'string' && document.updatedAt.trim()
      ? document.updatedAt
      : new Date().toISOString(),
    jobs: jobs.map((job, index) => normalizeJob(job, index))
  };
}

function ensureJobsFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(createDefaultDocument(), null, 2));
  }
}

function readJobsDocument(filePath) {
  ensureJobsFile(filePath);
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const parsed = rawContent ? JSON.parse(rawContent) : createDefaultDocument();
  return normalizeJobsDocument(parsed);
}

function writeJobsDocument(filePath, document) {
  const normalized = normalizeJobsDocument(document);
  normalized.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function updateJobRuntime(filePath, jobId, updater) {
  const document = readJobsDocument(filePath);
  const jobIndex = document.jobs.findIndex((job) => job.id === jobId);

  if (jobIndex === -1) {
    throw new Error(`Unknown scheduled job: ${jobId}`);
  }

  const currentJob = document.jobs[jobIndex];
  const jobPatch = updater({ ...currentJob }) || {};
  const mergedJob = normalizeJob(
    {
      ...currentJob,
      ...jobPatch,
      updatedAt: currentJob.updatedAt,
      runtimeUpdatedAt: new Date().toISOString()
    },
    jobIndex
  );

  document.jobs[jobIndex] = mergedJob;
  writeJobsDocument(filePath, document);
  return mergedJob;
}

module.exports = {
  createDefaultDocument,
  ensureJobsFile,
  normalizeJob,
  normalizeJobsDocument,
  readJobsDocument,
  updateJobRuntime,
  writeJobsDocument
};