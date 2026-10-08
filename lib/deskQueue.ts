import { dataApi } from "@/lib/deskAuth";

/** Read an entire editorial queue, including rows older than PostgREST's
 * response window. Callers order by a unique id so offsets are deterministic.
 * Advance by the returned row count: the backend may cap pages below 500. */
export async function readDeskRows(path: string): Promise<any[]> {
  const rows: any[] = [];
  for (;;) {
    const page = await dataApi("GET", `${path}&limit=500&offset=${rows.length}`);
    if (!Array.isArray(page)) throw new Error("invalid desk queue response");
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}
