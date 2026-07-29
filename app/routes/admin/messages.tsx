import {
  Form,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { formatDateTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Messages — Trade Portal" }];
}

interface ContactMessage {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  handled: boolean;
  created_at: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const messages = await context.db<ContactMessage[]>`
    SELECT * FROM contact_messages ORDER BY handled ASC, created_at DESC LIMIT 200
  `;
  return { messages };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const id = Number(form.get("id"));
  if (Number.isInteger(id)) {
    await context.db`UPDATE contact_messages SET handled = NOT handled WHERE id = ${id}`;
  }
  return null;
}

export default function MessagesPage() {
  const { messages } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Enquiries from the public contact page. Unhandled messages sort to the top.
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">No enquiries yet.</p>
      ) : (
        messages.map((m: ContactMessage) => (
          <Card key={m.id} className={m.handled ? "opacity-60" : ""}>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {m.name}{" "}
                    {m.handled ? (
                      <Badge variant="outline">handled</Badge>
                    ) : (
                      <Badge>new</Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <a href={`mailto:${m.email}`} className="underline-offset-4 hover:underline">
                      {m.email}
                    </a>
                    {m.phone && <> · {m.phone}</>} · {formatDateTime(m.created_at)}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="id" value={m.id} />
                  <Button type="submit" variant="outline" size="sm" disabled={busy}>
                    {m.handled ? "Mark unhandled" : "Mark handled"}
                  </Button>
                </Form>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm">{m.message}</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
