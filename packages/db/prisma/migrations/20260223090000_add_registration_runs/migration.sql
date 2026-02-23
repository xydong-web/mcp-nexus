-- CreateTable
CREATE TABLE "RegistrationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'tavily',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "totalCandidates" INTEGER NOT NULL DEFAULT 0,
    "completedCandidates" INTEGER NOT NULL DEFAULT 0,
    "failedCandidates" INTEGER NOT NULL DEFAULT 0,
    "importedCandidates" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "throttleCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorClass" TEXT,
    "lastErrorMessage" TEXT,
    "requestJson" JSONB NOT NULL DEFAULT '{}',
    "resultJson" JSONB NOT NULL DEFAULT '{}',
    "statusCodeSummaryJson" JSONB NOT NULL DEFAULT '{}',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "stopRequestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "RegistrationRun_createdAt_idx" ON "RegistrationRun"("createdAt");

-- CreateIndex
CREATE INDEX "RegistrationRun_status_updatedAt_idx" ON "RegistrationRun"("status", "updatedAt");
