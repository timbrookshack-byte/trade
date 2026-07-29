// Client-safe content types + helpers (shared with content.server.ts).

export interface Faq {
  id: number;
  question: string;
  answer: string;
  position: number;
  published: boolean;
}

export interface Project {
  id: number;
  slug: string;
  title: string;
  category: string;
  location: string;
  description: string;
  cover_image_url: string;
  images: string[];
  published: boolean;
  position: number;
  created_at: string;
}

export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** Split textarea copy into paragraphs on blank lines (team-friendly editing). */
export function toParagraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
