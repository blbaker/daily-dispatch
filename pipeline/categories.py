"""Story categories for the archive app: colours, labels, and the keyword
rules that pick a category from a story's headline, lede and source.

Edit CAT_RULES to fit your own feed: the first matching rule wins, and
anything unmatched falls back to tech.
"""
import re

CATS = {
    "us": "#2B9FD9", "world": "#27AE60", "sports": "#F5A623",
    "science": "#9B4DCA", "entertainment": "#E74C8A", "tech": "#3498DB",
    "business": "#1ABC9C", "politics": "#E74C3C", "health": "#2ECC71",
}
CAT_LABEL = {
    "us": "U.S.", "world": "World", "sports": "Sports", "science": "Science",
    "entertainment": "Entertainment", "tech": "Technology",
    "business": "Business", "politics": "Politics", "health": "Health",
}
# keyword -> category, checked in order (first match wins)
CAT_RULES = [
    ("tech", r"\b(claude code|chrome extension|extension|api|sdk|github|open ?source|agent|codex|kubernetes|typescript|python|rust|npm|compiler|webassembly|wasm|manifest v3|framework|library|repo|cli)\b"),
    ("sports", r"\b(nba|nfl|cyclones|hawkeyes|cavs|game|season|coach|playoff|quarterback|raiders)\b"),
    ("science", r"\b(climate|research|study|space|nasa|physic|scien|model|quantum|gpu|qwen|opus)\b"),
    ("entertainment", r"\b(plex|tv|movie|show|film|music|stream|episode|television|netflix)\b"),
    ("business", r"\b(anthropic|openai|acqui|funding|revenue|market share|enterprise|ipo|startup|token load)\b"),
    ("world", r"\b(uae|climate|un |united nations|global|europe|china|ukraine)\b"),
    ("us", r"\b(senate|congress|obama|washington|u\.s\.|federal)\b"),
]


def infer_category(text):
    t = text.lower()
    for cat, pat in CAT_RULES:
        if re.search(pat, t):
            return cat
    return "tech"  # a dev-heavy feed defaults to tech; adjust CAT_RULES for your own feed
