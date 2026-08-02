import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Storefront (public + trade customers)
  layout("routes/store/layout.tsx", [
    index("routes/store/home.tsx"),
    route("products", "routes/store/products.tsx"),
    route("products/:sku", "routes/store/product.tsx"),
    route("about", "routes/store/about.tsx"),
    route("contact", "routes/store/contact.tsx"),
    route("faq", "routes/store/faq.tsx"),
    route("projects", "routes/store/projects.tsx"),
    route("projects/:slug", "routes/store/project.tsx"),
    route("trade/apply", "routes/store/apply.tsx"),
    route("trade/login", "routes/store/login.tsx"),
    route("trade/set-password", "routes/store/set-password.tsx"),
    route("cart", "routes/store/cart.tsx"),
    route("account/orders", "routes/store/orders.tsx"),
    route("account/orders/:id", "routes/store/order.tsx"),
  ]),
  route("trade/logout", "routes/store/logout.tsx"),

  // Print/PDF views — standalone, no admin shell
  route("admin/products/sheet", "routes/admin/products/sheet.tsx"),
  route("admin/orders/:id/doc", "routes/admin/orders/doc.tsx"),

  // Shopify OAuth (no UI shell; auth enforced in the loaders)
  route("admin/shopify/connect", "routes/admin/shopify-connect.tsx"),
  route("admin/shopify/callback", "routes/admin/shopify-callback.tsx"),

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
    route("admin/categories", "routes/admin/categories.tsx"),
    route("admin/categories/:category", "routes/admin/category-detail.tsx"),
    route("admin/customers", "routes/admin/customers.tsx"),
    route("admin/customers/import", "routes/admin/customers-import.tsx"),
    route("admin/content", "routes/admin/content.tsx"),
    route("admin/projects", "routes/admin/projects.tsx"),
    route("admin/projects/:id", "routes/admin/project-edit.tsx"),
    route("admin/messages", "routes/admin/messages.tsx"),
    route("admin/orders", "routes/admin/orders/list.tsx"),
    route("admin/orders/:id", "routes/admin/orders/detail.tsx"),
    route("admin/settings", "routes/admin/settings.tsx"),
    route("admin/users", "routes/admin/users.tsx"),
  ]),
] satisfies RouteConfig;
