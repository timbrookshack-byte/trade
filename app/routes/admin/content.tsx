import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings, setSettings } from "~/lib/settings.server";
import { listFaqs } from "~/lib/content.server";
import type { Faq } from "~/lib/content";
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
  return [{ title: "Content — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const [settings, faqs] = await Promise.all([
    getSettings(context, ["about_heading", "about_body", "about_image_url"]),
    listFaqs(context, false),
  ]);
  return { settings, faqs };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "about") {
    await setSettings(context, {
      about_heading: String(form.get("about_heading") ?? "").trim(),
      about_body: String(form.get("about_body") ?? "").trim(),
      about_image_url: String(form.get("about_image_url") ?? "").trim(),
    });
    return { ok: "About page saved — it's live now." };
  }

  if (intent === "faq-add") {
    const question = String(form.get("question") ?? "").trim();
    const answer = String(form.get("answer") ?? "").trim();
    if (!question || !answer) return { error: "Both a question and an answer are needed." };
    await db`
      INSERT INTO faqs (question, answer, position)
      VALUES (${question}, ${answer}, (SELECT COALESCE(MAX(position), 0) + 1 FROM faqs))
    `;
    return { ok: "Question added." };
  }

  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return { error: "Unknown action." };

  if (intent === "faq-save") {
    const question = String(form.get("question") ?? "").trim();
    const answer = String(form.get("answer") ?? "").trim();
    const position = Math.trunc(Number(form.get("position")) || 0);
    const published = form.get("published") === "on";
    if (!question || !answer) return { error: "Both a question and an answer are needed." };
    await db`
      UPDATE faqs SET question = ${question}, answer = ${answer},
        position = ${position}, published = ${published}
      WHERE id = ${id}
    `;
    return { ok: "Question saved." };
  }
  if (intent === "faq-delete") {
    await db`DELETE FROM faqs WHERE id = ${id}`;
    return { ok: "Question deleted." };
  }
  return { error: "Unknown action." };
}

export default function ContentPage() {
  const { settings, faqs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
        <p className="text-sm text-muted-foreground">
          The public About and FAQ pages. Projects have{" "}
          <Link to="/admin/projects" className="underline underline-offset-4">
            their own manager
          </Link>
          ; contact enquiries land in{" "}
          <Link to="/admin/messages" className="underline underline-offset-4">
            Messages
          </Link>
          . Changes are live the moment you save.
        </p>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>About page</CardTitle>
          <CardDescription>
            Leave a blank line between paragraphs.{" "}
            <a href="/about" target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Preview the live page ↗
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="about" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="about_heading">Heading</Label>
              <Input
                id="about_heading"
                name="about_heading"
                defaultValue={settings.about_heading ?? ""}
                placeholder="Furniture people, trade terms."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="about_body">Body</Label>
              <Textarea
                id="about_body"
                name="about_body"
                rows={8}
                defaultValue={settings.about_body ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="about_image_url">Image URL</Label>
              <Input
                id="about_image_url"
                name="about_image_url"
                defaultValue={settings.about_image_url ?? ""}
                placeholder="https://…"
              />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save About page
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
          <CardDescription>
            Lower position numbers show first. Untick published to hide a question without
            deleting it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {faqs.map((faq: Faq) => (
            <div key={faq.id} className="rounded-md border border-border p-4">
              <Form method="post" className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="faq-save" />
                <input type="hidden" name="id" value={faq.id} />
                <Input name="question" defaultValue={faq.question} />
                <Textarea name="answer" rows={3} defaultValue={faq.answer} />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    Position
                    <Input name="position" type="number" defaultValue={faq.position} className="h-9 w-20" />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="published"
                      defaultChecked={faq.published}
                      className="size-4 accent-primary"
                    />
                    Published
                  </label>
                  <div className="ml-auto flex gap-2">
                    <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                      Save
                    </Button>
                    <Button
                      type="submit"
                      name="intent"
                      value="faq-delete"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Form>
            </div>
          ))}

          <Form method="post" className="flex flex-col gap-3 rounded-md border border-dashed border-border p-4">
            <input type="hidden" name="intent" value="faq-add" />
            <p className="text-sm font-medium">Add a question</p>
            <Input name="question" placeholder="Question" />
            <Textarea name="answer" rows={3} placeholder="Answer" />
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                Add question
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
