// Thrown for bad command lines; reported as `clewd: <message>` with exit 1.
export class UsageError extends Error {}

// Bun's BuildMessage and ResolveMessage carry a message but are not Errors.
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
