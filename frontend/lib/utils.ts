/**
 * Lightweight class names merger utility.
 * Filters out falsy values and joins class strings cleanly.
 */
export function cn(
  ...classes: (string | boolean | undefined | null | { [key: string]: boolean })[]
): string {
  const result: string[] = [];

  for (const item of classes) {
    if (!item) continue;
    if (typeof item === "string") {
      result.push(item.trim());
    } else if (typeof item === "object") {
      for (const [key, val] of Object.entries(item)) {
        if (val) result.push(key.trim());
      }
    }
  }

  return result.join(" ");
}
