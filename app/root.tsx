import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
  type LoaderFunctionArgs,
} from "react-router";

import stylesheet from "./app.css?url";
import { getSetting } from "~/lib/settings.server";

export function links() {
  return [{ rel: "stylesheet", href: stylesheet }];
}

export async function loader({ context }: LoaderFunctionArgs) {
  return { faviconUrl: (await getSetting(context, "favicon_url"))?.trim() || "" };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="en-AU">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {data?.faviconUrl && <link rel="icon" href={data.faviconUrl} />}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    details =
      error.status === 404
        ? "The page you're looking for doesn't exist."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="text-muted-foreground">{details}</p>
      <a href="/" className="mt-4 text-sm underline underline-offset-4">
        Back to home
      </a>
    </main>
  );
}
