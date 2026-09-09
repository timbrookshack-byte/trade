import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { slugify, type Project } from "~/lib/content";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert } from "~/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Edit project — Trade Portal" }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const [project] = await context.db<Project[]>`SELECT * FROM projects WHERE id = ${id}`;
  if (!project) throw new Response("Not found", { status: 404 });
  return { project };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const id = Number(params.id);
  // now() makes the query volatile so Hyperdrive can't serve it from cache —
  // the concurrency guard below must compare against the LIVE row.
  const [project] = await db<Project[]>`
    SELECT *, now() AS _uncached FROM projects WHERE id = ${id}
  `;
  if (!project) throw new Response("Not found", { status: 404 });
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await db`DELETE FROM projects WHERE id = ${id}`;
    return redirect("/admin/projects");
  }

  // Optimistic concurrency: projects only change via this form, so the row's
  // updated_at is a reliable "changed since you opened it" token.
  const loadedAt = String(form.get("loaded_at") ?? "");
  if (loadedAt && new Date(loadedAt).getTime() !== new Date(project.updated_at).getTime()) {
    return {
      error:
        "This project was changed by someone else since you opened it. " +
        "Reload the page to see the latest version, then re-apply your edit.",
    };
  }

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const images = String(form.get("images") ?? "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith("http"))
    .slice(0, 30);
  const slugInput = slugify(String(form.get("slug") ?? "") || title);
  const clash = await db`SELECT 1 FROM projects WHERE slug = ${slugInput} AND id <> ${id}`;
  if (clash.length > 0) return { error: `The address "/${slugInput}" is already used by another project.` };

  // Featured products: keep only SKUs that exist in the catalogue, in the
  // order entered; report typos rather than silently dropping them.
  const skuInput = [
    ...new Set(
      String(form.get("product_skus") ?? "")
        .split(/[\r\n,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 12);
  let productSkus: string[] = [];
  let unknownSkus: string[] = [];
  if (skuInput.length > 0) {
    const found = await db<{ sku: string }[]>`
      SELECT sku FROM products WHERE upper(sku) IN ${db(skuInput)}
    `;
    const foundBySku = new Map<string, string>(
      found.map((r: { sku: string }) => [r.sku.toUpperCase(), r.sku]),
    );
    productSkus = skuInput.flatMap((s) => {
      const sku = foundBySku.get(s);
      return sku ? [sku] : [];
    });
    unknownSkus = skuInput.filter((s) => !foundBySku.has(s));
  }

  const [saved] = await db<{ updated_at: string }[]>`
    UPDATE projects SET
      title = ${title},
      slug = ${slugInput},
      category = ${String(form.get("category") ?? "").trim()},
      location = ${String(form.get("location") ?? "").trim()},
      description = ${String(form.get("description") ?? "").trim()},
      cover_image_url = ${String(form.get("cover_image_url") ?? "").trim()},
      images = ${db.json(images)},
      product_skus = ${db.json(productSkus)},
      published = ${form.get("published") === "on"},
      position = ${Math.trunc(Number(form.get("position")) || 0)},
      updated_at = now()
    WHERE id = ${id}
    RETURNING updated_at::text AS updated_at
  `;
  // Return the fresh token: post-save re-reads can lag behind the write
  // (Hyperdrive caches read queries), and a stale token in the form would
  // make the NEXT save trip the concurrency guard falsely.
  return {
    savedAt: saved?.updated_at,
    ok:
      unknownSkus.length > 0
        ? `Project saved — but these SKUs aren't in the catalogue and were left off: ${unknownSkus.join(", ")}.`
        : "Project saved.",
  };
}

export default function ProjectEdit() {
  const { project } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/projects" className="underline-offset-4 hover:underline">
            Projects
          </Link>{" "}
          / {project.title}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        {project.published && (
          <a
            href={`/projects/${project.slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline underline-offset-4"
          >
            View live page ↗
          </a>
        )}
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
          <CardDescription>
            Blank line between paragraphs in the description. Gallery images: one URL per
            line. Tick published when it's ready for customers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <input
              type="hidden"
              name="loaded_at"
              value={
                (actionData && "savedAt" in actionData && actionData.savedAt) ||
                project.updated_at
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required defaultValue={project.title} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slug">Page address (/projects/…)</Label>
                <Input id="slug" name="slug" defaultValue={project.slug} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" name="category" placeholder="e.g. Hotel fit-out" defaultValue={project.category} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" placeholder="e.g. Noosa QLD" defaultValue={project.location} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={6} defaultValue={project.description} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cover_image_url">Cover image URL</Label>
              <Input id="cover_image_url" name="cover_image_url" placeholder="https://…" defaultValue={project.cover_image_url} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="images">Gallery image URLs (one per line)</Label>
              <Textarea id="images" name="images" rows={4} defaultValue={project.images.join("\n")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="product_skus">
                Featured products{" "}
                <span className="font-normal text-muted-foreground">
                  (SKUs, one per line or comma-separated — shown as "Shop the look" cards
                  at the bottom of the page, up to 12)
                </span>
              </Label>
              <Textarea
                id="product_skus"
                name="product_skus"
                rows={3}
                placeholder={"SDS23991UDCT\nBUNDLE-BYRON-01"}
                defaultValue={(project.product_skus ?? []).join("\n")}
              />
              <p className="text-xs text-muted-foreground">
                Cards show each product's photo, name and (for logged-in customers) trade
                price and stock. Inactive or discontinued products hide automatically.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={project.published}
                  className="size-4 accent-primary"
                />
                Published
              </label>
              <label className="flex items-center gap-2 text-sm">
                Position
                <Input name="position" type="number" defaultValue={project.position} className="h-9 w-20" />
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save project"}
              </Button>
              <Button type="submit" name="intent" value="delete" variant="destructive" disabled={busy}>
                Delete
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
