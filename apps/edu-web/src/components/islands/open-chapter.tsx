"use client";

import { useEffect } from "react";
import { useReaderStores } from "@/stores/provider";

/**
 * Tells the reader's progress that a chapter they can read is open, so
 * "Continue reading" starts here next time. Nothing to show.
 */
export function OpenChapter({ n }: { n: number }) {
  const { progress } = useReaderStores();
  useEffect(() => {
    progress.openChapter(n);
  }, [progress, n]);
  return null;
}
