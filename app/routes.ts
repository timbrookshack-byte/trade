import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Storefront (public + trade customers)
  layout("routes/store/layout.tsx", [
    index("routes/store/home.tsx"),
    route("products", "routes/store/products.tsx"),
    route("products/:sku", "routes/store/product.tsx"),
    route("trade/apply", "routes/store/apply.tsx"),
    route("trade/login", "routes/store/login.tsx"),
  ]),
  route("trade/logout", "routes/store/logout.tsx"),

  // Admin auth (outside the authed shell)
  route("admin/setup", "routes/admin/setup.tsx"),
  route("admin/login", "routes/admin/login.tsx"),
  route("admin/logout", "routes/admin/logout.tsx"),

  // Admin panel (requires login — enforced in layout.tsx)
  layout("routes/admin/layout.tsx", [
    route("admin", "routes/admin/dashboard.tsx"),
    route("admin/products", "routes/admin/products/list.tsx"),
    route("admin/products/new", "routes/admin/products/new.tsx"),
    route("admin/products/:id", "routes/admin/products/edit.tsx"),
    route("admin/customers", "routes/admin/customers.tsx"),
    route("admin/settings", "routes/admin/settings.tsx"),
    route("admin/users", "routes/admin/users.tsx"),
  ]),
] satisfies RouteConfig;
