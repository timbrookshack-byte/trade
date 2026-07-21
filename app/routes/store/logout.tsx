import { redirect, type ActionFunctionArgs } from "react-router";
import { logoutCustomer } from "~/lib/customer-auth.server";

export async function action({ request, context }: ActionFunctionArgs) {
  return logoutCustomer(context, request);
}

export async function loader() {
  return redirect("/");
}
