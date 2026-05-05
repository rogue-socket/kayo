#!/usr/bin/env node
const { classifyUrl } = require('./lib/router');
const { extractTwitter } = require('./lib/extractors/twitter');
const { extractYoutube } = require('./lib/extractors/youtube');
const { extractArticle } = require('./lib/extractors/article');
const { closeBrowser } = require('./lib/browser');

async function fetchOne(rawUrl) {
  const { kind, url } = classifyUrl(rawUrl);

  switch (kind) {
    case 'twitter':
      return extractTwitter(url);
    case 'youtube':
      return extractYoutube(url);
    case 'article':
      return extractArticle(url);
    default:
      throw new Error(`Unknown kind: ${kind}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node fetch.js <url> [--pretty]');
    process.exit(1);
  }

  const pretty = args.includes('--pretty');
  const url = args.find((a) => !a.startsWith('--'));
  if (!url) {
    console.error('Missing URL argument.');
    process.exit(1);
  }

  try {
    const result = await fetchOne(url);
    process.stdout.write(JSON.stringify(result, null, pretty ? 2 : 0));
    process.stdout.write('\n');
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, url }) + '\n');
    process.exitCode = 2;
  } finally {
    await closeBrowser();
  }
}

main();
