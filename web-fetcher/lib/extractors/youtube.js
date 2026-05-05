const { YoutubeTranscript } = require('youtube-transcript');
const { newContext } = require('../browser');

function videoIdFromUrl(url) {
  if (url.hostname.includes('youtu.be')) {
    return url.pathname.replace(/^\//, '').split('/')[0] || '';
  }
  const v = url.searchParams.get('v');
  if (v) return v;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
    return parts[1] || '';
  }
  return '';
}

async function fetchTranscript(videoId) {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    return segments.map((s) => ({
      offset: s.offset,
      duration: s.duration,
      text: s.text
    }));
  } catch (err) {
    return null;
  }
}

async function fetchMetadata(url) {
  const context = await newContext();
  const page = await context.newPage();
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('h1.ytd-watch-metadata, h1.title, meta[name="title"]', { timeout: 15000 }).catch(() => {});

    const title = await page.title();
    const description = await page.$eval('meta[name="description"]', (el) => el.getAttribute('content')).catch(() => '');
    const channel = await page.$eval('link[itemprop="name"]', (el) => el.getAttribute('content')).catch(() => '');

    return {
      title: title.replace(/ - YouTube$/, ''),
      description: description || '',
      channel: channel || ''
    };
  } finally {
    await context.close();
  }
}

async function extractYoutube(url) {
  const videoId = videoIdFromUrl(url);
  if (!videoId) {
    throw new Error(`Could not parse YouTube video ID from URL: ${url.href}`);
  }

  const [transcript, metadata] = await Promise.all([
    fetchTranscript(videoId),
    fetchMetadata(url)
  ]);

  const transcriptText = transcript
    ? transcript.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim()
    : '';

  return {
    type: 'video',
    url: url.href,
    videoId,
    title: metadata.title,
    author: metadata.channel,
    description: metadata.description,
    transcript,
    transcriptAvailable: Boolean(transcript),
    content: transcriptText || metadata.description || '',
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { extractYoutube };
