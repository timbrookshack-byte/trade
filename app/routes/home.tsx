import { Link } from "react-router";

export function meta() {
  return [
    { title: "The Furniture Shack — Trade" },
    {
      name: "description",
      content: "Trade portal for The Furniture Shack's commercial customers.",
    },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        The Furniture Shack
      </p>
      <h1 className="max-w-xl text-4xl font-bold tracking-tight">Trade Portal</h1>
      <p className="max-w-md text-muted-foreground">
        Wholesale furniture for trade customers — browse the range, see live
        availability, and order on account. The trade storefront is coming soon.
      </p>
      <Link
        to="/admin"
        className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-accent"
      >
        Trade team sign in
      </Link>
    </main>
  );
}
