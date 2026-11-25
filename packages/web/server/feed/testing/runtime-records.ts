import { Database } from "bun:sqlite";

/** A private runtime-shaped fixture. Production still reads through db/feed.ts. */
export function testRuntimeRecords() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE collaboration_records(id, kind, state, acceptance_state, owner_id, conversation_id, parent_id, title, created_at, updated_at, detail_json);
    CREATE TABLE invocations(id, collaboration_record_id, message_id, flight_metadata_json, execution_json, execution_resolution_json);
    CREATE TABLE messages(id, conversation_id, actor_id, body, reply_to_message_id, created_at, metadata_json);
    CREATE TABLE actors(id, display_name);
    CREATE TABLE agent_endpoints(id, agent_id, updated_at, harness, session_id, cwd, project_root, metadata_json);
  `);
  return db;
}
