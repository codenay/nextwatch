import type { Metadata } from "next";
import ReelspaceApp from "../reelspace-app";
import { browsePickName, parseBrowsePick } from "@/lib/browse-link";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const name = browsePickName(parseBrowsePick(await searchParams));
  const title = name ? `${name} to watch — NextWatch` : "Browse categories — NextWatch";
  const description = name
    ? `A hand-picked wall of ${name.toLowerCase()} movies and series. Open any poster to find titles like it.`
    : "Browse movies and series by genre, theme, country and mood.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default async function Browse({ searchParams }: Props) {
  const pick = parseBrowsePick(await searchParams);
  return <ReelspaceApp view="browse" initialPick={pick} />;
}
