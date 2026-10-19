// Just enough XML reading for POM files and the CocoaPods acknowledgements
// plist: both are machine-written, with no nesting of the tags read here.

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, cdata: string) => cdata.replace(/&/g, "&amp;"))
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
      if (ref[0] === "#") return String.fromCodePoint(ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
      return ENTITIES[ref] ?? whole;
    });
}

export const stripComments = (xml: string): string => xml.replace(/<!--[\s\S]*?-->/g, "");

// Inner XML of every <tag>...</tag>, in document order.
export function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

// Decoded, trimmed text of the first <tag>, or undefined.
export function firstText(xml: string, tag: string): string | undefined {
  const inner = blocks(xml, tag)[0];
  return inner === undefined ? undefined : decodeXml(inner).trim();
}
