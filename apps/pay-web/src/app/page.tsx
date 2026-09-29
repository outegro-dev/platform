import { redirect } from "next/navigation";
import { orderIdFrom } from "@/lib/routes";

/** Home is the purchase list; `?order=<id>` opens that order (Lava return). */
export default async function Home({ searchParams }: PageProps<"/">) {
  const orderId = orderIdFrom(await searchParams);
  redirect(orderId ? `/orders/${orderId}` : "/orders");
}
