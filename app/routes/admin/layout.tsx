import {
  Form,
  NavLink,
  Outlet,
  useLoaderData,
  type LoaderFunctionArgs,
} from "react-router";
import {
  Boxes,
  FileText,
  LayoutDashboard,
  Mail,
  Package,
  Settings,
  ShoppingCart,
  Tags,
  Users,
  UserRound,
} from "lucide-react";
import { requireUser } from "~/lib/auth.server";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const user = await requireUser(context, request);
  return { user };
}

const nav = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/categories", label: "Categories", icon: Tags },
  { to: "/admin/customers", label: "Customers", icon: UserRound },
  { to: "/admin/orders", label: "Orders", icon: ShoppingCart },
  { to: "/admin/content", label: "Content", icon: FileText },
  { to: "/admin/projects", label: "Projects", icon: Boxes },
  { to: "/admin/messages", label: "Messages", icon: Mail },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminLayout() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-svh">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <Boxes className="size-5 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">Trade Portal</p>
            <p className="text-xs text-muted-foreground">The Furniture Shack</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {nav.map((item) =>
            "soon" in item && item.soon ? (
              <span
                key={item.to}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
                title="Coming in a later milestone"
              >
                <item.icon className="size-4" />
                {item.label}
                <span className="ml-auto text-[10px] uppercase">soon</span>
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent",
                  )
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="border-t border-border p-3">
          <p className="truncate px-1 text-sm font-medium">{user.name}</p>
          <p className="truncate px-1 text-xs text-muted-foreground">
            {user.email} · {user.role}
          </p>
          <Form method="post" action="/admin/logout" className="mt-2">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </Form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
