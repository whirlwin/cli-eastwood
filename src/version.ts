declare const CLEWD_VERSION: string | undefined;

// Release builds set this with `bun build --define CLEWD_VERSION='"x.y.z"'`.
export const VERSION: string = typeof CLEWD_VERSION === "string" ? CLEWD_VERSION : "0.0.0-dev";
