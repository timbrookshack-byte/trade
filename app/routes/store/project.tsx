import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getProject } from "~/lib/content.server";
import { toParagraphs } from "~/lib/content";
import { listProductsBySkus, scrubProductForPublic } from "~/lib/store.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { getSetting } from "~/lib/settings.server";
import { ProductCard } from "~/components/product-card";

export function meta({ data }: { data?: { project?: { title: string } } }) {
  return [{ title: `${data?.project?.title ?? "Project"} — The Furniture Shack Trade` }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const project = await getProject(context, params.slug ?? "");
  if (!project || !project.published) throw new Response("Not found", { status: 404 });
  const [customer, imageFit, featured] = await Promise.all([
    getCustomer(context, request),
    getSetting(context, "product_image_fit"),
    listProductsBySkus(context, project.product_skus ?? []),
  ]);
  const showPrices = Boolean(customer?.approved);
  return {
    project,
    showPrices,
    imageFit: imageFit === "cover" ? "cover" : "contain",
    // Project pages are public — trade prices must never reach the HTML
    // for unapproved visitors (golden rule).
    featured: showPrices ? featured : featured.map(scrubProductForPublic),
  };
}

export default function ProjectPage() {
  const { project, featured, showPrices, imageFit } = useLoaderData<typeof loader>();
  const paragraphs = toParagraphs(project.description);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/projects" className="underline-offset-4 hover:underline">
            Projects
          </Link>{" "}
          / {project.title}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{project.title}</h1>
        {(project.category || project.location) && (
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand">
            {project.category}
            {project.category && project.location && " · "}
            {project.location}
          </p>
        )}
      </div>

      {project.cover_image_url && (
        <div className="overflow-hidden rounded-xl border border-border">
          <img
            src={project.cover_image_url}
            alt={project.title}
            className="max-h-[560px] w-full object-cover"
          />
        </div>
      )}

      {paragraphs.length > 0 && (
        <div className="max-w-3xl space-y-4 text-lg leading-relaxed text-muted-foreground">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {project.images.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {project.images.map((url, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-muted">
              <img src={url} alt="" loading="lazy" className="w-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {featured.length > 0 && (
        <div className="border-t border-border pt-8">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">
                Shop the look
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">
                Featured in this project
              </h2>
            </div>
            <Link to="/products" className="text-sm underline-offset-4 hover:underline">
              View all products
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} showPrices={showPrices} imageFit={imageFit} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-primary px-8 py-8 text-primary-foreground">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-lg font-semibold">Planning a project like this one?</p>
          <Link
            to="/contact"
            className="rounded-md bg-brand px-5 py-2.5 font-medium text-brand-foreground hover:bg-brand/90"
          >
            Talk to the trade team
          </Link>
        </div>
      </div>
    </div>
  );
}
