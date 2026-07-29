import type { AppLoadContext } from "react-router";
import type { Faq, Project } from "./content";

export type { Faq, Project };
export { slugify, toParagraphs } from "./content";

export async function listFaqs(context: AppLoadContext, publishedOnly = true) {
  return context.db<Faq[]>`
    SELECT id, question, answer, position, published FROM faqs
    WHERE ${publishedOnly} = FALSE OR published
    ORDER BY position, id
  `;
}

export async function listProjects(context: AppLoadContext, publishedOnly = true) {
  return context.db<Project[]>`
    SELECT * FROM projects
    WHERE ${publishedOnly} = FALSE OR published
    ORDER BY position, created_at DESC
  `;
}

export async function getProject(context: AppLoadContext, slug: string) {
  const rows = await context.db<Project[]>`
    SELECT * FROM projects WHERE slug = ${slug}
  `;
  return rows[0] ?? null;
}
