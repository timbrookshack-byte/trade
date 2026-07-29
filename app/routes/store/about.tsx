import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getSettings } from "~/lib/settings.server";
import { toParagraphs } from "~/lib/content";

export function meta() {
  return [
    { title: "About us — The Furniture Shack Trade" },
    { name: "description", content: "Who we are and how we work with the trade." },
  ];
}

export async function loader({ context }: LoaderFunctionArgs) {
  const settings = await getSettings(context, [
    "about_heading",
    "about_body",
    "about_image_url",
  ]);
  return {
    heading: settings.about_heading || "Furniture people, trade terms.",
    paragraphs: toParagraphs(
      settings.about_body ||
        "The Furniture Shack has been supplying quality furniture across Queensland for years — and our trade department exists to make working with us effortless for retailers, designers and commercial projects.\n\nEdit this copy in Admin → Content.",
    ),
    imageUrl: settings.about_image_url || "",
  };
}

export default function About() {
  const { heading, paragraphs, imageUrl } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 py-6">
      <section className="grid items-start gap-10 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">
            About us
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {heading}
          </h1>
          <div className="space-y-4 text-lg leading-relaxed text-muted-foreground">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
        {imageUrl ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            Add an image in Admin → Content
          </div>
        )}
      </section>

      <section className="rounded-xl bg-primary px-8 py-10 text-primary-foreground">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Work with us on trade terms</h2>
            <p className="mt-1 text-primary-foreground/70">
              Trade pricing, live availability and 24/7 online ordering.
            </p>
          </div>
          <Link
            to="/trade/apply"
            className="rounded-md bg-brand px-6 py-3 font-medium text-brand-foreground hover:bg-brand/90"
          >
            Apply for a trade account
          </Link>
        </div>
      </section>
    </div>
  );
}
