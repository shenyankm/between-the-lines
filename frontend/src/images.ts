import assets from "./assets.json";
const manifest: Record<string, { width: number; src: string }[]> = assets;
export function imageSource(source: string, width = 1280): string {
  const variants = manifest[source];
  return (
    variants?.find((v) => v.width >= width)?.src ??
    variants?.at(-1)?.src ??
    source
  );
}
export function imageSet(source: string): string | undefined {
  return manifest[source]?.map((v) => `${v.src} ${v.width}w`).join(", ");
}
export function backgroundImage(source: string): string {
  const width =
    typeof window === "undefined"
      ? 1280
      : window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  return `url("${imageSource(source, width)}")`;
}
