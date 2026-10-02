// Customer-facing alias for the order document: same module as the admin
// print view — its loader lets an order's own customer see their Tax
// Invoice (only once confirmed; other doc types stay team-only).
export { loader, meta, default } from "../admin/orders/doc";
