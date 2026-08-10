CREATE TABLE "Order" ("id" uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES "User"("id"), "status" "OrderStatus" NOT NULL DEFAULT 'PENDING', "totalCents" integer NOT NULL);
CREATE INDEX "Order_userId_status_idx" ON "Order"("userId", "status");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
