import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Admin auth (outside the authed shell)
  route("admin/setup", "routes/admin/setup.tsx"),
  route("admin/login", "routes/admin/login.tsx"),
  route("admin/logout", "routes/admin/logout.tsx"),

  // Admin panel (requires login — enforced in layout.tsx)
  layout("routes/admin/layout.tsx", [
    route("admin", "routes/admin/dashboard.tsx"),
    route("admin/settings", "routes/admin/settings.tsx"),
    route("admin/users", "routes/admin/users.tsx"),
  ]),
] satisfies RouteConfig;
