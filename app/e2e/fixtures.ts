// Fixed editions for local browser runs. Images are inline SVG data URIs, so
// a run never touches the network and every screenshot is repeatable.

function photo(a: string, b: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
    `</linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>` +
    `<circle cx="560" cy="200" r="120" fill="#ffffff" fill-opacity="0.18"/></svg>`;
  // Raw markup on purpose: react-native-web percent-encodes the part after
  // "utf8," itself, so encoding it here would encode it twice.
  return "data:image/svg+xml;utf8," + svg;
}

export interface FixtureStory {
  cat: string;
  headline: string;
  source: string;
  url: string;
  summary: string[];
  fullText: string;
  image: string;
  overview?: { label: string; text: string }[];
  linked?: null;
}

export interface FixtureEdition {
  id: string;
  date: string;
  weekday: string;
  full: string;
  hero?: string;
  inProgress?: boolean;
  stories: FixtureStory[];
}

function story(cat: string, headline: string, source: string, image = ""): FixtureStory {
  return {
    cat,
    headline,
    source,
    url: `https://example.com/${encodeURIComponent(headline.toLowerCase().replace(/\s+/g, "-"))}`,
    summary: [`${headline}.`, "A second sentence that fills out the summary."],
    fullText: "The first paragraph of the article.\n\nThe second paragraph of the article.",
    image,
    overview: [
      { label: "Why it matters", text: "It changes how the thing works." },
      { label: "What's next", text: "More news follows next week." },
    ],
    linked: null,
  };
}

export const EDITIONS: FixtureEdition[] = [
  {
    id: "2026-03-12",
    date: "March 12",
    weekday: "Thursday",
    full: "Thursday, March 12, 2026",
    hero: photo("#1e6091", "#2c7a7b"),
    stories: [
      story("tech", "Open hardware boards ship with mainline kernels", "example.com", photo("#1e6091", "#2c7a7b")),
      story("science", "Telescope maps a cold gas cloud in detail", "example.org", photo("#6b46c1", "#2b6cb0")),
      story("business", "Small shops adopt shared delivery lockers", "example.net"),
      story("world", "Rail link opens between two coastal cities", "example.com", photo("#2f855a", "#b7791f")),
    ],
  },
  {
    id: "2026-03-11",
    date: "March 11",
    weekday: "Wednesday",
    full: "Wednesday, March 11, 2026",
    hero: photo("#9b2c5a", "#6b46c1"),
    stories: [
      story("health", "Study tracks sleep across four seasons", "example.org", photo("#9b2c5a", "#6b46c1")),
      story("us", "City library extends weekend hours", "example.com"),
    ],
  },
  {
    id: "2026-03-10",
    date: "March 10",
    weekday: "Tuesday",
    full: "Tuesday, March 10, 2026",
    stories: [story("sports", "Club opens a free youth league", "example.net")],
  },
];

export function editionList() {
  return EDITIONS.map((e) => ({
    id: e.id,
    date: e.date,
    weekday: e.weekday,
    full: e.full,
    count: e.stories.length,
    lead: e.stories[0]?.headline ?? "",
    hero: e.hero,
    inProgress: e.inProgress,
  }));
}

export function editionById(id: string): FixtureEdition | undefined {
  return EDITIONS.find((e) => e.id === id);
}
