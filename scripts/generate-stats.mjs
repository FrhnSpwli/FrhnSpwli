import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "FrhnSpwli";
const token = process.env.GITHUB_TOKEN;
const outputDirectory = path.resolve(process.env.STATS_OUTPUT_DIR || "assets");
const generatedAt = new Date();

const themes = {
  light: {
    background: "#ffffff",
    border: "#d0d7de",
    title: "#1f2328",
    text: "#1f2328",
    muted: "#656d76",
    accent: "#0969da",
    track: "#eaeef2",
  },
  dark: {
    background: "#0d1117",
    border: "#30363d",
    title: "#f0f6fc",
    text: "#f0f6fc",
    muted: "#8b949e",
    accent: "#58a6ff",
    track: "#21262d",
  },
};

const languageColors = {
  CSS: "#663399",
  HTML: "#e34c26",
  JavaScript: "#f1e05a",
  Kotlin: "#a97bff",
  PHP: "#4f5d95",
  Python: "#3572a5",
  TypeScript: "#3178c6",
};
const fallbackLanguageColors = ["#8b949e", "#2f81f7", "#3fb950", "#d29922", "#db61a2", "#a371f7"];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function colorForLanguage(name, index) {
  return languageColors[name] || fallbackLanguageColors[index % fallbackLanguageColors.length];
}

async function githubRequest(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "FrhnSpwli-profile-stats",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}): ${url}`);
  }

  return response.json();
}

async function getRepositories() {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repositories.push(...batch);

    if (batch.length < 100) {
      return repositories.filter(
        (repository) => !repository.fork && repository.owner.login.toLowerCase() === username.toLowerCase(),
      );
    }
  }
}

async function collectProfileData() {
  const [profile, repositories] = await Promise.all([
    githubRequest(`https://api.github.com/users/${encodeURIComponent(username)}`),
    getRepositories(),
  ]);
  const languageTotals = new Map();
  const languageCutoff = new Date(generatedAt);
  languageCutoff.setUTCFullYear(languageCutoff.getUTCFullYear() - 2);
  const languageRepositories = repositories.filter(
    (repository) => new Date(repository.pushed_at) >= languageCutoff,
  );

  for (const repository of languageRepositories) {
    const languages = await githubRequest(repository.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      if (language === "Jupyter Notebook") {
        continue;
      }
      languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
    }
  }

  const activeCutoff = new Date(generatedAt);
  activeCutoff.setUTCFullYear(activeCutoff.getUTCFullYear() - 1);

  return {
    displayName: profile.name || username,
    publicProjects: repositories.length,
    activeProjects: repositories.filter((repository) => new Date(repository.pushed_at) >= activeCutoff).length,
    stars: repositories.reduce((total, repository) => total + repository.stargazers_count, 0),
    followers: profile.followers,
    languages: [...languageTotals.entries()]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((left, right) => right.bytes - left.bytes),
  };
}

function renderStatsCard(data, theme) {
  const metrics = [
    ["Public projects", data.publicProjects],
    ["Active this year", data.activeProjects],
    ["Stars earned", data.stars],
    ["Followers", data.followers],
  ];
  const metricMarkup = metrics
    .map(([label, value], index) => {
      const x = index % 2 === 0 ? 24 : 220;
      const y = index < 2 ? 88 : 140;
      return `
  <text x="${x}" y="${y}" fill="${theme.accent}" font-size="22" font-weight="600">${escapeXml(formatNumber(value))}</text>
  <text x="${x}" y="${y + 20}" fill="${theme.muted}" font-size="12">${escapeXml(label)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="190" viewBox="0 0 420 190" role="img">
  <title>${escapeXml(data.displayName)}'s GitHub activity</title>
  <desc>Public projects, recently active projects, stars, and followers.</desc>
  <rect x="0.5" y="0.5" width="419" height="189" rx="8" fill="${theme.background}" stroke="${theme.border}"/>
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
    <text x="20" y="30" fill="${theme.title}" font-size="18" font-weight="600">GitHub Activity</text>
    <text x="20" y="50" fill="${theme.muted}" font-size="12">Public profile overview</text>${metricMarkup}
    <text x="20" y="174" fill="${theme.muted}" font-size="11">Updated weekly &#183; ${generatedAt.toISOString().slice(0, 10)}</text>
  </g>
</svg>
`;
}

function renderLanguagesCard(data, theme) {
  const totalBytes = data.languages.reduce((total, language) => total + language.bytes, 0);
  const topLanguages = data.languages.slice(0, 6).map((language, index) => ({
    ...language,
    color: colorForLanguage(language.name, index),
    percentage: totalBytes === 0 ? 0 : (language.bytes / totalBytes) * 100,
  }));
  let barOffset = 20;
  const visiblePercentage = topLanguages.reduce((total, language) => total + language.percentage, 0);
  const barSegments = topLanguages
    .map((language) => {
      const width = visiblePercentage === 0 ? 0 : (language.percentage / visiblePercentage) * 380;
      const segment = `<rect x="${barOffset.toFixed(2)}" y="58" width="${width.toFixed(2)}" height="10" fill="${language.color}"/>`;
      barOffset += width;
      return segment;
    })
    .join("\n    ");
  const languageRows = topLanguages
    .map((language, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = column === 0 ? 20 : 220;
      const y = 94 + row * 27;
      return `
    <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${language.color}"/>
    <text x="${x + 17}" y="${y}" fill="${theme.text}" font-size="12" font-weight="500">${escapeXml(language.name)}</text>
    <text x="${x + 176}" y="${y}" fill="${theme.muted}" font-size="11" text-anchor="end">${language.percentage.toFixed(1)}%</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="190" viewBox="0 0 420 190" role="img">
  <title>${escapeXml(data.displayName)}'s most used languages</title>
  <desc>Language distribution across recent public, non-fork repositories.</desc>
  <defs>
    <clipPath id="language-bar"><rect x="20" y="58" width="380" height="10" rx="5"/></clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="419" height="189" rx="8" fill="${theme.background}" stroke="${theme.border}"/>
  <g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">
    <text x="20" y="30" fill="${theme.title}" font-size="18" font-weight="600">Top Languages</text>
    <text x="20" y="48" fill="${theme.muted}" font-size="11">By code size in recent public projects</text>
    <g clip-path="url(#language-bar)">
      <rect x="20" y="58" width="380" height="10" fill="${theme.track}"/>
      ${barSegments}
    </g>${languageRows}
    <text x="20" y="176" fill="${theme.muted}" font-size="10">Past 2 years &#183; notebook files excluded</text>
  </g>
</svg>
`;
}

const data = await collectProfileData();
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "github-stats.svg"), renderStatsCard(data, themes.light), "utf8"),
  writeFile(path.join(outputDirectory, "github-stats-dark.svg"), renderStatsCard(data, themes.dark), "utf8"),
  writeFile(path.join(outputDirectory, "top-langs.svg"), renderLanguagesCard(data, themes.light), "utf8"),
  writeFile(path.join(outputDirectory, "top-langs-dark.svg"), renderLanguagesCard(data, themes.dark), "utf8"),
]);

console.log(`Generated GitHub activity cards for ${username} in ${outputDirectory}`);
