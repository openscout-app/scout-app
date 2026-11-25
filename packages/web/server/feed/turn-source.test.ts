import { expect, test } from "bun:test";
import { testRuntimeRecords } from "./testing/runtime-records.ts";
import { queryFeedWork } from "../db/feed.ts";

test("each finished turn reads its own final reply and session, not the owner's latest of either", () => {
  const db = testRuntimeRecords();
  try {
    db.exec(`
      INSERT INTO agent_endpoints VALUES('ep','owner',100,'codex','current',NULL,NULL,NULL);
      INSERT INTO collaboration_records VALUES
        ('w1','work_item','done',NULL,'owner','c',NULL,'First?',1,2,'{"requestedById":"operator","metadata":{"lastInvocationId":"i1"}}'),
        ('w2','work_item','done',NULL,'owner','c',NULL,'Second?',3,4,'{"metadata":{"lastInvocationId":"i2"}}'),
        ('w3','work_item','done',NULL,'owner','c',NULL,'No link',5,6,'{}');
      INSERT INTO invocations VALUES
        ('i1','w1','ask1','{"sessionTrace":[{"sessionId":"s1"}],"taskFinalReplyMessageId":"m1"}','{}','{}'),
        ('i2','w2','ask2','{}','{"targetSessionId":"s2"}','{}');
      INSERT INTO messages VALUES
        ('ask1','c','operator','First?',NULL,1,'{"senderContext":{"cwd":"/checkout/agent"},"collaborationRecordId":"w1"}'),
        ('otherAsk','c','operator','Elsewhere',NULL,3,'{"senderContext":{"cwd":"/wrong"},"collaborationRecordId":"other"}'),
        ('m1','c','owner','First answer','ask1',2,'{}'),
        ('m2','c','owner','Second answer','ask2',4,'{}'),
        ('m3','c','owner','Progress, not the result','ask2',5,'{"completionReply":{"kind":"progress"}}'),
        ('later','c','owner','Unrelated',NULL,7,'{}');
    `);
    const { tasks } = queryFeedWork({ mode: "window", since: 0, limit: 10 }, db);
    expect(tasks.find(t => t.id === "w1")).toMatchObject({ operatorAsked: true, askedFrom: "/checkout/agent" });
    expect(tasks.find(t => t.id === "w2")?.askedFrom).toBeNull();
    expect(tasks.map(t => [t.id, t.sessionId, t.reply, t.finishedAt])).toEqual([
      ["w3", null, null, 6], ["w2", "s2", "Second answer", 4], ["w1", "s1", "First answer", 2],
    ]);
  } finally { db.close(); }
});
