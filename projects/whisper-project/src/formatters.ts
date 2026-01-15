/**
 * Subtitle formatters
 */

interface Segment {
  start: number;
  end: number;
  text: string;
}

function formatTimestamp(seconds: number, separator: string): string {
  const date = new Date(seconds * 1000);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  const ms = date.getUTCMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}${separator}${ms}`;
}

export function jsonToSrt(segments: Segment[]): string {
  return segments
    .map((s, i) => {
      const start = formatTimestamp(s.start, ",");
      const end = formatTimestamp(s.end, ",");
      return `${i + 1}\n${start} --> ${end}\n${s.text.trim()}\n`;
    })
    .join("\n");
}

export function jsonToVtt(segments: Segment[]): string {
  const header = "WEBVTT\n\n";
  const body = segments
    .map((s) => {
      const start = formatTimestamp(s.start, ".");
      const end = formatTimestamp(s.end, ".");
      return `${start} --> ${end}\n${s.text.trim()}\n`;
    })
    .join("\n");
  return header + body;
}

export function jsonToTxt(segments: Segment[]): string {
  return segments
    .map((s) => {
      const start = s.start.toFixed(2).padStart(8, " ");
      const end = s.end.toFixed(2).padStart(8, " ");
      return `[${start} -> ${end}] ${s.text.trim()}`;
    })
    .join("\n");
}
