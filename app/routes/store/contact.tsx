import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { Clock, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { getSettings } from "~/lib/settings.server";
import { getNotifyAddress, queueEmail } from "~/lib/email.server";
import { instagramInfo } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert } from "~/components/ui/alert";

export function meta() {
  return [
    { title: "Contact us — The Furniture Shack Trade" },
    { name: "description", content: "Get in touch with The Furniture Shack trade team." },
  ];
}

export async function loader({ context }: LoaderFunctionArgs) {
  const settings = await getSettings(context, [
    "company_name",
    "company_phone",
    "company_email",
    "company_address",
    "company_instagram",
    "company_hours",
  ]);
  return {
    company: {
      name: settings.company_name || "The Furniture Shack — Trade",
      phone: settings.company_phone || "",
      email: settings.company_email || "",
      address: settings.company_address || "",
      instagram: instagramInfo(settings.company_instagram || ""),
      hours: settings.company_hours || "",
    },
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  // Honeypot: bots fill every field; humans never see this one.
  if (String(form.get("company_website") ?? "") !== "") {
    return redirect("/contact?sent=1");
  }
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  if (!name || !email.includes("@") || !message) {
    return { error: "Please fill in your name, a valid email, and a message." };
  }
  await context.db`
    INSERT INTO contact_messages (name, email, phone, message)
    VALUES (${name}, ${email}, ${phone}, ${message.slice(0, 5000)})
  `;
  const notify = await getNotifyAddress(context);
  if (notify) {
    queueEmail(context, {
      to: [notify],
      subject: `Trade portal enquiry from ${name}`,
      html: `<p><strong>${name}</strong> (${email}${phone ? `, ${phone}` : ""}) sent:</p>
        <p style="white-space:pre-line">${message.slice(0, 5000)}</p>
        <p><a href="https://thefurnitureshack.trade/admin/messages">View in admin</a></p>`,
    });
  }
  return redirect("/contact?sent=1");
}

export default function Contact() {
  const { company } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">Contact</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Talk to the trade team</h1>
        <p className="mt-2 max-w-xl text-lg text-muted-foreground">
          Questions about a product, a project, or your account — send a message and we'll
          get back to you, usually the same business day.
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          {company.phone && (
            <a
              href={`tel:${company.phone.replace(/\s/g, "")}`}
              className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand/50"
            >
              <span className="rounded-lg bg-brand/10 p-2.5 text-brand">
                <Phone className="size-5" />
              </span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Enquiries
                </span>
                <span className="mt-0.5 block text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
                  {company.phone}
                </span>
                <span className="block text-sm text-muted-foreground">
                  Enquiries, orders, stock checks and card payments over the phone.
                </span>
              </span>
            </a>
          )}
          {company.email && (
            <a
              href={`mailto:${company.email}`}
              className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand/50"
            >
              <span className="rounded-lg bg-brand/10 p-2.5 text-brand">
                <Mail className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Email
                </span>
                <span className="mt-0.5 block break-all text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
                  {company.email}
                </span>
                <span className="block text-sm text-muted-foreground">
                  Quotes, project enquiries and remittance advice.
                </span>
              </span>
            </a>
          )}
          {company.instagram && (
            <a
              href={company.instagram.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand/50"
            >
              <span className="rounded-lg bg-brand/10 p-2.5 text-brand">
                <Instagram className="size-5" />
              </span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Instagram
                </span>
                <span className="mt-0.5 block text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
                  {company.instagram.handle}
                </span>
                <span className="block text-sm text-muted-foreground">
                  New arrivals, projects and behind the scenes.
                </span>
              </span>
            </a>
          )}
          {company.address && (
            <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
              <span className="rounded-lg bg-brand/10 p-2.5 text-brand">
                <MapPin className="size-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Warehouse & showroom
                </p>
                <p className="mt-0.5 whitespace-pre-line text-lg font-semibold leading-snug">
                  {company.address}
                </p>
              </div>
            </div>
          )}
          {company.hours && (
            <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
              <span className="rounded-lg bg-brand/10 p-2.5 text-brand">
                <Clock className="size-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Opening hours
                </p>
                <p className="mt-0.5 whitespace-pre-line text-base font-medium leading-relaxed">
                  {company.hours}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          {searchParams.get("sent") ? (
            <div className="flex flex-col items-start gap-3">
              <Alert variant="success">
                Thanks — your message is with the trade team. We'll be in touch shortly.
              </Alert>
            </div>
          ) : (
            <Form method="post" className="grid gap-4 sm:grid-cols-2">
              {actionData?.error && (
                <div className="sm:col-span-2">
                  <Alert variant="destructive">{actionData.error}</Alert>
                </div>
              )}
              <input
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required autoComplete="name" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" name="phone" type="tel" autoComplete="tel" />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="message">Message</Label>
                <Textarea id="message" name="message" required rows={5} />
              </div>
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  disabled={busy}
                  className="bg-brand text-brand-foreground hover:bg-brand/90"
                >
                  {busy ? "Sending…" : "Send message"}
                </Button>
              </div>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
