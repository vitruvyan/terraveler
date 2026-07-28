/**
 * Which constitution is in force. One constant, one file.
 *
 * It used to be a literal declared separately in six places, and they drifted:
 * the MCP surface and the ingestion pipeline said 0.4 while all four editorial
 * desk routes still said 0.2. Nothing broke visibly — the desk simply stamped
 * every verdict it recorded with a version of the Carta that had been
 * superseded twice.
 *
 * That is worse than a cosmetic bug. Carta §3.5 makes the audit trail the
 * record of which rules governed each decision, so an external Scribe reading
 * `get_audit` on an approved submission saw its draft declare v0.4 and the
 * verdict on that same draft declare v0.2, and had no way to tell whether the
 * editor had genuinely ruled under an older constitution or the desk was
 * writing a stale constant. Found exactly that way, by a contributor auditing
 * their own approved work.
 *
 * So: import it, never redeclare it. test/carta.test.ts fails the build if any
 * other file declares its own — the check that would have caught this.
 */
export const CARTA_VERSION = "0.5";
