import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listProjects } from "~/lib/content.server";
import type { Project } from "~/lib/content";

export function meta() {
  return [
    { title: "Projects — The Furniture Shack Trade" },
    { name: "description", content: "Fit-outs and projects furnished by The Furniture Shack trade team." },
  ];
}

export async function loader({ context }: LoaderFunctionArgs) {
  return { projects: await listProjects(context) };
}

export default function Projects() {
  const { projects } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Projects</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Recent work</h1>
        <p className="mt-2 max-w-xl text-lg text-muted-foreground">
          Fit-outs, stagings and commercial projects furnished with our range.
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          Projects are coming soon.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: Project) => (
            <Link
              key={project.id}
              to={`/projects/${project.slug}`}
              className="group overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="aspect-[4/3] overflow-hidden bg-muted">
                {project.cover_image_url ? (
                  <img
                    src={project.cover_image_url}
                    alt={project.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl text-muted-foreground/40">
                    ▪
                  </div>
                )}
              </div>
              <div className="p-5">
                <p className="text-xs uppercase tracking-wide text-brand">
                  {project.category}
                  {project.category && project.location && " · "}
                  {project.location}
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-snug group-hover:underline group-hover:underline-offset-4">
                  {project.title}
                </h2>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
