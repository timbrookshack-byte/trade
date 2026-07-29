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
import { listProjects } from "~/lib/content.server";
import { slugify, type Project } from "~/lib/content";
import { formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta() {
  return [{ title: "Projects — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  return { projects: await listProjects(context, false) };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Give the project a title first." };
  const base = slugify(title);
  const db = context.db;
  const clash = await db`SELECT 1 FROM projects WHERE slug = ${base}`;
  const slug = clash.length > 0 ? `${base}-${Date.now() % 10000}` : base;
  const [row] = await db<{ id: number }[]>`
    INSERT INTO projects (slug, title) VALUES (${slug}, ${title}) RETURNING id
  `;
  return redirect(`/admin/projects/${row.id}`);
}

export default function ProjectsAdmin() {
  const { projects } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Case studies for the public{" "}
          <a href="/projects" target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Projects page ↗
          </a>
          . Drafts stay hidden until published.
        </p>
      </div>

      {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}

      <Form method="post" className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="new-title" className="text-xs font-medium text-muted-foreground">
            New project title
          </label>
          <Input id="new-title" name="title" placeholder="e.g. Byron Bay boutique hotel fit-out" />
        </div>
        <Button type="submit" disabled={busy}>
          Create draft
        </Button>
      </Form>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No projects yet — create the first draft above.
                  </TableCell>
                </TableRow>
              )}
              {projects.map((project: Project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      to={`/admin/projects/${project.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {project.title}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">/{project.slug}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{project.category}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(project.created_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={project.published ? "default" : "secondary"}>
                      {project.published ? "published" : "draft"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
