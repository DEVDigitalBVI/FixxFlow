/** Serializable feedback shared by server mutations and client forms. */
export type SaveState = { error?: string; success?: string };
export type ActionResult = SaveState & { redirectTo?: string };
