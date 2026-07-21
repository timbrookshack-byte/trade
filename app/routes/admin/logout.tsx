import { redirect, type ActionFunctionArgs } from "react-router";
import { logout } from "~/lib/auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
  return logout(context, request);
}

export async function loader() {
  return redirect("/admin");
}
