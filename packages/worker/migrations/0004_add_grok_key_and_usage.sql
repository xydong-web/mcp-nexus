-- Migration: Add Grok key lifecycle and usage tables
-- OpenSpec: integrate-mcp-nexus-groksearch (task 1.2)

CREATE TABLE IF NOT EXISTS "GrokKey" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "label" TEXT NOT NULL UNIQUE,
    "keyEncrypted" BLOB NOT NULL,
    "keyMasked" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cooldownUntil" DATETIME,
    "lastUsedAt" DATETIME,
    "failureScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "GrokKey_status_cooldownUntil_lastUsedAt_idx" ON "GrokKey"("status", "cooldownUntil", "lastUsedAt");

CREATE TABLE IF NOT EXISTS "GrokToolUsage" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toolName" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "clientTokenId" TEXT NOT NULL,
    "clientTokenPrefix" TEXT,
    "upstreamKeyId" TEXT,
    "queryHash" TEXT,
    "queryPreview" TEXT,
    "argsJson" TEXT NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    FOREIGN KEY ("clientTokenId") REFERENCES "ClientToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("upstreamKeyId") REFERENCES "GrokKey"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "GrokToolUsage_timestamp_idx" ON "GrokToolUsage"("timestamp");
CREATE INDEX IF NOT EXISTS "GrokToolUsage_toolName_idx" ON "GrokToolUsage"("toolName");
CREATE INDEX IF NOT EXISTS "GrokToolUsage_outcome_idx" ON "GrokToolUsage"("outcome");
CREATE INDEX IF NOT EXISTS "GrokToolUsage_clientTokenId_timestamp_idx" ON "GrokToolUsage"("clientTokenId", "timestamp");
CREATE INDEX IF NOT EXISTS "GrokToolUsage_queryHash_idx" ON "GrokToolUsage"("queryHash");
CREATE INDEX IF NOT EXISTS "GrokToolUsage_upstreamKeyId_idx" ON "GrokToolUsage"("upstreamKeyId");