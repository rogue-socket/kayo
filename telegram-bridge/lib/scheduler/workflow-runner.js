const { promptGateway } = require('../transport/gateway-client');
const { sendText } = require('../transport/telegram-api');

function resolveWorkflowDelivery(job) {
  const workflow = job.workflow || {};
  const delivery = workflow.delivery || {};

  return {
    workflow,
    delivery
  };
}

function resolveScheduledSessionId(job, workflow, delivery) {
  if (typeof workflow.sessionId === 'string' && workflow.sessionId.trim()) {
    return workflow.sessionId.trim();
  }

  if (job.sessionMode === 'shared-target' && delivery.channel === 'telegram' && delivery.target) {
    return `schedule:telegram:${delivery.target}`;
  }

  return `schedule:${job.id}`;
}

async function deliverResult(config, delivery, content) {
  if (!delivery.channel || delivery.channel === 'none') {
    return;
  }

  if (delivery.channel === 'telegram') {
    if (!config.telegramToken) {
      throw new Error('Missing TELEGRAM_BOT_TOKEN for Telegram delivery.');
    }

    if (!delivery.target) {
      throw new Error('Missing Telegram delivery target.');
    }

    await sendText(config.telegramToken, delivery.target, content);
    return;
  }

  throw new Error(`Unsupported workflow delivery channel: ${delivery.channel}`);
}

async function runCopilotPromptWorkflow(config, job, workflow, delivery) {
  const prompt = typeof workflow.prompt === 'string' ? workflow.prompt.trim() : '';
  if (!prompt) {
    throw new Error(`Scheduled job ${job.id} is missing a workflow prompt.`);
  }

  const result = await promptGateway(config, {
    sessionId: resolveScheduledSessionId(job, workflow, delivery),
    prompt,
    context: {
      channel: 'scheduler',
      scheduled_job_id: job.id,
      delivery_channel: delivery.channel || '',
      delivery_target: delivery.target || ''
    }
  });

  await deliverResult(config, delivery, result.reply);
  return result;
}

async function runWorkflow(config, job) {
  const { workflow, delivery } = resolveWorkflowDelivery(job);

  switch (workflow.kind) {
    case 'copilot-prompt':
      return runCopilotPromptWorkflow(config, job, workflow, delivery);
    default:
      throw new Error(`Unsupported workflow kind: ${workflow.kind}`);
  }
}

module.exports = {
  runWorkflow
};