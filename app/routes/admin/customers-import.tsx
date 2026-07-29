import {
  Form,
  Link,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Import customers — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  return null;
}

/** Small CSV parser handling quoted fields, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex((h) => pattern.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const form = await request.formData();
  const file = form.get("csv");
  const text =
    file instanceof File ? await file.text() : String(form.get("csv_text") ?? "");
  if (!text.trim()) return { error: "Choose a CSV file first." };

  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "The CSV needs a header row plus at least one customer." };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = {
    business: findColumn(headers, [/company|business|account name/]),
    email: findColumn(headers, [/e-?mail/]),
    contact: findColumn(headers, [/contact|buyer|first ?name|full ?name|^name$/]),
    phone: findColumn(headers, [/phone|mobile|tel/]),
    // Orderspace has "Address Name" (the addressee) before the real street
    // columns — prefer "address 1"/street, fall back to any address column.
    address: findColumn(headers, [/^address 1$|^address$|street/, /address(?! name)/, /address/]),
    addr2: findColumn(headers, [/^address 2$/]),
    city: findColumn(headers, [/town|city|suburb/]),
    state: findColumn(headers, [/county\/state|^state$/]),
    postcode: findColumn(headers, [/post ?code|zip/]),
    status: findColumn(headers, [/^status$/]),
    abn: findColumn(headers, [/abn|tax number|business number/, /tax/]),
  };
  if (col.email < 0 || col.business < 0) {
    return {
      error: `Couldn't find the required columns. Headers found: ${headers.join(", ")}. Need at least a company/business name column and an email column.`,
    };
  }

  const db = context.db;
  let created = 0;
  const skipped: string[] = [];
  for (const row of rows.slice(1).slice(0, 5000)) {
    const email = (row[col.email] ?? "").trim().toLowerCase();
    const business = (row[col.business] ?? "").trim();
    if (!email.includes("@") || !business) {
      if (email || business) skipped.push(`${business || email} (missing email or name)`);
      continue;
    }
    // Only bring across live accounts — Orderspace exports closed ones too.
    const status = col.status >= 0 ? (row[col.status] ?? "").trim().toLowerCase() : "";
    if (status && status !== "active") {
      skipped.push(`${business} (${status} in the old portal)`);
      continue;
    }
    const existing = await db`SELECT 1 FROM customers WHERE lower(email) = ${email}`;
    if (existing.length > 0) {
      skipped.push(`${business} (${email} already exists)`);
      continue;
    }
    const cell = (idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");
    const cityLine = [cell(col.city), cell(col.state), cell(col.postcode)]
      .filter(Boolean)
      .join(" ");
    const address = [cell(col.address), cell(col.addr2), cityLine].filter(Boolean).join("\n");
    // Imported customers arrive approved (they're existing trade customers)
    // with no usable password — they set one via an invite link.
    await db`
      INSERT INTO customers (business_name, abn, business_type, contact_name, email, phone,
                             address, password_hash, approved, approved_at)
      VALUES (${business},
              ${col.abn >= 0 ? (row[col.abn] ?? "").replace(/\s/g, "").trim() : ""},
              'other',
              ${col.contact >= 0 ? (row[col.contact] ?? "").trim() : business},
              ${email},
              ${col.phone >= 0 ? (row[col.phone] ?? "").trim() : ""},
              ${address},
              '', TRUE, now())
    `;
    created++;
  }

  return {
    ok: `${created} customer(s) imported (approved, no password yet — use each row's "Invite link" button, or email invites once Resend is configured).`,
    skipped: skipped.slice(0, 50),
    skippedTotal: skipped.length,
  };
}

export default function ImportCustomers() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/customers" className="underline-offset-4 hover:underline">
            Customers
          </Link>{" "}
          / import
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Import customers from CSV</h1>
        <p className="text-sm text-muted-foreground">
          Works with an Orderspace customer export (Customers → Export) or any CSV with a
          header row. Needs at least a company/business name column and an email column;
          contact, phone, address and ABN are picked up when present. Existing emails are
          skipped, never overwritten.
        </p>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}
      {actionData && "skipped" in actionData && actionData.skipped && actionData.skipped.length > 0 && (
        <Alert>
          Skipped {actionData.skippedTotal ?? 0}: {actionData.skipped.join("; ")}
          {(actionData.skippedTotal ?? 0) > actionData.skipped.length && " …"}
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            Imported customers arrive approved and appear on the Customers page. They set
            their own password via an invite link before first login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data" className="flex flex-col gap-4">
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            />
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Importing…" : "Import customers"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
