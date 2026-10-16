import { init } from "@paralleldrive/cuid2";

const createId24 = init({ length: 24 });

/** LegendKeeper accepts client-chosen ids of 8 or 24 characters: a lowercase letter then lowercase letters or digits. */
const VALID_ID = /^(?:[a-z][a-z0-9]{7}|[a-z][a-z0-9]{23})$/;

export function mintResourceId(): string {
  return createId24();
}

export function isValidResourceId(id: string): boolean {
  return VALID_ID.test(id);
}
