function classifyUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
    return { kind: 'twitter', url, host };
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    return { kind: 'youtube', url, host };
  }

  return { kind: 'article', url, host };
}

module.exports = { classifyUrl };
