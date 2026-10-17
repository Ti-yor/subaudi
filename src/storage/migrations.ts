export const migrations = [
  `CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS block_search USING fts5(doc UNINDEXED,block UNINDEXED,body,tokens,tokenize='unicode61');`,
];
