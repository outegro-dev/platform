import { redirect } from "next/navigation";
import { returnPath } from "@/lib/routes";

/** Home is the purchase list; `?order=<id>` opens that order. */
export default async function Home({ searchParams }: PageProps<"/">) {
  redirect(returnPath(await searchParams));
}
